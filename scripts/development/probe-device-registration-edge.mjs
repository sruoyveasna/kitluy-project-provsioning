/**
 * `pnpm probe:device-registration` — exercise the device-registration Edge
 * Function against its contract, over real HTTP.
 *
 * ===========================================================================
 * WHY THIS IS A SCRIPT AND NOT A VITEST SUITE
 * ===========================================================================
 * The function runs on Deno and reaches the database through `npm:postgres`
 * inside a transaction that changes role. None of that can be exercised by
 * importing a module: the interesting behaviour IS the deployed shape — the
 * route, the status codes, the role change, the JSON on the wire. So the probe
 * speaks to a served instance, exactly as a Pi would.
 *
 * ===========================================================================
 * HOW TO RUN IT
 * ===========================================================================
 * Serve the function against a development database, then run this. Nothing here
 * requires the Supabase CLI; any Deno will do:
 *
 *   docker run -d --rm --name kitluy-devreg --network host \
 *     -e KITLUY_REGISTRATION_DSN="postgresql://postgres:postgres@127.0.0.1:54392/postgres" \
 *     -e DENO_DIR=/tmp/deno-cache \
 *     -v "$PWD/supabase/functions:/app/functions:ro" -w /app \
 *     denoland/deno:alpine-2.1.4 \
 *     deno run --allow-net --allow-env --allow-read functions/device-registration/index.ts
 *
 *   pnpm probe:device-registration
 *   docker stop kitluy-devreg
 *
 * Overrides: `PROBE_URL` (default http://127.0.0.1:8000),
 * `PROBE_PROFILE` (an ACTIVE hardware profile key that exists in the target).
 *
 * ===========================================================================
 * WHAT IT REFUSES TO CLAIM
 * ===========================================================================
 * It proves the ROUTE. It does not prove hardware: every board serial here is
 * random text, which is exactly the point the contract makes in §6 — hardware
 * evidence is self-reported, and a passing probe is not a trusted device. Nothing
 * this script creates is approved, and nothing it creates can pair.
 *
 * Contract: `docs/api/device-registration-edge-function-v1.md`
 * Authority: KLD-2026-08-17-DEVICE-REGISTRATION-APPROVAL-001, plan §8.5
 */
import { generateKeyPairSync, sign, createHash, createPublicKey, randomBytes } from "node:crypto";

const URL_BASE = process.env.PROBE_URL ?? "http://127.0.0.1:8000";
const PROFILE_KEY = process.env.PROBE_PROFILE ?? "WS11-T001-HUB-PROBE";

const hex = (n) => randomBytes(n).toString("hex");

function fingerprint(pem) {
  const der = createPublicKey(pem).export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex");
}

const canonicalSignals = (signals) =>
  signals
    .map((s) => `${s.signalType}=${s.signalValue}`)
    .sort()
    .join(";");
const canonicalEvidence = (e) =>
  Object.keys(e)
    .sort()
    .map((k) => `${k}=${e[k]}`)
    .join(";");

function bytes(req) {
  return Buffer.from(
    [
      "kitluy.device-registration-request.v1",
      req.assetTag,
      req.hardwareProfileKey,
      req.hostname,
      req.registrationPublicKeyFingerprint,
      canonicalSignals(req.signals),
      canonicalEvidence(req.installationEvidence),
    ].join("\n"),
    "utf8",
  );
}

function newBoard() {
  const h = hex(10);
  return {
    signals: [
      { signalType: "board_serial", signalValue: `bs-${h}` },
      { signalType: "soc_serial", signalValue: `soc-${h}` },
    ],
    assetTag: `EDGE-${h.slice(0, 8).toUpperCase()}`,
  };
}

function signed(board, keys, opts = {}) {
  const req = {
    assetTag: opts.assetTag ?? board.assetTag,
    hardwareProfileKey: opts.profileKey ?? PROFILE_KEY,
    hostname: opts.hostname ?? "pi5-edge-probe",
    registrationPublicKeyFingerprint: fingerprint(keys.publicKeyPem),
    signals: board.signals,
    installationEvidence: opts.installation ?? { storageSerial: `sd-${hex(4)}` },
  };
  const signature = sign(null, bytes(req), keys.privateKey).toString("base64");
  return {
    kind: "kitluy.device-registration-request.v1",
    ...req,
    registrationPublicKeyPem: keys.publicKeyPem,
    signature,
    ...(opts.extra ?? {}),
  };
}

function makeKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privateKey,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

async function post(body, { method = "POST", raw = false } = {}) {
  const res = await fetch(`${URL_BASE}/`, {
    method,
    headers: { "content-type": "application/json" },
    ...(method === "GET" ? {} : { body: raw ? body : JSON.stringify(body) }),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, body: json };
}

let pass = 0;
let fail = 0;
function check(label, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

const board = newBoard();
const keys = makeKeys();

// 1. Happy path: an unknown board becomes pending.
const first = await post(signed(board, keys));
check(
  "unknown board -> 200 PENDING_APPROVAL",
  first.status === 200 && first.body?.status === "PENDING_APPROVAL",
  JSON.stringify(first),
);
check(
  "response carries deviceId + installationId and NO store context",
  typeof first.body?.deviceId === "string" &&
    typeof first.body?.installationId === "string" &&
    !("tenantId" in (first.body ?? {})) &&
    !("digitalStoreId" in (first.body ?? {})) &&
    !("certificate" in (first.body ?? {})) &&
    !("pairingToken" in (first.body ?? {})),
  JSON.stringify(first.body),
);

// 2. Idempotent replay. The body must be byte-identical: a fresh storageSerial
//    would be a genuinely new installation, not a replay.
const exact = signed(board, keys, { installation: { storageSerial: "sd-fixed-probe" } });
const r1 = await post(exact);
const r2 = await post(exact);
check(
  "replay is idempotent: same device, installationCreated false",
  r1.body?.deviceId === r2.body?.deviceId && r2.body?.installationCreated === false,
  JSON.stringify([r1.body, r2.body]),
);

// 3. Forged signature refused BEFORE any database write.
const forged = signed(board, keys);
forged.signals = [{ signalType: "board_serial", signalValue: "deadbeefdeadbeef" }];
const forgedRes = await post(forged);
check(
  "tampered content -> 401 KLUY-REG-BAD-SIGNATURE",
  forgedRes.status === 401 && forgedRes.body?.code === "KLUY-REG-BAD-SIGNATURE",
  JSON.stringify(forgedRes),
);

// 4. A claimed fingerprint that is not the presented key.
const wrongFp = signed(board, keys);
wrongFp.registrationPublicKeyFingerprint = "b".repeat(64);
const wrongFpRes = await post(wrongFp);
check(
  "fingerprint not matching its key -> 401",
  wrongFpRes.status === 401 && wrongFpRes.body?.code === "KLUY-REG-FINGERPRINT-MISMATCH",
  JSON.stringify(wrongFpRes),
);

// 5. Attempting to inject Store scope.
const injected = signed(newBoard(), makeKeys(), {
  extra: { tenantId: "11111111-1111-1111-1111-111111111111" },
});
const injectedRes = await post(injected);
check(
  "injected tenantId -> 400 KLUY-REG-UNPERMITTED-FIELD",
  injectedRes.status === 400 && injectedRes.body?.code === "KLUY-REG-UNPERMITTED-FIELD",
  JSON.stringify(injectedRes),
);

// 6. Unknown hardware profile.
const unknownProfile = signed(newBoard(), makeKeys(), { profileKey: "NO-SUCH-PROFILE-KEY" });
const unknownRes = await post(unknownProfile);
check(
  "unknown profile key -> 404 KLUY-REG-UNKNOWN-PROFILE",
  unknownRes.status === 404 && unknownRes.body?.code === "KLUY-REG-UNKNOWN-PROFILE",
  JSON.stringify(unknownRes),
);

// 7. Malformed / wrong kind / wrong method.
const badKind = signed(newBoard(), makeKeys());
badKind.kind = "kitluy.something-else.v1";
const badKindRes = await post(badKind);
check("wrong kind -> 400", badKindRes.status === 400, JSON.stringify(badKindRes));

const notJson = await post("{ not json", { raw: true });
check("non-JSON body -> 400", notJson.status === 400, JSON.stringify(notJson));

const getRes = await post(null, { method: "GET" });
check("GET -> 405", getRes.status === 405, JSON.stringify(getRes));

// 8. An unnormalised signal value is refused (the signer's own rule).
const unnormalised = {
  ...signed(board, keys),
  signals: [{ signalType: "board_serial", signalValue: "ABCDEF123456" }],
};
const unnormRes = await post(unnormalised);
check(
  "unnormalised signal -> 400 KLUY-REG-SIGNAL-NOT-NORMALISED",
  unnormRes.status === 400 && unnormRes.body?.code === "KLUY-REG-SIGNAL-NOT-NORMALISED",
  JSON.stringify(unnormRes),
);

// 9. A reflash: same board, new key, new installation -> same device, new install.
const keys2 = makeKeys();
const reflashed = await post(
  signed(board, keys2, { installation: { storageSerial: "sd-reflashed-probe" } }),
);
check(
  "same board + new key + new card -> SAME deviceId, new installation",
  reflashed.body?.deviceId === first.body?.deviceId && reflashed.body?.installationCreated === true,
  JSON.stringify(reflashed.body),
);

console.log(`\n=== edge registration probe: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
