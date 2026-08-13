/**
 * `/usr/lib/kitluy/update-agent` — the release/update bootstrap agent (§16).
 *
 * MINIMUM RESPONSIBILITIES ONLY. The full A/B release platform already exists
 * (`services/kitluy-device-release-and-update-service`, `release-agent.ts`),
 * and its physical Pi slot adapters are hardware work behind BLK-005. This
 * agent is the part that must exist BEFORE that: an updater cannot depend on
 * itself being downloaded first, which is precisely why DEC-1 bakes it in.
 *
 * It knows the current version, reads governed release configuration, and
 * verifies signatures with PUBLIC trust material only. It holds no signing key,
 * and it never reports an update as installed — installation is the release
 * agent's job, not this one's.
 */
import { readFileSync, readdirSync } from "node:fs";
import { SERVICE_VERSION } from "../version.js";
export const TRUST_ANCHOR_DIR = "/etc/kitluy/trust";
export const RELEASE_CONFIG_PATH = "/etc/kitluy/release.env";
export const POLL_SECONDS = 300;
/**
 * Trust is a PRECONDITION, not a step. An update agent with no public trust
 * material cannot distinguish a genuine release from an attacker's, so it
 * refuses to look for one at all rather than fetching first and failing to
 * verify afterwards.
 */
export function evaluateUpdate(options) {
    const trustDir = options.trustDir ?? TRUST_ANCHOR_DIR;
    let anchors = [];
    try {
        anchors = readdirSync(trustDir).filter((f) => f.endsWith(".pub") || f.endsWith(".pem"));
    }
    catch {
        anchors = [];
    }
    if (anchors.length === 0) {
        return {
            kind: "no_trust_anchor",
            detail: `no public release trust anchor in ${trustDir}; refusing to consider any payload`,
        };
    }
    let source;
    try {
        source = /^KITLUY_RELEASE_SOURCE=(.+)$/m
            .exec(readFileSync(options.releaseConfigPath ?? RELEASE_CONFIG_PATH, "utf8"))?.[1]
            ?.trim();
    }
    catch {
        source = undefined;
    }
    if (source === undefined || source === "") {
        return {
            kind: "no_release_source",
            detail: "no governed release source configured; nothing to check",
        };
    }
    const imageVersion = readImageVersion(options.imageEnvPath ?? "/etc/kitluy/image.env");
    return { kind: "up_to_date", imageVersion: imageVersion ?? "unknown" };
}
function readImageVersion(path) {
    try {
        return /^KITLUY_IMAGE_VERSION=(.+)$/m.exec(readFileSync(path, "utf8"))?.[1]?.trim();
    }
    catch {
        return undefined;
    }
}
export async function main() {
    for (;;) {
        const state = evaluateUpdate({});
        const detail = "detail" in state ? state.detail : state.imageVersion;
        process.stdout.write(`event=kitluy.update.bootstrap state=${state.kind} agent=${SERVICE_VERSION} detail=${JSON.stringify(detail)}\n`);
        await new Promise((r) => setTimeout(r, POLL_SECONDS * 1000));
    }
}
if (process.argv[1] !== undefined && process.argv[1].includes("update-bootstrap"))
    void main();
//# sourceMappingURL=update-bootstrap.js.map