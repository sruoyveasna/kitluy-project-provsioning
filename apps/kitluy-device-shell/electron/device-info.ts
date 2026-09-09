/**
 * The read-only facts a Settings screen shows about this board.
 *
 * Everything here is UNPRIVILEGED — files the Shell's own user can already read.
 * It deliberately does not go through the device-config broker: asking a root
 * process to read `/etc/hostname` would widen that broker's verb list for no
 * gain, and the whole argument for the broker is that its list stays short.
 *
 * These are the values an operator reads out over the phone when something is
 * wrong, and the ones we have repeatedly gone to SSH for. The device serial in
 * particular is what the fleet knows this board as.
 */
import { readFileSync } from "node:fs";
import { hostname } from "node:os";

export interface DeviceInfo {
  readonly hostname: string;
  /** The SoC serial. Survives a re-flash; it is what the fleet identifies. */
  readonly serial: string | null;
  readonly imageVersion: string | null;
  readonly deviceClass: string | null;
  readonly environment: string | null;
  readonly registrationUrl: string | null;
}

const IMAGE_ENV = "/etc/kitluy/image.env";
const SERIAL_DT = "/sys/firmware/devicetree/base/serial-number";

/**
 * Parse `KEY=value` lines the way the device's own shell scripts do.
 *
 * Quotes are stripped and comments ignored; a value that is empty stays empty
 * rather than becoming the string "". `image.env` deliberately ships some keys
 * blank so a reader sees `unknown` instead of an implicit default.
 */
export function parseImageEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** The device tree stores the serial NUL-terminated; /proc/cpuinfo is the fallback. */
export function readSerial(dtPath = SERIAL_DT, cpuinfoPath = "/proc/cpuinfo"): string | null {
  try {
    const raw = readFileSync(dtPath, "utf8").replace(/\0/g, "").trim();
    if (raw !== "") return raw;
  } catch {
    /* fall through to cpuinfo */
  }
  try {
    for (const line of readFileSync(cpuinfoPath, "utf8").split("\n")) {
      const match = /^Serial\s*:\s*(\S+)/i.exec(line.trim());
      if (match?.[1] !== undefined) return match[1];
    }
  } catch {
    /* no serial on this board */
  }
  return null;
}

export function readDeviceInfo(options: { readonly etcRoot?: string } = {}): DeviceInfo {
  const envPath = options.etcRoot === undefined ? IMAGE_ENV : `${options.etcRoot}/kitluy/image.env`;
  let env: Record<string, string> = {};
  try {
    env = parseImageEnv(readFileSync(envPath, "utf8"));
  } catch {
    // An unreadable image.env is a fact worth showing as blanks rather than an
    // error: the rest of this screen is still useful when it happens.
  }
  const value = (key: string): string | null => {
    const raw = env[key];
    return raw === undefined || raw === "" ? null : raw;
  };
  return {
    hostname: hostname(),
    serial: readSerial(),
    imageVersion: value("KITLUY_IMAGE_VERSION"),
    deviceClass: value("KITLUY_DEVICE_CLASS"),
    environment: value("KITLUY_ENVIRONMENT"),
    registrationUrl: value("KITLUY_REGISTRATION_URL"),
  };
}
