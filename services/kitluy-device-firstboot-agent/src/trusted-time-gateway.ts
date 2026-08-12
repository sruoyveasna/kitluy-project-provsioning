/**
 * Trusted-time gateway — the missing transport between the canonical model and
 * the Hub runtime.
 *
 * ===========================================================================
 * NOTHING HERE IS A SECOND TIME MODEL
 * ===========================================================================
 * The model already exists twice, on purpose:
 *
 *   kitluy_devices.evaluate_trusted_time_v1   (0123) — the cloud AUTHORITY
 *   @kitluy/device-identity `evaluateTrustedTime` — the device's OFFLINE mirror
 *
 * What did not exist was anything connecting the Hub's firstboot flow to the
 * authority. This module is that connection and only that: it validates which
 * readings may be offered as sources, calls the canonical function, and returns
 * its typed outcome. It computes no floor, applies no tolerance and decides no
 * status — every one of those belongs to §12 and stays there.
 *
 * ===========================================================================
 * WHAT MAY BE OFFERED AS A SOURCE
 * ===========================================================================
 * `Date.now()` is NOT a trusted time source and this module gives no way to
 * pass it as one. A device that could nominate its own wall clock as authority
 * could set the floor to anything, and every certificate window, revocation
 * snapshot age and offline grace check downstream reads that floor.
 *
 * Each of the three canonical sources must arrive already validated, and each
 * carries the reason it is trustworthy:
 *
 *   rtc                  hardware clock, only when present AND not faulted
 *   authenticated_network  authenticated network time — NEVER plain NTP
 *   signed_cloud_token   a verified `trusted_time_bootstrap` token
 *
 * An unvalidated reading is dropped here rather than forwarded as null-safe
 * "best effort", because a source that is silently downgraded looks identical
 * to a source that was never offered.
 */

import type { DatabaseHandle } from "./factory-gateway.js";

export type TrustedTimeStatus =
  | "uninitialized"
  | "trusted"
  | "restricted_rtc_failure"
  | "restricted_clock_rollback"
  | "restricted_forward_jump"
  | "restricted_no_trusted_source";

export type TrustedTimeSource =
  "rtc" | "authenticated_network" | "signed_cloud_token" | "persisted_floor" | "none";

/** A hardware clock reading. Mirrors `RtcTimeReading` in @kitluy/device-identity. */
export interface RtcReading {
  readonly available: boolean;
  readonly faulted: boolean;
  readonly time?: Date;
}

/**
 * A network time reading.
 *
 * `authenticated` is false for plain NTP, and a false reading is discarded.
 * Unauthenticated network time is an attacker-controlled number with a
 * plausible shape — accepting it would make the trusted floor settable by
 * anyone on the path.
 */
export interface NetworkReading {
  readonly available: boolean;
  readonly authenticated: boolean;
  readonly time?: Date;
}

/** A signed `trusted_time_bootstrap` token whose signature has ALREADY verified. */
export interface SignedTokenReading {
  readonly verified: boolean;
  readonly time?: Date;
}

export interface TrustedTimeSources {
  readonly rtc?: RtcReading;
  readonly network?: NetworkReading;
  readonly signedToken?: SignedTokenReading;
}

/** What actually survived validation and will be offered to the authority. */
export interface OfferedSources {
  readonly rtcTime: Date | null;
  readonly authenticatedNetworkTime: Date | null;
  readonly signedTokenTime: Date | null;
  /** Why each rejected reading was rejected — for the operator, not the device. */
  readonly rejected: readonly string[];
}

/**
 * Decide which readings are offerable. Pure, so the rule is testable without a
 * database and cannot drift between callers.
 */
export function selectOfferableSources(sources: TrustedTimeSources): OfferedSources {
  const rejected: string[] = [];

  let rtcTime: Date | null = null;
  if (sources.rtc !== undefined) {
    if (!sources.rtc.available) rejected.push("rtc: not available");
    else if (sources.rtc.faulted) rejected.push("rtc: faulted (battery/oscillator/reset)");
    else if (sources.rtc.time === undefined) rejected.push("rtc: available but no time read");
    else rtcTime = sources.rtc.time;
  }

  let authenticatedNetworkTime: Date | null = null;
  if (sources.network !== undefined) {
    if (!sources.network.available) rejected.push("network: not available");
    else if (!sources.network.authenticated)
      rejected.push("network: unauthenticated (plain NTP is not a trusted source)");
    else if (sources.network.time === undefined)
      rejected.push("network: available but no time read");
    else authenticatedNetworkTime = sources.network.time;
  }

  let signedTokenTime: Date | null = null;
  if (sources.signedToken !== undefined) {
    if (!sources.signedToken.verified) rejected.push("signed token: signature not verified");
    else if (sources.signedToken.time === undefined) rejected.push("signed token: no time claim");
    else signedTokenTime = sources.signedToken.time;
  }

  return { rtcTime, authenticatedNetworkTime, signedTokenTime, rejected };
}

export interface TrustedTimeOutcome {
  readonly status: TrustedTimeStatus;
  readonly trustedTime: Date | null;
  readonly source: TrustedTimeSource;
  readonly floorAdvanced: boolean;
  readonly anomalyType: string | null;
  readonly restricted: boolean;
  readonly detail: string | null;
}

/**
 * Establish (or re-evaluate) trusted time through the canonical authority.
 *
 * Returns the outcome for ANOMALIES too rather than throwing, because a
 * rollback or forward-jump anomaly is exactly the thing that must leave a
 * durable record; throwing here would discard the evidence the model exists to
 * produce.
 */
export async function establishTrustedTime(
  db: DatabaseHandle,
  request: {
    readonly deviceRecordId: string;
    readonly environment: string;
    readonly sources: TrustedTimeSources;
    readonly correlationId?: string;
  },
): Promise<{ outcome: TrustedTimeOutcome; offered: OfferedSources }> {
  const offered = selectOfferableSources(request.sources);

  const { rows } = await db.query<{
    status: TrustedTimeStatus;
    trusted_time: string | null;
    source: TrustedTimeSource;
    floor_advanced: boolean;
    anomaly_type: string | null;
    restricted: boolean;
    detail: string | null;
  }>(
    // FROM-clause form, deliberately. Written as `(fn(...)).*` in the SELECT
    // list, PostgreSQL expands the composite by re-evaluating the function ONCE
    // PER FIELD — seven calls, seven audit events, and a `floor_advanced` read
    // from a later call that found the floor already moved. Called in FROM it
    // is evaluated exactly once. (Verified: one call adds exactly one row to
    // device_trusted_time_events.)
    `select status, trusted_time, source, floor_advanced, anomaly_type, restricted, detail
       from kitluy_devices.evaluate_trusted_time_v1(
              $1::uuid, $2::text, $3::timestamptz, $4::timestamptz, $5::timestamptz, $6::uuid
            )`,
    [
      request.deviceRecordId,
      request.environment,
      offered.rtcTime?.toISOString() ?? null,
      offered.authenticatedNetworkTime?.toISOString() ?? null,
      offered.signedTokenTime?.toISOString() ?? null,
      request.correlationId ?? null,
    ],
  );

  const row = rows[0];
  if (row === undefined) {
    throw new Error("evaluate_trusted_time_v1 returned no outcome");
  }

  return {
    offered,
    outcome: {
      status: row.status,
      trustedTime: row.trusted_time === null ? null : new Date(row.trusted_time),
      source: row.source,
      floorAdvanced: row.floor_advanced === true,
      anomalyType: row.anomaly_type,
      restricted: row.restricted === true,
      detail: row.detail,
    },
  };
}

export interface TrustedTimeState {
  readonly floor: Date | null;
  readonly status: TrustedTimeStatus;
  readonly lastSource: TrustedTimeSource;
  readonly anomalyType: string | null;
  readonly policyVersion: number | null;
}

/** Read the persisted floor. This is what survives a restart. */
export async function readTrustedTimeState(
  db: DatabaseHandle,
  deviceRecordId: string,
): Promise<TrustedTimeState | null> {
  const { rows } = await db.query<{
    trusted_time_floor: string | null;
    status: TrustedTimeStatus;
    last_source: TrustedTimeSource;
    anomaly_type: string | null;
    policy_version: number | null;
  }>(
    `select trusted_time_floor, status, last_source, anomaly_type, policy_version
       from kitluy_devices.device_trusted_time
      where device_id = $1::uuid`,
    [deviceRecordId],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    floor: row.trusted_time_floor === null ? null : new Date(row.trusted_time_floor),
    status: row.status,
    lastSource: row.last_source,
    anomalyType: row.anomaly_type,
    policyVersion: row.policy_version === null ? null : Number(row.policy_version),
  };
}

/**
 * The DEVELOPMENT bootstrap source: the control plane's own clock.
 *
 * WHAT MAKES THIS TRUSTWORTHY, AND WHAT DOES NOT.
 * The value is read server-side from the canonical control-plane database over
 * the Hub's already-authenticated connection. The device cannot influence it,
 * which is the property that matters and the one `Date.now()` lacks entirely.
 * It is offered as `authenticated_network` because that is what it is: a time
 * obtained from an authenticated remote authority rather than from local
 * hardware.
 *
 * IT IS NOT A PRODUCTION SOURCE. It carries no signature the device can verify
 * offline, so it cannot bootstrap a Hub that has no connectivity — precisely
 * the case §12.5 describes. Production needs NTS, or a verified
 * `trusted_time_bootstrap` token bound to an activation challenge
 * (@kitluy/device-identity already models both). Those remain unimplemented and
 * are NOT weakened by this function's existence.
 */
export async function controlPlaneNetworkTime(db: DatabaseHandle): Promise<NetworkReading> {
  const { rows } = await db.query<{ now: string }>(`select now() as now`);
  const value = rows[0]?.now;
  if (value === undefined) return { available: false, authenticated: false };
  return { available: true, authenticated: true, time: new Date(value) };
}
