/**
 * The database half of `POST /v1/device-runtime/report` (group 0229).
 *
 * One door, as `kitluy_device_runtime_service`, which can reach that door and
 * nothing else. The route has already verified the signature; the door binds
 * the verified key fingerprint to the device's current sealed enrollment.
 */
import { withServiceRole, REGISTRY_ROLES, type ClientSource } from "./database.js";
import type {
  DeviceRuntimeRecordInput,
  DeviceRuntimeRecordResult,
} from "./device-runtime-routes.js";

export async function recordDeviceRuntimeReport(
  source: ClientSource,
  input: DeviceRuntimeRecordInput,
): Promise<DeviceRuntimeRecordResult> {
  const answer = await withServiceRole(source, REGISTRY_ROLES.deviceRuntime, async (client) => {
    const { rows } = await client.query<{ result: { outcome?: unknown; code?: unknown } }>(
      `select kitluy_devices.record_device_runtime_report_v1(
         $1::uuid, $2::text, $3::bigint, $4::timestamptz, $5::jsonb) as result`,
      [
        input.deviceId,
        input.identityKeyFingerprint,
        String(input.reportSequence),
        input.observedAt,
        JSON.stringify(input.report),
      ],
    );
    return rows[0]?.result ?? {};
  });
  const outcome = answer.outcome;
  if (outcome === "ACCEPTED" || outcome === "STALE") return { outcome };
  return { outcome: "REFUSED", code: typeof answer.code === "string" ? answer.code : "REFUSED" };
}
