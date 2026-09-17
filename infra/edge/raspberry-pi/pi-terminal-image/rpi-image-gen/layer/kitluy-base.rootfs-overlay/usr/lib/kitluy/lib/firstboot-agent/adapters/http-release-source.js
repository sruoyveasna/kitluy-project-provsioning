/**
 * The device's HTTP client for a release source.
 *
 * ===========================================================================
 * TWO CLIENTS, ONE CONNECTION — AND WHY THAT IS NOT A COLLAPSE
 * ===========================================================================
 * `AssignmentSource` and `ArtifactSource` are separate interfaces because they
 * carry different authority: the first decides WHAT this device may install,
 * the second only moves bytes. In U1 both happen to be answered by the same
 * development service, and it would be easy to read that as the split not being
 * real.
 *
 * It is real, and it is visible here: `fetchAssignment` reads a manifest and a
 * signature it does not trust, and `fetchChunk` is given a release id and an
 * offset by the CALLER. There is no method that asks the source what it has, and
 * no method that lets the source influence which release is chosen. At U4 the
 * Store Hub replaces this class for both interfaces and nothing above changes.
 *
 * ===========================================================================
 * THIS CLIENT TRUSTS NOTHING IT RECEIVES
 * ===========================================================================
 * It parses shapes and refuses malformed ones — and that is ALL it does. It
 * verifies no signature, checks no digest and compares no version. Those are the
 * caller's, deliberately: a transport that also validates is a transport that
 * can be argued into validating differently. Everything here is re-decided by
 * `release-install.ts` against the device's own trust registry and `image.env`.
 *
 * ===========================================================================
 * NO REDIRECTS
 * ===========================================================================
 * A redirect is a source telling the device where to look, which is the one
 * thing a byte transport must not get to do. `node:http` does not follow them on
 * its own; this refuses them explicitly so that stays true if the client is ever
 * swapped for one that does.
 */
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { URL } from "node:url";
const DEFAULT_TIMEOUT_MS = 15_000;
/** A response larger than this is refused before it is buffered. */
const MAX_JSON_BYTES = 256 * 1024;
export class ReleaseSourceError extends Error {
    constructor(message) {
        super(message);
        this.name = "ReleaseSourceError";
    }
}
function fetchRaw(url, options) {
    return new Promise((resolve, reject) => {
        let parsed;
        try {
            parsed = new URL(url);
        }
        catch {
            reject(new ReleaseSourceError(`the release source URL is malformed: ${url}`));
            return;
        }
        const send = parsed.protocol === "https:" ? httpsRequest : httpRequest;
        const req = send(parsed, {
            method: "GET",
            headers: options.range === undefined ? {} : { range: options.range },
            timeout: options.timeoutMs,
        }, (res) => {
            const status = res.statusCode ?? 0;
            if (status >= 300 && status < 400) {
                res.resume();
                reject(new ReleaseSourceError(`the release source answered a redirect (${String(status)}); a byte transport does not get to say where to look`));
                return;
            }
            const chunks = [];
            let received = 0;
            res.on("data", (chunk) => {
                received += chunk.length;
                if (received > options.maxBytes) {
                    req.destroy();
                    reject(new ReleaseSourceError(`the response passed ${String(options.maxBytes)} bytes`));
                    return;
                }
                chunks.push(chunk);
            });
            res.on("end", () => {
                resolve({ status, body: Buffer.concat(chunks), headers: res.headers });
            });
        });
        req.on("timeout", () => {
            req.destroy();
            reject(new ReleaseSourceError(`the release source did not answer within ${String(options.timeoutMs)}ms`));
        });
        req.on("error", (error) => {
            reject(new ReleaseSourceError(String(error.message ?? error)));
        });
        req.end();
    });
}
function asString(value) {
    return typeof value === "string" && value !== "" ? value : null;
}
function asInteger(value) {
    return typeof value === "number" && Number.isInteger(value) ? value : null;
}
/**
 * Parse an assignment, refusing any shape that is not exactly right.
 *
 * Strict on purpose. A half-parsed manifest whose missing field defaults to
 * `undefined` would change the canonical bytes and fail signature verification
 * with `SIGNATURE_INVALID` — a true statement that sends the reader looking at
 * the signing key rather than at the wire.
 */
export function parseAssignment(payload) {
    if (typeof payload !== "object" || payload === null) {
        throw new ReleaseSourceError("the assignment response is not an object");
    }
    const assignment = payload.assignment;
    if (assignment === null || assignment === undefined)
        return null;
    if (typeof assignment !== "object") {
        throw new ReleaseSourceError("the assignment is not an object");
    }
    const record = assignment;
    const sequence = asInteger(record["assignmentSequence"]);
    const releaseId = asString(record["releaseId"]);
    const assignmentId = asString(record["assignmentId"]);
    const deviceId = asString(record["deviceId"]);
    const environment = asString(record["environment"]);
    const rawManifest = record["manifest"];
    const rawEnvelope = record["envelope"];
    const rawAssignmentEnvelope = record["assignmentEnvelope"];
    if (sequence === null || releaseId === null) {
        throw new ReleaseSourceError("the assignment lacks a sequence or a release id");
    }
    // Group 0222: these four are what the assignment signature binds. A response
    // missing any of them cannot be verified, so it is refused here rather than
    // carried forward as an assignment that will fail for an unclear reason.
    if (assignmentId === null || deviceId === null || environment === null) {
        throw new ReleaseSourceError("the assignment lacks its binding (assignmentId, deviceId, environment)");
    }
    if (typeof rawAssignmentEnvelope !== "object" || rawAssignmentEnvelope === null) {
        throw new ReleaseSourceError("the assignment lacks its own signature envelope");
    }
    if (typeof rawManifest !== "object" || rawManifest === null) {
        throw new ReleaseSourceError("the assignment lacks a manifest");
    }
    if (typeof rawEnvelope !== "object" || rawEnvelope === null) {
        throw new ReleaseSourceError("the assignment lacks a signature envelope");
    }
    const m = rawManifest;
    const e = rawEnvelope;
    const manifest = {
        manifestVersion: asInteger(m["manifestVersion"]) ?? -1,
        releaseId: asString(m["releaseId"]) ?? "",
        productKey: asString(m["productKey"]) ?? "",
        version: asString(m["version"]) ?? "",
        buildId: asString(m["buildId"]) ?? "",
        architecture: asString(m["architecture"]) ?? "",
        hardwareProfile: asString(m["hardwareProfile"]) ?? "",
        environment: asString(m["environment"]) ?? "",
        channel: asString(m["channel"]) ?? "",
        artifactDigestSha256: asString(m["artifactDigestSha256"]) ?? "",
        artifactSizeBytes: asInteger(m["artifactSizeBytes"]) ?? -1,
        minSchemaVersion: asInteger(m["minSchemaVersion"]) ?? -1,
        maxSchemaVersion: asInteger(m["maxSchemaVersion"]) ?? -1,
        configPrerequisiteVersion: asInteger(m["configPrerequisiteVersion"]) ?? -1,
        // The ONLY field allowed to be empty: no rollback target is a real state.
        rollbackReleaseId: typeof m["rollbackReleaseId"] === "string" ? m["rollbackReleaseId"] : "",
    };
    const envelope = {
        keyId: asString(e["keyId"]) ?? "",
        keyVersion: asInteger(e["keyVersion"]) ?? -1,
        algorithm: "ed25519",
        signature: asString(e["signature"]) ?? "",
    };
    if (asString(e["algorithm"]) !== "ed25519") {
        throw new ReleaseSourceError(`unsupported signature algorithm ${String(e["algorithm"])}`);
    }
    const a = rawAssignmentEnvelope;
    const assignmentEnvelope = {
        keyId: asString(a["keyId"]) ?? "",
        keyVersion: asInteger(a["keyVersion"]) ?? -1,
        algorithm: "ed25519",
        signature: asString(a["signature"]) ?? "",
    };
    if (asString(a["algorithm"]) !== "ed25519") {
        throw new ReleaseSourceError(`unsupported assignment signature algorithm ${String(a["algorithm"])}`);
    }
    return {
        assignmentId,
        deviceId,
        environment,
        assignmentSequence: sequence,
        releaseId,
        manifest,
        envelope,
        assignmentEnvelope,
    };
}
export function createHttpReleaseSource(options) {
    const base = options.baseUrl.replace(/\/+$/u, "");
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return {
        describe: () => base,
        async fetchAssignment() {
            const productQuery = options.product === undefined ? "" : `&product=${encodeURIComponent(options.product)}`;
            const url = `${base}/release/v1/assignment?device=${encodeURIComponent(options.deviceRef)}${productQuery}`;
            const response = await fetchRaw(url, { timeoutMs, maxBytes: MAX_JSON_BYTES });
            // 404 is "this stack does not know me" — a freshly flashed terminal polls
            // before it is approved, and that is not a fault to report as one.
            if (response.status === 404)
                return null;
            if (response.status !== 200) {
                throw new ReleaseSourceError(`the assignment authority answered ${String(response.status)}`);
            }
            let payload;
            try {
                payload = JSON.parse(response.body.toString("utf8"));
            }
            catch {
                throw new ReleaseSourceError("the assignment response is not JSON");
            }
            return parseAssignment(payload);
        },
        async fetchChunk(releaseId, offset, maxBytes) {
            const url = `${base}/release/v1/artifact/${encodeURIComponent(releaseId)}`;
            const response = await fetchRaw(url, {
                timeoutMs,
                range: `bytes=${String(offset)}-${String(offset + maxBytes - 1)}`,
                // One chunk plus slack. A source that ignores the range and sends the
                // whole artifact is stopped here rather than buffered entirely.
                maxBytes: maxBytes * 2,
            });
            if (response.status === 404) {
                throw new ReleaseSourceError(`the source has no artifact for ${releaseId}`);
            }
            if (response.status !== 200 && response.status !== 206) {
                throw new ReleaseSourceError(`the artifact source answered ${String(response.status)}`);
            }
            if (response.body.length === 0)
                return null;
            // A source that ignored the range and replied 200 with the whole artifact
            // still works: take the window the caller asked for and no more.
            const slice = response.status === 200 && offset > 0
                ? response.body.subarray(offset, offset + maxBytes)
                : response.body.subarray(0, maxBytes);
            return slice.length === 0 ? null : new Uint8Array(slice);
        },
    };
}
//# sourceMappingURL=http-release-source.js.map