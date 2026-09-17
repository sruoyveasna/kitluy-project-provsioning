/**
 * What a Pi Terminal does with a Store Hub once it can see one.
 *
 * THE SHAPE OF ONE ATTEMPT
 *
 *   1. read the adopted operational material — absent means "not activated
 *      yet", which is a WAIT, not a fault;
 *   2. find candidate Hubs: the endpoint that worked last time first, then
 *      whatever answers mDNS. Last-known first because a shop's Hub does not
 *      move, and a multicast round trip on every attempt is noise;
 *   3. fetch the signed discovery record over mutual TLS and judge it,
 *      including that the certificate named is the certificate presented;
 *   4. pin that certificate and make the three bootstrap reads the Hub serves:
 *      authority time, eligibility, configuration;
 *   5. write what happened to a status file the Device Shell can read.
 *
 * EVERY OUTCOME IS A STATUS, NOT AN EXCEPTION. A terminal whose Hub is off, or
 * which the Hub does not yet hold, is a normal state of a shop and must render
 * as a sentence an operator can act on. Nothing here throws to the caller.
 */
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { checkRecord, isSignedDiscoveryPayload, EDGE_LAN_PORT, } from "./edge-discovery-record.js";
import { discoverEdgeCandidates } from "./edge-mdns.js";
import { pairWithHub } from "./edge-pairing.js";
import { edgeRequest, readTransportCredentials, } from "./edge-transport.js";
export const WELL_KNOWN_DISCOVERY_PATH = "/.well-known/kitluy-edge-discovery/v1";
export const AUTHORITY_TIME_PATH = "/edge/v1/runtime/authority-time";
export const ELIGIBILITY_PATH = "/edge/v1/runtime/eligibility";
export const CONFIGURATION_PATH = "/edge/v1/configuration/current";
/** The Device Shell reads this; it runs as `kitluy-terminal` and cannot see /var/lib/kitluy/operational. */
export const EDGE_STATUS_PATH = "/var/lib/kitluy/terminal/edge-status.json";
/** Survives a reboot so the next boot does not start with a multicast query. */
export const LAST_ENDPOINT_PATH = "/var/lib/kitluy/terminal/last-hub-endpoint.json";
function atomicWriteJson(path, value, mode) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o750 });
    const temp = `${path}.tmp-${String(process.pid)}`;
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode });
    // writeFileSync's `mode` is masked by the process UMASK; chmod(2) is not.
    //
    // This unit runs with UMask=0077, so the 0644 that `edge-status.json` is
    // deliberately written with — "the Device Shell runs as a different user and
    // must be able to read it" — arrived as 0600 root-only on every device. The
    // Shell could not read the phase it is supposed to display, and acceptance
    // tooling read `{}` and reported the terminal as `unreported` rather than
    // SERVING. Asking for a mode and not getting it is worse than not asking:
    // the intent is stated in the call, so nobody re-checks the result.
    //
    // Applied to the TEMP file, before the rename, so the file is never briefly
    // visible at the wrong mode under its real name.
    chmodSync(temp, mode);
    renameSync(temp, path);
}
function readLastEndpoint(path) {
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        if (typeof parsed.host !== "string" || parsed.host === "")
            return null;
        const port = typeof parsed.port === "number" ? parsed.port : EDGE_LAN_PORT;
        return { host: parsed.host, port, instance: "last-known" };
    }
    catch {
        return null;
    }
}
/** The refusal the Hub sends when it holds no projection for this terminal. */
function refusalResult(body) {
    const envelope = body;
    return envelope?.error?.details?.result ?? envelope?.error?.code ?? "UNKNOWN";
}
/** One full attempt. Returns the status it also wrote. */
export async function runEdgeAttempt(options) {
    const now = options.now ?? (() => new Date());
    const statusPath = options.statusPath ?? EDGE_STATUS_PATH;
    const lastEndpointPath = options.lastEndpointPath ?? LAST_ENDPOINT_PATH;
    const call = options.requestFn ?? edgeRequest;
    const publish = (status) => {
        // 0644: the Device Shell runs as a different user and must be able to read
        // it. Nothing here is a secret — a phase, a fingerprint and a sentence.
        try {
            atomicWriteJson(statusPath, status, 0o644);
        }
        catch {
            // A terminal that cannot write its status still did the work; losing the
            // file must not turn a working session into a failed one.
        }
        return status;
    };
    const credentials = readTransportCredentials(options.operationalDir);
    if (!credentials.available) {
        options.onPinnedEndpoint?.(null);
        return publish({
            phase: "NOT_ACTIVATED",
            detail: `no operational certificate yet (${credentials.detail})`,
            checkedAt: now().toISOString(),
        });
    }
    const candidates = [];
    const last = readLastEndpoint(lastEndpointPath);
    if (last !== null)
        candidates.push(last);
    const discovered = await (options.discover ??
        (() => discoverEdgeCandidates({
            ...(options.mdnsTimeoutMs === undefined ? {} : { timeoutMs: options.mdnsTimeoutMs }),
        })))();
    for (const candidate of discovered) {
        if (!candidates.some((c) => c.host === candidate.host && c.port === candidate.port)) {
            candidates.push(candidate);
        }
    }
    if (candidates.length === 0) {
        options.onPinnedEndpoint?.(null);
        return publish({
            phase: "NO_HUB_FOUND",
            detail: "no Store Hub answered on this network",
            checkedAt: now().toISOString(),
        });
    }
    let lastRefusal = null;
    let pinnedThisAttempt = false;
    const tracked = {
        ...options,
        onPinnedEndpoint: (endpoint) => {
            if (endpoint !== null)
                pinnedThisAttempt = true;
            options.onPinnedEndpoint?.(endpoint);
        },
    };
    for (const candidate of candidates) {
        const attempted = await attemptCandidate(candidate, credentials.credentials, tracked, call, now);
        // DEGRADED counts as reached: the endpoint is the right one and worth
        // remembering, and the thing that is wrong is on the Hub, not the address.
        if (attempted.phase === "SERVING" || attempted.phase === "DEGRADED") {
            try {
                atomicWriteJson(lastEndpointPath, { host: candidate.host, port: candidate.port }, 0o600);
            }
            catch {
                // Losing the hint costs one multicast query next time, nothing more.
            }
            return publish(attempted);
        }
        // A Hub that answered and refused is a more useful report than a Hub that
        // never answered, so it wins when several candidates fail.
        if (lastRefusal === null || attempted.phase !== "NO_HUB_FOUND")
            lastRefusal = attempted;
    }
    // No candidate produced a verified endpoint: the bridge must not keep
    // forwarding to one that an earlier attempt verified and this one could not.
    if (!pinnedThisAttempt)
        options.onPinnedEndpoint?.(null);
    return publish(lastRefusal ?? {
        phase: "NO_HUB_FOUND",
        detail: "no Store Hub answered on this network",
        checkedAt: now().toISOString(),
    });
}
async function attemptCandidate(candidate, credentials, options, call, now) {
    const checkedAt = now().toISOString();
    const base = {
        host: candidate.host,
        port: candidate.port,
        credentials,
        environment: options.environment,
    };
    let discovery;
    try {
        discovery = await call({ ...base, method: "GET", path: WELL_KNOWN_DISCOVERY_PATH });
    }
    catch (error) {
        return {
            phase: "NO_HUB_FOUND",
            detail: `${candidate.host}:${String(candidate.port)} did not complete a mutual-TLS handshake (${error instanceof Error ? error.message : "unknown"})`,
            checkedAt,
        };
    }
    if (discovery.status !== 200 || !isSignedDiscoveryPayload(discovery.body)) {
        return {
            phase: "HUB_REFUSED",
            detail: `the discovery record was HTTP ${String(discovery.status)} or malformed`,
            checkedAt,
        };
    }
    const verdict = checkRecord(discovery.body, {
        ...options.expectation,
        environment: options.environment,
        observedCertificateFingerprint: discovery.peerCertificateFingerprint,
    }, now());
    const hub = {
        host: candidate.host,
        port: candidate.port,
        hubDeviceId: discovery.body.record.hubDeviceId,
        certificateFingerprint: discovery.peerCertificateFingerprint,
        signature: "unverified",
        scopeChecked: verdict.scopeChecked,
    };
    if (!verdict.accepted) {
        return {
            phase: "HUB_REFUSED",
            detail: `${verdict.refusalCode ?? "DISCOVERY_MALFORMED"}: ${verdict.detail ?? "refused"}`,
            checkedAt,
            hub,
        };
    }
    const pinned = {
        ...base,
        pinnedCertificateFingerprint: discovery.peerCertificateFingerprint,
    };
    options.onPinnedEndpoint?.({
        host: candidate.host,
        port: candidate.port,
        certificateFingerprint: discovery.peerCertificateFingerprint,
        hubDeviceId: discovery.body.record.hubDeviceId,
    });
    const reads = {};
    let pairing;
    let notRecognized = false;
    const read = async (name, path) => {
        try {
            const response = await call({ ...pinned, method: "GET", path });
            if (response.status === 200)
                return "ok";
            const result = refusalResult(response.body);
            if (result === "TERMINAL_NOT_RECOGNIZED")
                notRecognized = true;
            return `${String(response.status)} ${result}`;
        }
        catch (error) {
            return `error: ${error instanceof Error ? error.message : "unknown"}`;
        }
    };
    reads.authorityTime = await read("authorityTime", AUTHORITY_TIME_PATH);
    reads.eligibility = await read("eligibility", ELIGIBILITY_PATH);
    // PAIRING_REQUIRED IS AN INSTRUCTION, NOT A DEAD END.
    //
    // The Hub is telling the terminal to do something it can do: pair. Doing it
    // here, once per attempt, is what makes the link self-healing — a terminal
    // that lost its pairing recovers on its own rather than needing a person.
    if (reads.eligibility.endsWith("PAIRING_REQUIRED")) {
        const profileCode = options.profileCodes?.[0];
        if (profileCode === undefined) {
            return {
                phase: "PAIRING_REFUSED",
                detail: "the Store Hub requires pairing, but this terminal holds no assigned profile to " +
                    "pair into; the cloud has not delivered its profile assignment",
                checkedAt,
                hub,
                reads: {
                    authorityTime: reads.authorityTime,
                    eligibility: reads.eligibility,
                    configuration: "-",
                },
            };
        }
        const outcome = await pairWithHub({
            call,
            base: pinned,
            requestedProfileCode: profileCode,
            nonceHex: randomBytes(32).toString("hex"),
            ...(options.identityKeyPath === undefined ? {} : { keyPath: options.identityKeyPath }),
        });
        pairing = outcome.paired
            ? { attempted: true, result: "PAIRED", profileCode: outcome.profileCode }
            : { attempted: true, result: outcome.result, profileCode };
        if (!outcome.paired) {
            return {
                phase: "PAIRING_REFUSED",
                detail: `the Store Hub refused to pair this terminal: ${outcome.result} (${outcome.detail})`,
                checkedAt,
                hub,
                reads: {
                    authorityTime: reads.authorityTime,
                    eligibility: reads.eligibility,
                    configuration: "-",
                },
                pairing,
            };
        }
        reads.eligibility = await read("eligibility", ELIGIBILITY_PATH);
    }
    reads.configuration = await read("configuration", CONFIGURATION_PATH);
    if (notRecognized) {
        return {
            phase: "NOT_RECOGNIZED",
            detail: "the Store Hub does not hold a projection for this terminal; the cloud has not " +
                "delivered its identity to the Hub (BLK-006)",
            checkedAt,
            hub,
            ...(pairing === undefined ? {} : { pairing }),
        };
    }
    const finalReads = {
        authorityTime: reads.authorityTime ?? "-",
        eligibility: reads.eligibility ?? "-",
        configuration: reads.configuration ?? "-",
    };
    const failed = Object.entries(finalReads).filter(([, value]) => value !== "ok");
    // A Hub-side dependency (503) is DEGRADED; anything else is a refusal aimed
    // at this terminal, and the two must not read the same to an operator.
    const onlyDependencies = failed.length > 0 && failed.every(([, value]) => value.startsWith("503 "));
    const phase = failed.length === 0 ? "SERVING" : onlyDependencies ? "DEGRADED" : "HUB_REFUSED";
    const where = `${candidate.host}:${String(candidate.port)}`;
    return {
        phase,
        detail: phase === "SERVING"
            ? `connected to Store Hub ${hub.hubDeviceId} at ${where}`
            : phase === "DEGRADED"
                ? `paired with Store Hub ${hub.hubDeviceId} at ${where}; the Hub cannot serve ${failed
                    .map(([name]) => name)
                    .join(", ")} yet`
                : `the Hub answered but refused ${failed.map(([name, value]) => `${name} (${value})`).join(", ")}`,
        checkedAt,
        hub,
        reads: finalReads,
        ...(pairing === undefined ? {} : { pairing }),
    };
}
//# sourceMappingURL=edge-session.js.map