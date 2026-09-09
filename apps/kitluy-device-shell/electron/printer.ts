/**
 * Receipt-printer configuration and the test print that proves it.
 *
 * ===========================================================================
 * WHY THIS NEEDS NO PRIVILEGE, AND SO DOES NOT GO THROUGH THE BROKER
 * ===========================================================================
 * A network receipt printer is a TCP socket on port 9100 and a file under
 * `/var/lib/kitluy/terminal`, which is the Shell's own writable directory. Both
 * are things the Shell's unprivileged user can already do, so routing them
 * through the root broker would add power to that broker for nothing. The broker
 * exists for what the Shell genuinely cannot do; this is not that.
 *
 * USB printers ARE excluded for exactly this reason: reaching one means the `lp`
 * group or a udev rule, which is a privilege change and a separate decision. A
 * shop with a USB printer is not served by this screen yet, and the screen says
 * so rather than offering a control that silently fails.
 *
 * ===========================================================================
 * ESC/POS, NOT A DRIVER STACK
 * ===========================================================================
 * `@kitluy/printing` is a stub today, so there is no shared implementation to
 * call. This writes the handful of ESC/POS bytes a test print needs and nothing
 * more; it is not a printing subsystem and must not grow into one here. When the
 * POS application arrives with real receipt rendering, that is the code that
 * belongs in `@kitluy/printing`, and this screen should call it.
 */
import { connect } from "node:net";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const PRINTER_CONFIG_PATH = "/var/lib/kitluy/terminal/printer.json";
/** The near-universal RAW/JetDirect port for receipt printers. */
export const DEFAULT_PRINTER_PORT = 9100;
const CONNECT_TIMEOUT_MS = 8000;

export interface PrinterConfig {
  readonly kind: "network";
  readonly host: string;
  readonly port: number;
  /** What the shop calls it. Shown in the UI; never sent to the printer. */
  readonly label?: string;
}

export type PrinterResult =
  { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string };

/** IPv4/IPv6 literal or a hostname. Anything else is refused before we dial it. */
const HOST = /^[A-Za-z0-9._:-]{1,253}$/;

export function validateConfig(input: unknown): PrinterConfig | PrinterResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, code: "PRINTER_MALFORMED", message: "No printer details were given." };
  }
  const host = (input as { host?: unknown }).host;
  if (typeof host !== "string" || !HOST.test(host)) {
    return { ok: false, code: "PRINTER_HOST", message: "That printer address is not valid." };
  }
  const rawPort = (input as { port?: unknown }).port;
  const port =
    rawPort === undefined || rawPort === null || rawPort === ""
      ? DEFAULT_PRINTER_PORT
      : Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, code: "PRINTER_PORT", message: "That printer port is not valid." };
  }
  const label = (input as { label?: unknown }).label;
  const config: PrinterConfig = {
    kind: "network",
    host,
    port,
    ...(typeof label === "string" && label.trim() !== ""
      ? { label: label.trim().slice(0, 60) }
      : {}),
  };
  return config;
}

export function readPrinterConfig(path = PRINTER_CONFIG_PATH): PrinterConfig | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    const validated = validateConfig(parsed);
    // A file that has been edited into nonsense reads as "no printer" rather
    // than propagating a shape the rest of the Shell would have to defend
    // against. The operator can simply set it again.
    return "ok" in validated ? null : validated;
  } catch {
    return null;
  }
}

export function writePrinterConfig(config: PrinterConfig, path = PRINTER_CONFIG_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

/**
 * The bytes of a test receipt.
 *
 * Kept as a function so the test suite asserts the ESC/POS framing without
 * opening a socket: initialise, centre, print, feed, cut. A receipt that never
 * cuts leaves the shop tearing paper by hand and reading it as a fault.
 */
export function testReceiptBytes(now: Date, label?: string): Buffer {
  const ESC = 0x1b;
  const GS = 0x1d;
  const lines = [
    "KitLuy Terminal",
    "Test print",
    "",
    label === undefined ? "" : label,
    now.toISOString(),
    "",
    "If you can read this, the printer",
    "is reachable from this terminal.",
  ].filter((line, index, all) => !(line === "" && all[index - 1] === ""));
  return Buffer.concat([
    Buffer.from([ESC, 0x40]), // initialise
    Buffer.from([ESC, 0x61, 0x01]), // centre
    Buffer.from(lines.join("\n") + "\n", "ascii"),
    Buffer.from([ESC, 0x64, 0x04]), // feed 4 lines, so the cut clears the text
    Buffer.from([GS, 0x56, 0x00]), // full cut
  ]);
}

/** Open the printer, write the bytes, and report what happened. */
export function printTest(
  config: PrinterConfig,
  options: { readonly now?: Date; readonly timeoutMs?: number } = {},
): Promise<PrinterResult> {
  const timeoutMs = options.timeoutMs ?? CONNECT_TIMEOUT_MS;
  return new Promise<PrinterResult>((resolve) => {
    let settled = false;
    const finish = (result: PrinterResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const socket = connect({ host: config.host, port: config.port });
    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          code: "PRINTER_UNREACHABLE",
          // Names the address, because "check the printer" is useless to someone
          // holding two of them. The address is not a secret.
          message: `No answer from ${config.host}:${config.port}.`,
        }),
      timeoutMs,
    );
    socket.on("connect", () => {
      socket.end(testReceiptBytes(options.now ?? new Date(), config.label), () =>
        finish({ ok: true }),
      );
    });
    socket.on("error", () =>
      finish({
        ok: false,
        code: "PRINTER_UNREACHABLE",
        message: `No answer from ${config.host}:${config.port}.`,
      }),
    );
  });
}
