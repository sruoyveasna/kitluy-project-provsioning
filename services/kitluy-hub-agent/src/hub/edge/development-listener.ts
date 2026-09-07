/**
 * The DEVELOPMENT-ONLY Store LAN listener.
 *
 * ===========================================================================
 * READ THIS BEFORE CHANGING ANYTHING IN THIS FILE
 * ===========================================================================
 * `bin/hub-agent.ts` deliberately did not start a listener. Its comment said
 * why: `createEdgeTerminalRouter` needs a pairing composition with an
 * operational SIGNER, and signer custody is BLK-005 — owner-locked, unanswered.
 * Wiring a listener without that decision would have been code nobody could
 * review against reality.
 *
 * BLK-005 IS STILL UNANSWERED. Nothing here answers it. What changed is that a
 * development Hub now has real material to compose from: BRINGUP-002 put an
 * adopted operational credential and an ed25519 device identity on the board,
 * both issued by the DEVELOPMENT certificate authority. This module composes a
 * listener from exactly that material and REFUSES anywhere but `development`,
 * so a pilot or production Hub still reaches the same "waiting on BLK-005"
 * outcome it reached before.
 *
 * ===========================================================================
 * WHICH KEY SIGNS, AND WHY IT IS NOT THE TLS KEY
 * ===========================================================================
 * A Hub holds two different keys and they are not interchangeable:
 *
 *   - the ed25519 DEVICE IDENTITY key (`/var/lib/kitluy/identity`), which SIGNS
 *   - the RSA-2048 OPERATIONAL key (`/var/lib/kitluy/operational`), which is the
 *     TLS server identity — the certificate a terminal pins
 *
 * Discovery records are ed25519 (`signatureAlgorithm: "ed25519"`), and
 * `verifyDetachedSignature` verifies them with `crypto.verify(null, …)`, which
 * is the ed25519 form — an RSA key cannot satisfy it. The parameter is named
 * `hubOperationalPublicKeyPem` for the ROLE it plays, not for the file it comes
 * from; `test/edge-discovery.test.ts` builds its signer from the device key
 * vault for exactly this reason. Signing with the RSA key here would produce
 * records no terminal could verify.
 *
 * ===========================================================================
 * WHAT STAYS FAILED-CLOSED EVEN WHEN THIS RUNS
 * ===========================================================================
 *   - `activationGateway` is `unavailableActivationGateway()`, the shipped
 *     default: every cloud activation reports UNREACHABLE. Terminal activation
 *     is not part of this milestone and must not appear to work.
 *   - `deliverySigner` is deliberately OMITTED, so the configuration route
 *     fails closed with DELIVERY_SIGNER_UNAVAILABLE rather than delivering a
 *     configuration signed by a development key.
 *   - mTLS is mandatory in the transport itself: `requestCert` and
 *     `rejectUnauthorized` are both set, TLS 1.3 is pinned at both ends, and an
 *     uncertified peer is dropped during the handshake, before any route.
 */
import { readFileSync } from "node:fs";
import { createPrivateKey, createPublicKey, sign as cryptoSign } from "node:crypto";
import { hostname as osHostname } from "node:os";
import { join } from "node:path";

import type { TrustEnvironment } from "@kitluy/device-identity";

import type { HubPool } from "../db.js";
import { TerminalPairingComposition, type PairingSigner, type SafeLogger } from "../pairing.js";
import { EdgeDiscoveryAuthority, type EdgeDiscoveryIdentity } from "./discovery.js";
import { createEdgeTerminalRouter, unavailableActivationGateway } from "./routes.js";
import { createEdgeTlsServer, EDGE_TLS_PORT } from "./transport.js";

/** Where the firstboot agent puts what it adopted. One source, not two. */
export const DEVICE_IDENTITY_KEY_PATH = "/var/lib/kitluy/identity/device-identity.key.pem";
export const OPERATIONAL_DIR = "/var/lib/kitluy/operational";
export const PAIRING_STATE_PATH = "/var/lib/kitluy/pairing-state.json";

export type ListenerRefusal = { readonly code: string; readonly detail: string };

export type ListenerComposition =
  | {
      readonly kind: "composed";
      readonly signer: PairingSigner;
      readonly identity: EdgeDiscoveryIdentity;
    }
  | ({ readonly kind: "refused" } & ListenerRefusal);

interface ComposeInputs {
  readonly environment: string;
  /** SHA-256 of the TLS server certificate a terminal will pin. */
  readonly tlsCertificateFingerprint: string;
  readonly bindHost: string;
  readonly identityKeyPath?: string;
  readonly operationalDir?: string;
  readonly pairingStatePath?: string;
  readonly hostname?: string;
  readonly readFile?: (path: string) => string;
}

function readJson(read: (p: string) => string, path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(read(path));
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stringField(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Build the signer and discovery identity, or explain precisely what is missing.
 *
 * Nothing is generated and nothing is defaulted. Every value is read from state
 * some other component already committed — the identity key from firstboot, the
 * credential from certificate adoption, the Store scope from pairing. A Hub that
 * is missing any of them is a Hub that has not finished becoming one, and
 * inventing a value here would hide that.
 */
export function composeDevelopmentListener(inputs: ComposeInputs): ListenerComposition {
  const read = inputs.readFile ?? ((p: string) => readFileSync(p, "utf8"));

  // THE GATE. Everything below is development material; nothing else may reach it.
  if (inputs.environment !== "development") {
    return {
      kind: "refused",
      code: "KLUY-HUB-EDGE-PENDING",
      detail:
        `the terminal listener is a development-only path and this Hub is running in "${inputs.environment}"; ` +
        "pairing and discovery composition for pilot and production requires the BLK-005 operational signer",
    };
  }

  const operationalDir = inputs.operationalDir ?? OPERATIONAL_DIR;
  const credential = readJson(read, join(operationalDir, "operational-credential.json"));
  const pairing = readJson(read, inputs.pairingStatePath ?? PAIRING_STATE_PATH);

  // Only an ADOPTED credential counts. The manifest is written last precisely so
  // that its presence with this phase is the one honest "yes".
  if (stringField(credential, "phase") !== "ADOPTED") {
    return {
      kind: "refused",
      code: "KLUY-HUB-EDGE-NO-CREDENTIAL",
      detail:
        "no adopted operational credential; the Hub has not completed certificate issuance " +
        `(expected phase ADOPTED in ${join(operationalDir, "operational-credential.json")})`,
    };
  }

  const certificateSerial = stringField(credential, "certificateSerial");
  const hubDeviceId = stringField(credential, "deviceRecordId");
  const tenantId = stringField(pairing, "tenantId");
  const digitalStoreId = stringField(pairing, "digitalStoreId");
  const storeLocationId = stringField(pairing, "storeLocationId");

  const missing: string[] = [];
  if (certificateSerial === undefined) missing.push("certificateSerial");
  if (hubDeviceId === undefined) missing.push("deviceRecordId");
  if (tenantId === undefined) missing.push("tenantId");
  if (digitalStoreId === undefined) missing.push("digitalStoreId");
  if (storeLocationId === undefined) missing.push("storeLocationId");
  if (missing.length > 0) {
    return {
      kind: "refused",
      code: "KLUY-HUB-EDGE-UNPAIRED",
      detail:
        `the Hub is not bound to a Store scope (missing: ${missing.join(", ")}). ` +
        "A discovery record names the Tenant, Store and Location it serves; there is nothing to name yet.",
    };
  }

  // The `!` mirrors `loadTlsMaterial` in hub-runtime.ts, which collects the same
  // way and asserts the same way after the same guard: the array above is
  // exhaustive over exactly these fields, so past this point none is undefined.
  let signer: PairingSigner;
  try {
    // The private half is loaded, used to construct the signer, and never
    // returned or logged. `sign(null, …)` is the ed25519 form.
    const privateKey = createPrivateKey(read(inputs.identityKeyPath ?? DEVICE_IDENTITY_KEY_PATH));
    const publicKeyPem = createPublicKey(privateKey)
      .export({ type: "spki", format: "pem" })
      .toString();
    signer = {
      certificateSerial: certificateSerial!,
      publicKeyPem,
      sign: (payload: Uint8Array) => cryptoSign(null, Buffer.from(payload), privateKey),
    };
  } catch (error) {
    // Names the FILE, never its contents.
    return {
      kind: "refused",
      code: "KLUY-HUB-EDGE-NO-IDENTITY-KEY",
      detail:
        `the device identity key at ${inputs.identityKeyPath ?? DEVICE_IDENTITY_KEY_PATH} could not be loaded: ` +
        (error instanceof Error ? error.message : String(error)),
    };
  }

  return {
    kind: "composed",
    signer,
    identity: {
      hubDeviceId: hubDeviceId!,
      hubTlsCertificateFingerprint: inputs.tlsCertificateFingerprint,
      tenantId: tenantId!,
      digitalStoreId: digitalStoreId!,
      storeLocationId: storeLocationId!,
      environment: inputs.environment as TrustEnvironment,
      hostname: inputs.hostname ?? osHostname(),
      port: EDGE_TLS_PORT,
    },
  };
}

export interface StartedListener {
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Compose and bind. The caller has already been told it may serve; this only
 * turns that verdict into a socket.
 */
export async function startDevelopmentListener(options: {
  readonly pool: HubPool;
  readonly composition: Extract<ListenerComposition, { kind: "composed" }>;
  readonly environment: string;
  readonly bindHost: string;
  readonly tls: { readonly key: string; readonly cert: string; readonly clientCa: string };
  readonly logger?: SafeLogger;
}): Promise<StartedListener> {
  const discovery = new EdgeDiscoveryAuthority(
    options.composition.identity,
    options.composition.signer,
    options.logger,
  );

  const handler = createEdgeTerminalRouter({
    pool: options.pool,
    environment: options.environment,
    pairing: new TerminalPairingComposition(
      options.pool,
      options.composition.signer,
      options.logger,
    ),
    // Fails closed as UNREACHABLE. Terminal activation is not this milestone.
    activationGateway: unavailableActivationGateway(),
    discovery,
    // `deliverySigner` omitted on purpose — see the header.
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });

  const server = createEdgeTlsServer({
    key: options.tls.key,
    cert: options.tls.cert,
    clientCa: options.tls.clientCa,
    bindHost: options.bindHost,
    port: EDGE_TLS_PORT,
    handler,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });

  const { port } = await server.listen();
  return { port, close: () => server.close() };
}
