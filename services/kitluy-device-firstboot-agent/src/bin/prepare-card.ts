/**
 * `pnpm device:prepare` — prepare one flashed card for enrollment.
 *
 * Authority: KLD-2026-08-11-FRESH-DEVICE-ENROLLMENT-001 (DEC-2) §7.
 *
 * ===========================================================================
 * THIS IS A STATION TOOL AND NEVER SHIPS TO A DEVICE
 * ===========================================================================
 * It holds a database connection string and speaks the governed refusal
 * vocabulary, exactly like `factory-gateway.ts`, and for the same reason it is
 * absent from `DEVICE_MODULES` in `package-bootstrap-runtime.sh`. That list is
 * an allowlist, so this file is excluded by construction rather than by
 * remembering to exclude it.
 *
 * ===========================================================================
 * WHAT AN OPERATOR SEES
 * ===========================================================================
 * The ticket reference, where it was written, and when it expires. Never the
 * secret — it goes to the card and nowhere else, so a terminal scrollback, a
 * screenshot or a CI log cannot leak a credential.
 *
 * Usage:
 *   pnpm device:prepare --card /media/veasna/rootfs \
 *                       --profile KL-PI5-TERMINAL --station STATION-WORKSHOP-1
 *
 * Options:
 *   --card <path>        mount point of the flashed card's root (required)
 *   --profile <key>      hardware profile key (required)
 *   --station <key>      REGISTERED enrollment station (required, no default)
 *   --environment <env>  development | pilot | production   [development]
 *   --operator <ref>     who prepared it                    [$USER]
 *   --hours <n>          ticket validity                    [168]
 *   --batch <ref>        optional batch reference
 */
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";

import pg from "pg";

import { prepareCard, type CardFilesystem } from "../card-preparation.js";
import { readEnrollmentStation, resolveHardwareProfileId } from "../factory-gateway.js";

const USAGE = `usage: device:prepare --card <path> --profile <key> --station <key>
                    [--environment <env>] [--operator <ref>] [--hours <n>] [--batch <ref>]

  --station must name a REGISTERED, active enrollment station for the target
  environment. There is no default: an unregistered station quarantines the
  device after the ticket is already spent.`;

/** The database this station issues against. Never defaulted to a real project. */
const DSN_ENV = "KITLUY_STATION_DATABASE_URL";

export function parseArguments(argv: readonly string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === undefined || !flag.startsWith("--") || value === undefined) continue;
    parsed[flag.slice(2)] = value;
  }
  return parsed;
}

/** Real card. 0700 on the directory and 0600 on the ticket, as on the device. */
export const realCardFilesystem: CardFilesystem = {
  isDirectory(path: string): boolean {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
  makeTicketDirectory(path: string): void {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  },
  writeTicket(path: string, contents: string): void {
    writeFileSync(path, contents, { mode: 0o600 });
  },
};

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const args = parseArguments(argv);
  const cardRoot = args.card;
  const profile = args.profile;
  const station = args.station;

  // `--station` is REQUIRED and deliberately has no hostname default. An
  // unregistered station key does not refuse the enrollment — it quarantines
  // the device after the card has been spent, which is a far worse outcome
  // than being asked to name the station. This was observed: a default of
  // `station/<hostname>` produced UNREGISTERED_ENROLLMENT_STATION and a
  // quarantined unit.
  if (cardRoot === undefined || profile === undefined || station === undefined) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }

  const dsn = process.env[DSN_ENV];
  if (dsn === undefined || dsn.trim().length === 0) {
    // Refused rather than defaulted: a station tool that guessed its database
    // could prepare cards against the wrong environment, and an environment is
    // exactly what a ticket is scoped to.
    process.stderr.write(
      `REFUSED: ${DSN_ENV} is not set. It must name the database this station issues against.\n`,
    );
    return 2;
  }

  const environment = args.environment ?? "development";
  const hours = args.hours === undefined ? undefined : Number(args.hours);
  if (hours !== undefined && (!Number.isInteger(hours) || hours < 1)) {
    process.stderr.write("REFUSED: --hours must be a positive whole number of hours.\n");
    return 2;
  }

  const pool = new pg.Pool({ connectionString: dsn, max: 1 });
  try {
    // Role-scoped inside a transaction rather than at session level: the
    // identity dies with the transaction, and a pooled connection cannot leak
    // it to the next caller. `kitluy_fleet_service` is the role 0190 grants
    // issuance to.
    const client = await pool.connect();
    let result;
    try {
      await client.query("begin");

      // RESOLVED BEFORE THE ROLE DROP, and this ordering is the point.
      // `kitluy_fleet_service` — the role 0190 grants issuance to — holds no
      // SELECT on `hardware_profiles`, and it should not: reading the profile
      // catalogue is a different privilege from minting a credential. The only
      // role holding both is `kitluy_fleet_governor`, which OWNS the definer
      // doors, so connecting as it to save one lookup would run the station as
      // the owner of the boundary it is supposed to be on the outside of.
      const hardwareProfileId = await resolveHardwareProfileId(client, profile);
      if (hardwareProfileId === null) {
        await client.query("rollback");
        process.stderr.write(
          `REFUSED KLUY-PROFILE-UNKNOWN\n  no active hardware profile with key ${profile}\n`,
        );
        return 1;
      }

      const stationFacts = await readEnrollmentStation(client, station);
      if (!stationFacts.registered) {
        await client.query("rollback");
        process.stderr.write(
          [
            "REFUSED KLUY-STATION-UNREGISTERED",
            `  ${station} is not a registered enrollment station.`,
            "  Enrolling from an unregistered station QUARANTINES the device after",
            "  the ticket has been spent, so this refuses before that can happen.",
            "",
          ].join("\n"),
        );
        return 1;
      }
      if (stationFacts.status !== "active") {
        await client.query("rollback");
        process.stderr.write(
          `REFUSED KLUY-STATION-NOT-ACTIVE\n  station ${station} is ${stationFacts.status}\n`,
        );
        return 1;
      }
      if (stationFacts.environment !== environment) {
        // A ticket is environment-scoped (§5); a station registered for another
        // environment would mint cards for a fleet it does not belong to.
        await client.query("rollback");
        process.stderr.write(
          `REFUSED KLUY-STATION-ENVIRONMENT-MISMATCH\n` +
            `  station ${station} is registered for ${stationFacts.environment}, not ${environment}\n`,
        );
        return 1;
      }

      await client.query("set local role kitluy_fleet_service");
      result = await prepareCard(
        { db: client, fs: realCardFilesystem },
        {
          cardRoot,
          hardwareProfileId,
          environment,
          enrollmentStationKey: station,
          enrollmentOperatorRef: args.operator ?? `operator/${userInfo().username}`,
          issuedByOperatorRef: args.operator ?? `operator/${userInfo().username}`,
          ...(hours === undefined ? {} : { validForHours: hours }),
          ...(args.batch === undefined ? {} : { enrollmentBatchRef: args.batch }),
        },
      );
      // Committed only on a fully prepared card. A write failure rolls the
      // issuance back, which is stronger than the revocation the result
      // advises — the advice remains for the case where the commit itself is
      // what failed.
      if (result.kind === "prepared") {
        await client.query("commit");
      } else {
        await client.query("rollback");
      }
    } finally {
      client.release();
    }

    if (result.kind === "prepared") {
      process.stdout.write(
        [
          "CARD PREPARED",
          `  ticket      ${result.ticketReference}`,
          `  environment ${result.environment}`,
          `  expires     ${result.expiresAt}`,
          `  written to  ${result.ticketPath}`,
          "",
          "  Eject the card and boot the device. The secret was written to the",
          "  card only — it is not recorded here, on screen, or in any log.",
          "",
        ].join("\n"),
      );
      return 0;
    }

    if (result.kind === "write_failed") {
      process.stderr.write(
        [
          `WRITE FAILED — TICKET ${result.ticketReference} MAY BE LIVE`,
          `  ${result.detail}`,
          "  The issuance was rolled back. If the rollback itself failed, revoke",
          "  this reference before reusing the card.",
          "",
        ].join("\n"),
      );
      return 1;
    }

    process.stderr.write(`REFUSED ${result.code}\n  ${result.detail}\n`);
    return 1;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

if (process.argv[1] !== undefined && process.argv[1].includes("prepare-card")) {
  void main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      // Reported, not swallowed. An operator holding a card and a failed
      // command needs to know whether the database was unreachable or the
      // role was wrong; a bare exit code is unactionable. The message may name
      // a host or a role — it can never name a ticket secret, which never
      // reaches an exception path.
      process.stderr.write(
        `FAILED: ${error instanceof Error ? error.message : "the station tool could not complete"}\n`,
      );
      process.exit(1);
    },
  );
}
