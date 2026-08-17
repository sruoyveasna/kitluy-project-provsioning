/**
 * `/etc/kitluy/image.env` — the image's own configuration, read by the device.
 *
 * Extracted from `bin/enrollment-bootstrap.ts` because the Hub pairing CLI needs
 * the SAME reader. Duplicating a config parser is how two programs on one device
 * end up disagreeing about where the fleet service lives, and this file is the
 * only thing that tells either of them.
 *
 * Deliberately not a dotenv library: this agent ships inside the golden image
 * with zero runtime dependencies, and `package-bootstrap-runtime.sh` refuses the
 * build if that stops being true.
 *
 * `etcRoot` exists so image configuration is testable off-device — nothing here
 * assumes it can read a real `/etc`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function imageEnvPath(etcRoot?: string): string {
  return join(etcRoot ?? "/etc", "kitluy", "image.env");
}

/**
 * The value for `key`, or undefined.
 *
 * An EMPTY value reads as undefined on purpose. The image writes bare keys like
 * `KITLUY_ENROLLMENT_BASE_URL=` when nothing configured one, and treating that
 * as the empty string would send a device to `""` and report a transport error
 * rather than the truth, which is that it was never configured.
 */
export function readImageEnv(key: string, etcRoot?: string): string | undefined {
  let text: string;
  try {
    text = readFileSync(imageEnvPath(etcRoot), "utf8");
  } catch {
    return undefined;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1 || trimmed.slice(0, separator) !== key) continue;
    const value = trimmed.slice(separator + 1).trim();
    return value.length === 0 ? undefined : value;
  }
  return undefined;
}
