/**
 * END TO END: the real firstboot client, the real governed route, the real
 * database, and a real certificate.
 *
 * Authority: owner instruction 2026-08-28 Step 2.
 *
 * ===========================================================================
 * WHY THIS TEST IS IN THE REGISTRY PACKAGE
 * ===========================================================================
 * The firstboot agent cannot depend on the registry service — it ships with zero
 * runtime dependencies inside a golden image. So the only place the DEVICE code
 * and the SERVER code can meet is here, with the agent imported as a test-only
 * dependency.
 *
 * Nothing is re-implemented. `ensureOperationalCertificate` is the same function
 * the Pi will run, the route is the same one the Pi will call, and the
 * certificate is minted by the same governed composition. The transport is a
 * direct handler call rather than a socket, which is the one substitution — and
 * it is the layer with no security decisions in it.
 */
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash, X509Certificate } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  ensureOperationalCertificate,
  currentPhase,
  readManifest,
  readRequestState,
  type IssuanceCallResult,
  type OperationalCertificateClient,
} from "@kitluy-services/kitluy-device-firstboot-agent";

import { createOperationalCertificateRouter } from "../src/operational-certificate-routes.js";
import { REGISTRY_ROLES, withServiceRole } from "../src/database.js";
import { HubPairingComposition } from "../src/hub-pairing-composition.js";
import { readDevPkiChain, resolveDevPkiPaths } from "../src/dev-operational-pki.js";
import { requireSecurityFixture } from "./support/security-gate.js";

const DSN =
  process.env.KITLUY_DEV_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54392/postgres";
const ENVIRONMENT = "development";
const HUB_PROFILE_KEY = "WS11-T001-HUB-PROBE";
const FIXTURE_PREFIX = "FIRSTBOOT-E2E-";

let pool: pg.Pool;
let workDir: string;

await requireSecurityFixture({ dsn: DSN, needsPki: true, needsTrustAnchors: true });

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

/** The transport, wired straight to the route handler. */
function routeClient(): { client: OperationalCertificateClient; calls: number } {
  const router = createOperationalCertificateRouter({ pool });
  const state = { calls: 0 };
  const client: OperationalCertificateClient = {
    async request({ csr, operationalPublicKeyPem, proofOfPossessionBase64 }) {
      state.calls += 1;
      const response = await router.handle({
        method: "POST",
        path: "/v1/operational-certificate",
        headers: { "content-type": "application/json", "x-correlation-id": csr.correlationId },
        sourceIp: "127.0.0.1",
        rawBody: JSON.stringify({
          requestId: csr.requestId,
          deviceRecordId: csr.deviceRecordId,
          environment: csr.environment,
          operationalPublicKeyPem,
          publicKeyFingerprint: csr.publicKeyFingerprint,
          hardwareTrustLevel: csr.hardwareTrustLevel,
          assignmentGeneration: csr.assignmentGeneration,
          requestedPurpose: csr.requestedPurpose,
          requestedAt: csr.requestedAt,
          nonce: csr.nonce,
          proofOfPossession: proofOfPossessionBase64,
        }),
      });
      const body = response.body as Record<string, unknown>;
      if (response.status !== 200) {
        const details = body.details as Record<string, unknown> | undefined;
        return {
          kind: "refused",
          refusal: {
            refusalCode: typeof details?.refusalCode === "string" ? details.refusalCode : "OPCERT_REFUSED",
            detail: typeof body.message === "string" ? body.message : "refused",
            retryable: details?.retryable === true,
          },
        } satisfies IssuanceCallResult;
      }
      return {
        kind: "issued",
        response: {
          outcome: body.outcome === "REPLAYED" ? "REPLAYED" : "ISSUED",
          credentialId: String(body.credentialId),
          certificateGeneration: Number(body.certificateGeneration),
          serialNumber: String(body.serialNumber),
          certificateSha256: String(body.certificateSha256),
          certificatePem: String(body.certificatePem),
          chainPem: String(body.chainPem),
          publicKeyAlgorithm: String(body.publicKeyAlgorithm),
          ...(typeof body.notBefore === "string" ? { notBefore: body.notBefore } : {}),
          ...(typeof body.notAfter === "string" ? { notAfter: body.notAfter } : {}),
        },
      } satisfies IssuanceCallResult;
    },
  };
  return { client, get calls() { return state.calls; } } as never;
}

/** A paired Hub with trusted time — everything before a certificate request. */
async function readyHub(): Promise<{ deviceId: string; assignmentGeneration: number }> {
  const assetTag = `${FIXTURE_PREFIX}${randomUUID()}`;
  const h = sha256(assetTag);
  const { rows: enrolled } = await pool.query<{ device_id: string }>(
    `select kitluy_devices.enroll_device_v1(
       $1::text,
       (select id from kitluy_devices.hardware_profiles where profile_key = $2::text and is_active),
       now(), $3::text, 'ed25519', 'software', 'STATION-E2E', 'HET-MFG/e2e',
       $4::jsonb, null) as device_id`,
    [
      assetTag,
      HUB_PROFILE_KEY,
      h,
      JSON.stringify([
        { signal_type: "mac_address", signal_value: (h.slice(0, 12).match(/../g) ?? []).join(":") },
        { signal_type: "board_serial", signal_value: `BS-${h.slice(12, 28)}` },
        { signal_type: "storage_serial", signal_value: `SS-${h.slice(28, 44)}` },
      ]),
    ],
  );
  const deviceId = enrolled[0]!.device_id;
  const { rows: scope } = await pool.query<{
    tenant_id: string;
    digital_store_id: string;
    store_location_id: string;
  }>(
    `select tenant_id, digital_store_id, store_location_id
       from kitluy_devices.device_claims order by created_at desc limit 1`,
  );
  const code = Array.from(randomUUID().replace(/-/g, "").slice(0, 8), (ch) =>
    "0123456789ABCDEFGHJKMNPQRSTVWXYZ".charAt(parseInt(ch, 16) % 32),
  ).join("");
  await pool.query(
    `select kitluy_devices.open_hub_pairing_session_v1($1::uuid,$2::uuid,$3::uuid,$4::text,900,'operator/e2e')`,
    [scope[0]!.tenant_id, scope[0]!.digital_store_id, scope[0]!.store_location_id, sha256(code)],
  );
  await new HubPairingComposition({ source: pool }).pair({
    deviceRecordId: deviceId,
    presentedCode: code,
    actorRef: "device/e2e",
  });
  await withServiceRole(pool, REGISTRY_ROLES.activation, async (c) => {
    await c.query(
      `select status from kitluy_devices.establish_device_trusted_time_v1($1::uuid,$2::text,gen_random_uuid())`,
      [deviceId, ENVIRONMENT],
    );
  });
  const { rows } = await pool.query<{ g: number }>(
    `select assignment_generation as g from kitluy_devices.devices where id=$1::uuid`,
    [deviceId],
  );
  return { deviceId, assignmentGeneration: rows[0]!.g };
}

function makePaths(dir: string) {
  return {
    directory: dir,
    privateKey: join(dir, "operational-tls.key.pem"),
    requestState: join(dir, "issuance-request.json"),
    certificate: join(dir, "operational-tls.crt.pem"),
    chain: join(dir, "operational-tls.chain.pem"),
    manifest: join(dir, "operational-credential.json"),
  };
}

beforeAll(() => {
  pool = new pg.Pool({ connectionString: DSN, max: 6 });
  workDir = mkdtempSync(join(tmpdir(), "kitluy-fb-e2e-"));
});
afterAll(async () => {
  await pool
    ?.query(
      `update kitluy_devices.devices set lifecycle_state='retired', retired_at=now()
        where asset_tag like $1 and lifecycle_state <> 'retired'`,
      [`${FIXTURE_PREFIX}%`],
    )
    .catch(() => undefined);
  await pool?.end().catch(() => undefined);
  rmSync(workDir, { recursive: true, force: true });
});

describe("firstboot obtains a REAL certificate through the REAL governed route", () => {
  it("generates a key, asks, verifies locally, and adopts", async () => {
    const hub = await readyHub();
    const dir = mkdtempSync(join(workDir, "hub-"));
    const paths = makePaths(dir);
    const chain = readDevPkiChain(resolveDevPkiPaths()!);
    const rootSha256 = createHash("sha256")
      .update(
        Buffer.from(
          chain.rootCertificatePem.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""),
          "base64",
        ),
      )
      .digest("hex");

    const { client } = routeClient();
    const outcome = await ensureOperationalCertificate({
      client,
      deviceRecordId: hub.deviceId,
      environment: ENVIRONMENT,
      hardwareTrustLevel: "development_software",
      assignmentGeneration: hub.assignmentGeneration,
      trustedTime: new Date(),
      expectedRootSha256: rootSha256,
      paths,
    });

    expect(outcome.kind, JSON.stringify(outcome)).toBe("adopted");
    expect(currentPhase(paths)).toBe("ADOPTED");

    // The certificate on disk is a real one, over the device's own key, chaining
    // to the pinned development root.
    const leaf = new X509Certificate(readFileSync(paths.certificate, "utf8"));
    const issuer = new X509Certificate(
      readFileSync(paths.chain, "utf8").match(
        /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
      )![0]!,
    );
    expect(leaf.verify(issuer.publicKey)).toBe(true);
    expect(leaf.subjectAltName).toContain(`kitluy-device://${hub.deviceId}`);

    // And the database agrees it is that device's artifact.
    const manifest = readManifest(paths)!;
    const { rows } = await pool.query<{ n: string; fp: string }>(
      `select count(*)::text as n, max(public_key_fingerprint) as fp
         from kitluy_devices.device_certificates
        where credential_id = $1::uuid and certificate_pem is not null`,
      [manifest.credentialId],
    );
    expect(rows[0]!.n).toBe("1");
    expect(rows[0]!.fp).toBe(manifest.publicKeyFingerprint);
  });

  it("ACTIVATES the Hub through the existing governed path", async () => {
    const hub = await readyHub();
    const dir = mkdtempSync(join(workDir, "hub-act-"));
    const paths = makePaths(dir);
    const chain = readDevPkiChain(resolveDevPkiPaths()!);
    const rootSha256 = createHash("sha256")
      .update(
        Buffer.from(
          chain.rootCertificatePem.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""),
          "base64",
        ),
      )
      .digest("hex");

    const { client } = routeClient();
    const outcome = await ensureOperationalCertificate({
      client,
      deviceRecordId: hub.deviceId,
      environment: ENVIRONMENT,
      hardwareTrustLevel: "development_software",
      assignmentGeneration: hub.assignmentGeneration,
      trustedTime: new Date(),
      expectedRootSha256: rootSha256,
      paths,
    });
    expect(outcome.kind).toBe("adopted");

    // Activation is UNCHANGED — the certificate the firstboot client obtained
    // satisfies the same predicate group 0201 tightened.
    const { rows } = await withServiceRole(pool, REGISTRY_ROLES.activation, async (c) =>
      c.query<{ outcome: string; refusal_code: string | null }>(
        `select outcome, refusal_code
           from kitluy_devices.attempt_activate_device_v1($1::uuid, $2::text, 'firstboot-e2e')`,
        [hub.deviceId, ENVIRONMENT],
      ),
    );
    expect(`${rows[0]!.outcome} ${rows[0]!.refusal_code ?? ""}`.trim()).toBe("ACTIVATED");
  });

  it("IDEMPOTENCY against the real door: a lost response replays one identity", async () => {
    const hub = await readyHub();
    const dir = mkdtempSync(join(workDir, "hub-replay-"));
    const paths = makePaths(dir);
    const chain = readDevPkiChain(resolveDevPkiPaths()!);
    const rootSha256 = createHash("sha256")
      .update(
        Buffer.from(
          chain.rootCertificatePem.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""),
          "base64",
        ),
      )
      .digest("hex");
    const base = {
      deviceRecordId: hub.deviceId,
      environment: ENVIRONMENT,
      hardwareTrustLevel: "development_software",
      assignmentGeneration: hub.assignmentGeneration,
      trustedTime: new Date(),
      expectedRootSha256: rootSha256,
      paths,
    };

    // Boot 1: the server issues, the response is lost on the way back.
    const { client: real } = routeClient();
    const swallowing: OperationalCertificateClient = {
      async request(input) {
        await real.request(input);
        return { kind: "unreachable", detail: "the response was lost" };
      },
    };
    const first = await ensureOperationalCertificate({ ...base, client: swallowing });
    expect(first.kind).toBe("unreachable");
    const persisted = readRequestState(paths)!;
    expect(existsSync(paths.manifest)).toBe(false);

    // The cloud DID issue. One credential exists for this device.
    const countCreds = async (): Promise<string> => {
      const { rows } = await pool.query<{ n: string }>(
        `select count(*)::text as n from kitluy_devices.device_credentials where device_record_id=$1::uuid`,
        [hub.deviceId],
      );
      return rows[0]!.n;
    };
    expect(await countCreds()).toBe("1");

    // Boot 2: the Hub replays the SAME request and adopts what already exists.
    const { client } = routeClient();
    const second = await ensureOperationalCertificate({ ...base, client });
    expect(second.kind, JSON.stringify(second)).toBe("adopted");
    if (second.kind === "adopted") expect(second.replayed).toBe(true);

    // THE PROOF: same request identity, and NO second credential.
    expect(readRequestState(paths)!.requestId).toBe(persisted.requestId);
    expect(await countCreds(), "the replay consumed a second generation").toBe("1");

    const { rows: keys } = await pool.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_generation_keys
        where device_record_id=$1::uuid and state not in ('abandoned','destroyed')`,
      [hub.deviceId],
    );
    expect(keys[0]!.n).toBe("1");
  });
});
