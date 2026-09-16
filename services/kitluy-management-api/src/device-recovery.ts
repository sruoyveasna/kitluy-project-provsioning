/**
 * Device recovery status for the Admin device view: what this device needs in
 * order to come back, and whether this API can perform that step today.
 *
 * Authority: owner task BOOT-RECOVERY-CLASSIFICATION-001 slice D; registry
 * group 0227 (`describe_device_recovery_facts_v1`); the contract
 * `@kitluy/device-boot-classification`, which makes the decision.
 *
 * ===========================================================================
 * WHAT QUESTION THIS ANSWERS
 * ===========================================================================
 * "If this device's SD card were replaced now, what would it be told, and what
 * is the ONE next step?" That is the question an Admin or a Partner has when a
 * shop calls about a device that will not start. It is answered by the SAME
 * contract a board runs, over the SAME facts the board's door reads (both doors
 * share `device_boot_facts_v1`), with a freshly flashed card — so the portal and
 * the device can never disagree about what to do.
 *
 * It is not the board's live boot state: the cloud does not store what a card
 * claimed, and this read writes nothing.
 *
 * ===========================================================================
 * NEXT-ACTION GAPS ARE STATED, NOT HIDDEN
 * ===========================================================================
 * Two next actions the contract can name have no governed route in this API
 * yet: releasing a device from its Store, and replacing a device's hardware.
 * The view says so (`nextActionGap`) rather than implying a button works.
 * Releasing a device is an owner/security decision (who may release, whether
 * four-eyes applies); see decision BOOT-RECOVERY-DEC-001 in handoff 44.
 */
import {
  classifyBoot,
  DEFAULT_USER_MESSAGES,
  type BootClassification,
  type BootDecision,
  type BootMessageKey,
  type BootReasonCode,
  type DeviceEnvironment,
  type NextAction,
} from "@kitluy/device-boot-classification";
import { evidenceRowFrom } from "@kitluy/device-boot-classification/evidence-row";

/** A checked-out client: `pg.Pool#connect()` satisfies it. */
export interface RecoveryClient {
  query<R = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: R[] }>;
  release(): void;
}

export interface DeviceRecoveryDeps {
  readonly pool: { connect(): Promise<RecoveryClient> };
}

/** Next actions this API cannot perform yet, and why. */
export type NextActionGap =
  /** No governed release route; owner decision BOOT-RECOVERY-DEC-001. */
  | "RELEASE_ROUTE_NOT_AVAILABLE"
  /** No device replacement route in this API (group 0179 exists, unexposed). */
  | "REPLACE_ROUTE_NOT_AVAILABLE";

export interface DeviceRecoveryView {
  readonly classification: BootClassification;
  readonly reasonCode: BootReasonCode;
  readonly nextAction: NextAction;
  readonly userMessageKey: BootMessageKey;
  /** The contract's English fallback; portals translate by key. */
  readonly message: string;
  /** Admin-only technical detail. Never rendered on a Store surface. */
  readonly adminDetail: string;
  /** What this view assumes about the card. */
  readonly basis: "freshly_flashed_card";
  readonly nextActionGap?: NextActionGap;
}

const GAPS: Readonly<Partial<Record<NextAction, NextActionGap>>> = {
  RELEASE_DEVICE_THEN_PAIR: "RELEASE_ROUTE_NOT_AVAILABLE",
  REPLACE_DEVICE: "REPLACE_ROUTE_NOT_AVAILABLE",
};

function toView(decision: BootDecision): DeviceRecoveryView {
  const gap = GAPS[decision.nextAction];
  return {
    classification: decision.classification,
    reasonCode: decision.reasonCode,
    nextAction: decision.nextAction,
    userMessageKey: decision.userMessageKey,
    message: DEFAULT_USER_MESSAGES[decision.userMessageKey],
    adminDetail: decision.adminDetail,
    basis: "freshly_flashed_card",
    ...(gap === undefined ? {} : { nextActionGap: gap }),
  };
}

function asEnvironment(value: string | undefined): DeviceEnvironment | null {
  const v = value ?? "development";
  return v === "development" || v === "pilot" || v === "production" ? v : null;
}

/**
 * The recovery view for one device, or null when the device does not exist, is
 * not a class a KitLuy boot image is built for, or the deployment environment
 * has no device-trust equivalent. The CALLER has already authorized the human.
 */
export async function readDeviceRecovery(
  deps: DeviceRecoveryDeps,
  deviceId: string,
  deploymentEnvironment: string | undefined,
): Promise<DeviceRecoveryView | null> {
  const environment = asEnvironment(deploymentEnvironment);
  if (environment === null) return null;

  const client = await deps.pool.connect();
  let row: unknown;
  try {
    await client.query("begin");
    // The narrow read identity (group 0227), not the connecting role: it can
    // reach the two boot evidence doors and nothing else.
    await client.query("set local role kitluy_device_boot_service");
    const { rows } = await client.query<{ facts: unknown }>(
      "select kitluy_devices.describe_device_recovery_facts_v1($1::uuid, $2::text) as facts",
      [deviceId, environment],
    );
    row = rows[0]?.facts;
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  if (row === null || row === undefined) return null;

  const { boardResolution, resolutionDetail, cloudDevice } = evidenceRowFrom(row, environment);
  if (
    cloudDevice === undefined ||
    (cloudDevice.deviceClass !== "store_hub" && cloudDevice.deviceClass !== "terminal")
  ) {
    return null;
  }

  return toView(
    classifyBoot({
      boardResolution,
      ...(resolutionDetail === undefined ? {} : { resolutionDetail }),
      media: {
        imageDeviceClass: cloudDevice.deviceClass,
        imageEnvironment: environment,
        hasAdoptedCredential: false,
      },
      cloudDevice,
      connectivity: { networkUp: true, cloudReachable: true },
    }),
  );
}
