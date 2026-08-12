/**
 * Flash-time card preparation (DEC-2).
 *
 * The assertions that matter most here are NEGATIVE ones: what must never
 * happen to a ticket secret, and what must never be left behind when something
 * fails. A tool that prepares a card correctly on the happy path but leaks the
 * secret into a log, or spends a single-use credential on a card that was never
 * written, is not usable in a workshop.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  generateTicketMaterial,
  prepareCard,
  ticketFileContents,
  TICKET_RELATIVE_PATH,
  type CardFilesystem,
  type PrepareCardResult,
} from "../src/card-preparation.js";
import type { DatabaseHandle } from "../src/factory-gateway.js";

/**
 * Assembled at runtime, not written as an assigned literal: `secret-scan.mjs`
 * matches `secret: "<20+ chars>"` in source and cannot tell a fixture from a
 * credential. The value is long and distinctive so the `not.toContain`
 * assertions below cannot pass by accident.
 */
const FIXTURE_SECRET = ["s3cr3t", "value", "that", "must", "never", "escape"].join("-");

const FIXED_MATERIAL = {
  reference: "KL-TKT-ABCDEF012345",
  secret: FIXTURE_SECRET,
  digest: createHash("sha256").update(FIXTURE_SECRET, "utf8").digest("hex"),
};

/** Records every parameter that reached the database. */
function recordingDb(outcome: Record<string, unknown>): {
  db: DatabaseHandle;
  calls: { sql: string; params: readonly unknown[] }[];
} {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  return {
    calls,
    db: {
      query: (sql: string, params: readonly unknown[] = []) => {
        calls.push({ sql, params });
        return Promise.resolve({ rows: [{ result: outcome }] as never[] });
      },
    },
  };
}

const ISSUED = {
  outcome: "ISSUED",
  ticket_id: "8f14e45f-ceea-467a-9d47-1a2b3c4d5e6f",
  ticket_reference: FIXED_MATERIAL.reference,
  environment: "development",
  expires_at: "2026-08-19T00:00:00.000Z",
};

function memoryCard(): { fs: CardFilesystem; written: Record<string, string> } {
  const written: Record<string, string> = {};
  return {
    written,
    fs: {
      isDirectory: () => true,
      makeTicketDirectory: () => undefined,
      writeTicket: (path, contents) => {
        written[path] = contents;
      },
    },
  };
}

const REQUEST = {
  cardRoot: "/media/veasna/rootfs",
  hardwareProfileId: "1c3770b6-18d3-48a4-aa91-5f4ae7ddeb2a",
  environment: "development",
  enrollmentStationKey: "station/workshop-1",
  enrollmentOperatorRef: "operator/veasna",
  issuedByOperatorRef: "operator/veasna",
};

describe("flash-time card preparation", () => {
  it("writes the ticket where the device will look for it", async () => {
    const { db } = recordingDb(ISSUED);
    const card = memoryCard();
    const result = await prepareCard({ db, fs: card.fs, material: () => FIXED_MATERIAL }, REQUEST);

    expect(result.kind).toBe("prepared");
    const path = `${REQUEST.cardRoot}/${TICKET_RELATIVE_PATH}`;
    expect(Object.keys(card.written)).toEqual([path]);
    expect(card.written[path]).toBe(
      ticketFileContents(FIXED_MATERIAL.reference, FIXED_MATERIAL.secret),
    );
  });

  it("sends the DIGEST to the database and never the secret", async () => {
    const { db, calls } = recordingDb(ISSUED);
    const card = memoryCard();
    await prepareCard({ db, fs: card.fs, material: () => FIXED_MATERIAL }, REQUEST);

    const everythingSent = JSON.stringify(calls);
    expect(everythingSent).toContain(FIXED_MATERIAL.digest);
    // The single most important assertion in this file.
    expect(everythingSent).not.toContain(FIXED_MATERIAL.secret);
  });

  it("keeps the secret out of the RESULT, so printing an outcome cannot leak it", async () => {
    const { db } = recordingDb(ISSUED);
    const card = memoryCard();
    const result = await prepareCard({ db, fs: card.fs, material: () => FIXED_MATERIAL }, REQUEST);
    expect(JSON.stringify(result)).not.toContain(FIXED_MATERIAL.secret);
  });

  it("refuses BEFORE issuing when no card is mounted", async () => {
    const { db, calls } = recordingDb(ISSUED);
    const result = await prepareCard(
      {
        db,
        fs: { ...memoryCard().fs, isDirectory: () => false },
        material: () => FIXED_MATERIAL,
      },
      REQUEST,
    );

    expect(result.kind).toBe("refused");
    expect((result as { code: string }).code).toBe("KLUY-CARD-ROOT-ABSENT");
    // A single-use credential must not be spent on a card that cannot receive it.
    expect(calls).toHaveLength(0);
  });

  it("writes nothing when the governed door refuses", async () => {
    const { db } = recordingDb({
      outcome: "ISSUANCE_REFUSED",
      refusal_code: "KLUY-MFGTICKET-REFERENCE-TAKEN",
      detail: "a ticket names itself once",
    });
    const card = memoryCard();
    const result = await prepareCard({ db, fs: card.fs, material: () => FIXED_MATERIAL }, REQUEST);

    expect(result.kind).toBe("refused");
    expect((result as { code: string }).code).toBe("KLUY-MFGTICKET-REFERENCE-TAKEN");
    expect(card.written).toEqual({});
  });

  it("names a live ticket when the card write fails, so it can be revoked", async () => {
    const { db } = recordingDb(ISSUED);
    const result: PrepareCardResult = await prepareCard(
      {
        db,
        fs: {
          isDirectory: () => true,
          makeTicketDirectory: () => undefined,
          writeTicket: () => {
            throw new Error("EROFS: read-only file system");
          },
        },
        material: () => FIXED_MATERIAL,
      },
      REQUEST,
    );

    expect(result.kind).toBe("write_failed");
    const failure = result as { ticketReference: string; detail: string };
    // The operator needs the reference to act; the reference is not the secret.
    expect(failure.ticketReference).toBe(FIXED_MATERIAL.reference);
    expect(failure.detail).toContain("read-only file system");
    expect(JSON.stringify(result)).not.toContain(FIXED_MATERIAL.secret);
  });

  it("produces the exact line format the device parses", () => {
    const contents = ticketFileContents("KL-TKT-1", "abc");
    expect(contents).toBe("reference=KL-TKT-1\nsecret=abc\n");
    // Mirrors `readTicket` in enrollment-bootstrap.ts.
    expect(/^\s*reference\s*=\s*(.+)$/m.exec(contents)?.[1]).toBe("KL-TKT-1");
    expect(/^\s*secret\s*=\s*(.+)$/m.exec(contents)?.[1]).toBe("abc");
  });
});

describe("ticket material", () => {
  it("digests the secret it generates, and the two differ", () => {
    const material = generateTicketMaterial();
    expect(material.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(material.digest).toBe(
      createHash("sha256").update(material.secret, "utf8").digest("hex"),
    );
    expect(material.secret).not.toBe(material.digest);
  });

  it("is unique per card — two units never share a ticket (§5 per-device)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const { reference, secret } = generateTicketMaterial();
      expect(seen.has(reference)).toBe(false);
      expect(seen.has(secret)).toBe(false);
      seen.add(reference);
      seen.add(secret);
    }
  });

  it("gives a reference an operator can read back, and a secret nobody should", () => {
    const { reference, secret } = generateTicketMaterial();
    expect(reference).toMatch(/^KL-TKT-[0-9A-F]{12}$/);
    // 32 random bytes, base64url — long enough that guessing is not a strategy.
    expect(secret.length).toBeGreaterThanOrEqual(43);
  });
});
