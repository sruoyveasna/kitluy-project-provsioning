/**
 * ONE target for every U1 release tool, and a refusal when it is the wrong one.
 *
 * ===========================================================================
 * WHY THIS WRAPS `dev-target.mjs` INSTEAD OF RESOLVING ITS OWN
 * ===========================================================================
 * Defect D-22 was two fleet services on one workstation pointed at two
 * databases, with the SD card's baked URL silently deciding which one a device
 * actually talked to — and a whole session spent repairing a record in the
 * database that was not answering. `dev-target.mjs` exists so every development
 * tool resolves the same way, `KITLUY_DEV_FLEET_DSN` first.
 *
 * The release tools resolve through it for exactly that reason. Pointing the
 * fleet service and the release service at different databases would recreate
 * D-22 one layer up: a device would enrol against one stack and be assigned a
 * release from another, and the symptom would be "the terminal is not offered
 * the update" with nothing saying why.
 *
 * ===========================================================================
 * AND WHY IT ADDS A CAPABILITY CHECK
 * ===========================================================================
 * Resolving to the same database is necessary but not sufficient — the stack
 * also has to CARRY the release authority. This workstation has several KitLuy
 * stacks at different migration levels, and one of them has the release tables
 * but not group 0221. A tool pointed there would fail with
 * `column "assignment_sequence" does not exist` deep inside a query.
 *
 * So `assertReleaseCapable` checks up front and refuses with the port, what is
 * missing, and what to do. The label is PRINTED by every caller before it acts,
 * so the target is on screen next to the result.
 */
import { resolveDevTarget } from "./dev-target.mjs";

/** The cloud migration group that introduced the release-assignment sequence. */
export const REQUIRED_RELEASE_GROUP = "0221";
/** The cloud migration group that answers assignments per product. */
export const REQUIRED_PRODUCT_GROUP = "0228";

export class ReleaseTargetRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = "ReleaseTargetRefusal";
  }
}

/** Resolve, exactly as every other development device tool does. */
export function resolveReleaseTarget({ local = false } = {}) {
  return resolveDevTarget({ local });
}

/**
 * Refuse a target that cannot carry a release. Checked in one query so a
 * misdirected tool fails in a second with a sentence, not in a minute with a
 * column error.
 */
export async function assertReleaseCapable(client, label) {
  const { rows } = await client.query(`
    select
      to_regclass('kitluy_releases.release_artifacts')      is not null as has_artifacts,
      to_regclass('kitluy_releases.device_installations')   is not null as has_installations,
      exists (
        select 1 from information_schema.columns
         where table_schema = 'kitluy_releases'
           and table_name   = 'device_installations'
           and column_name  = 'assignment_sequence'
      ) as has_sequence,
      exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'kitluy_releases' and p.proname = 'current_device_assignment_v1'
      ) as has_reader,
      exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'kitluy_releases' and p.proname = 'current_device_product_assignment_v1'
      ) as has_product_reader
  `);
  const state = rows[0] ?? {};
  const missing = [];
  if (state.has_artifacts !== true) missing.push("kitluy_releases.release_artifacts (group 0180)");
  if (state.has_installations !== true)
    missing.push("kitluy_releases.device_installations (group 0180)");
  if (state.has_sequence !== true) {
    missing.push(`device_installations.assignment_sequence (group ${REQUIRED_RELEASE_GROUP})`);
  }
  if (state.has_reader !== true) {
    missing.push(`kitluy_releases.current_device_assignment_v1 (group ${REQUIRED_RELEASE_GROUP})`);
  }
  if (state.has_product_reader !== true) {
    missing.push(
      `kitluy_releases.current_device_product_assignment_v1 (group ${REQUIRED_PRODUCT_GROUP})`,
    );
  }
  if (missing.length > 0) {
    throw new ReleaseTargetRefusal(
      `${label} cannot serve releases. Missing:\n` +
        missing.map((m) => `  - ${m}`).join("\n") +
        `\n\nPoint KITLUY_DEV_FLEET_DSN at a stack carrying groups ${REQUIRED_RELEASE_GROUP} and ${REQUIRED_PRODUCT_GROUP}, or apply them there first.`,
    );
  }
}

/** Resolve the ONE terminal this development workstation acts on. */
export async function resolveDeviceByAssetTag(client, assetTag) {
  const { rows } = await client.query(
    `select id, asset_tag, device_class, lifecycle_state from kitluy_devices.devices where asset_tag = $1`,
    [assetTag],
  );
  if (rows.length === 0) {
    const { rows: candidates } = await client.query(
      `select asset_tag, device_class, lifecycle_state from kitluy_devices.devices
        order by created_at desc limit 10`,
    );
    throw new ReleaseTargetRefusal(
      `no device with asset tag ${assetTag} on this target. Devices here:\n` +
        candidates
          .map((c) => `  ${c.asset_tag}  ${c.device_class}  ${c.lifecycle_state}`)
          .join("\n"),
    );
  }
  return rows[0];
}

/** The device's live Store binding — the scope `assign_release_v1` demands. */
export async function resolveAssignmentScope(client, deviceId) {
  const { rows } = await client.query(
    `select tenant_id, digital_store_id, store_location_id, assignment_generation, state
       from kitluy_devices.device_assignments
      where device_id = $1 and state in ('pending_trust', 'active')
      order by assignment_generation desc limit 1`,
    [deviceId],
  );
  if (rows.length === 0) {
    throw new ReleaseTargetRefusal(
      "the device has no live Store assignment, so `assign_release_v1` would refuse " +
        "KLUY-RELEASE-WRONG-STORE. Pair the terminal to a Store first.",
    );
  }
  return rows[0];
}
