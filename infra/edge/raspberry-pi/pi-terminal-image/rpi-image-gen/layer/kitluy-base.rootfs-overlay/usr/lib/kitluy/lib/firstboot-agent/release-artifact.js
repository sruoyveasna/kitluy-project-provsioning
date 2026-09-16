/**
 * Artifact transport — bytes only, and deliberately powerless.
 *
 * ===========================================================================
 * THIS IS NOT AN AUTHORITY, AND THE SHAPE OF THE INTERFACE SAYS SO
 * ===========================================================================
 * An artifact source is asked for the bytes of ONE release id that the caller
 * already holds a signed manifest for. There is no "what do you have?" call and
 * no "what is newest?" call, because adding one would make the transport a
 * deployment authority — which the owner ruled it must never be.
 *
 * Everything a source returns is checked against the manifest the ASSIGNMENT
 * carried: the total size, and the SHA-256 re-proven over the bytes actually
 * received. Object-storage metadata, HTTP headers, filenames and content-length
 * are never authority — the same discipline `release-cache.ts` records on the
 * Hub side ("the digest and size are re-proven over the DOWNLOADED bytes").
 *
 * ===========================================================================
 * RESUME, AND WHY THE OFFSET IS THE CALLER'S
 * ===========================================================================
 * A download that is interrupted resumes from a durable offset rather than
 * starting again, because a shop's uplink and a developer's Wi-Fi both drop.
 * The offset lives with the caller, so a source implementation stays a dumb
 * range reader with no state of its own to get wrong.
 */
import { createHash } from "node:crypto";
/** 256 KiB: large enough that a 280 KB payload is one or two reads, small
 * enough that a stalled transfer is noticed without a long timeout. */
export const ARTIFACT_CHUNK_BYTES = 256 * 1024;
/**
 * Fetch an artifact and prove it is the one the signed manifest describes.
 *
 * The size bound is enforced DURING the transfer, not after: a source that
 * keeps sending is stopped at the first byte past the declared size rather than
 * being allowed to fill the disk and then be rejected.
 */
export async function downloadAndVerify(source, manifest, options = {}) {
    const chunkBytes = options.chunkBytes ?? ARTIFACT_CHUNK_BYTES;
    const expected = manifest.artifactSizeBytes;
    const parts = [];
    let received = 0;
    if (options.resumeFrom !== undefined && options.resumeFrom.length > 0) {
        if (options.resumeFrom.length > expected) {
            return {
                ok: false,
                refusal: "ARTIFACT_OVERSIZED",
                detail: `resume buffer holds ${String(options.resumeFrom.length)} bytes, more than the declared ${String(expected)}`,
            };
        }
        parts.push(options.resumeFrom);
        received = options.resumeFrom.length;
    }
    while (received < expected) {
        const want = Math.min(chunkBytes, expected - received);
        let chunk;
        try {
            chunk = await source.fetchChunk(manifest.releaseId, received, want);
        }
        catch (error) {
            return {
                ok: false,
                refusal: "ARTIFACT_SOURCE_UNAVAILABLE",
                detail: String(error.message ?? error),
            };
        }
        if (chunk === null || chunk.length === 0) {
            return {
                ok: false,
                refusal: "ARTIFACT_TRUNCATED",
                detail: `the source stopped at ${String(received)} of ${String(expected)} bytes`,
            };
        }
        // A source returning more than it was asked for is stopped here rather than
        // trusted to be harmless.
        if (received + chunk.length > expected) {
            return {
                ok: false,
                refusal: "ARTIFACT_OVERSIZED",
                detail: `the source sent past the declared ${String(expected)} bytes`,
            };
        }
        parts.push(Buffer.from(chunk));
        received += chunk.length;
        options.onProgress?.(received, expected);
    }
    const bytes = Buffer.concat(parts, received);
    if (bytes.length !== expected) {
        return {
            ok: false,
            refusal: "ARTIFACT_SIZE_MISMATCH",
            detail: `received ${String(bytes.length)}, manifest declares ${String(expected)}`,
        };
    }
    // THE re-proof. Over the received bytes, never over anything the source said.
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== manifest.artifactDigestSha256) {
        return {
            ok: false,
            refusal: "ARTIFACT_DIGEST_MISMATCH",
            detail: `received bytes digest ${digest.slice(0, 16)}…, manifest declares ${manifest.artifactDigestSha256.slice(0, 16)}…`,
        };
    }
    return { ok: true, bytes };
}
//# sourceMappingURL=release-artifact.js.map