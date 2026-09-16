/**
 * Boot classification, cloud half: assemble the evidence, then ask the contract.
 *
 * Authority: owner task BOOT-RECOVERY-CLASSIFICATION-001 slice C; migration
 * group 0227 (`describe_device_boot_evidence_v1`); the contract
 * `@kitluy/device-boot-classification`, which owns every decision.
 *
 * ===========================================================================
 * WHAT THIS FILE MAY AND MAY NOT DO
 * ===========================================================================
 * It MAY read the governed evidence for a physical board and pass it, with the
 * card's claims, to `classifyBoot`. It may NOT decide anything itself: there is
 * no branch in this file that picks a classification, because a second place
 * that decides is exactly the duplicated classifier the owner task forbids.
 *
 * The CARD's statements arrive as claims and stay claims. Nothing here looks a
 * device up by a card-supplied id: the device is whatever the hardware signals
 * resolve to, and the card is compared against it.
 *
 * ===========================================================================
 * WHY THE ROW IS VALIDATED FIELD BY FIELD
 * ===========================================================================
 * `@kitluy/device-boot-classification/evidence-row` reads the row strictly: an
 * unrecognised row throws, the route answers DEPENDENCY_UNAVAILABLE, and the
 * board keeps waiting rather than being told something false.
 */
import {
  classifyBoot,
  type BootDecision,
  type BootEvidence,
  type DeviceEnvironment,
  type MediaClaims,
  type RegistrationOutcome,
  type StoragePosture,
} from "@kitluy/device-boot-classification";
import { evidenceRowFrom } from "@kitluy/device-boot-classification/evidence-row";

import { REGISTRY_ROLES, withServiceRole, type ClientSource } from "./database.js";

/** One hardware signal, in the wire vocabulary registration already uses. */
export interface BootSignal {
  readonly signalType: string;
  readonly signalValue: string;
}

export interface BootClassificationRequest {
  readonly signals: readonly BootSignal[];
  /** What `register_device_v1` answered on this boot, as the board reports it. */
  readonly registration?: RegistrationOutcome;
  readonly media: MediaClaims;
  /** Store Hub only. */
  readonly storage?: StoragePosture;
}

export interface BootClassificationResult {
  readonly evidence: BootEvidence;
  readonly decision: BootDecision;
}

/**
 * Reads the governed evidence for the board that presented `signals` and
 * classifies the boot. One transaction, as `kitluy_device_boot_service`
 * (group 0227), which can reach this read and nothing else.
 */
export async function classifyDeviceBoot(
  source: ClientSource,
  environment: DeviceEnvironment,
  request: BootClassificationRequest,
): Promise<BootClassificationResult> {
  const row = await withServiceRole(source, REGISTRY_ROLES.deviceBoot, async (client) => {
    const { rows } = await client.query<{ evidence: unknown }>(
      "select kitluy_devices.describe_device_boot_evidence_v1($1::jsonb, $2::text) as evidence",
      [
        // The database's own signal vocabulary is snake_case; translated here,
        // exactly as the registration intake does.
        JSON.stringify(
          request.signals.map((s) => ({ signal_type: s.signalType, signal_value: s.signalValue })),
        ),
        environment,
      ],
    );
    return rows[0]?.evidence;
  });

  const { boardResolution, resolutionDetail, cloudDevice } = evidenceRowFrom(row, environment);

  const evidence: BootEvidence = {
    boardResolution,
    ...(resolutionDetail === undefined ? {} : { resolutionDetail }),
    ...(request.registration === undefined ? {} : { registration: request.registration }),
    media: request.media,
    ...(cloudDevice === undefined ? {} : { cloudDevice }),
    // The board reached this service, so it has a network and the cloud
    // answered. A board that cannot reach it classifies its own waiting state
    // locally with the same contract.
    connectivity: { networkUp: true, cloudReachable: true },
    ...(request.storage === undefined ? {} : { storage: request.storage }),
  };

  return { evidence, decision: classifyBoot(evidence) };
}
