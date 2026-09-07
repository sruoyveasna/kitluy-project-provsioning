/**
 * The Wi-Fi fallback screen, on the Store Hub console.
 *
 * ===========================================================================
 * WHEN AN INSTALLER SEES THIS: ALMOST NEVER
 * ===========================================================================
 * A Store Hub is installed on Ethernet. `awaitNetwork()` returns immediately
 * when a cable is live and KitLuy answers, and the installer goes straight to
 * the pairing prompt having seen no network screen at all — which is the
 * requirement, not a nice-to-have.
 *
 * This exists for the shop with no usable socket on installation day.
 *
 * ===========================================================================
 * WHY A KITLUY SCREEN AND NOT `nmtui`
 * ===========================================================================
 * A store installer is not a Linux administrator and must never be asked to
 * type `nmcli`, `wpa_cli`, `ip` or `systemctl`. They also must not be dropped
 * into a general Linux administration surface, which is what handing them a
 * distribution network tool amounts to: from `nmtui` there are paths to a
 * shell. This screen offers two verbs and no way out of them.
 *
 * ===========================================================================
 * THE PASSWORD IS NEVER SHOWN AND NEVER STORED HERE
 * ===========================================================================
 * Input is echoed as asterisks, so a passphrase does not sit on a wall-mounted
 * screen in a shop after the installer walks away. The string is handed to
 * `joinNetwork` and goes out of scope; this module writes no state file, and
 * nothing here reaches a log.
 */
import {
  isCloudReachable,
  joinNetwork,
  readNetworkStatus,
  scanAccessPoints,
  waitForWirelessCarrier,
  type AccessPoint,
  type NetworkStatus,
} from "../network.js";

const CLEAR_SCREEN = "[2J[H";

export interface ConsoleIo {
  write(text: string): void;
  /** One line of visible input. */
  question(prompt: string): Promise<string>;
  /** One line of input echoed as asterisks. */
  secret(prompt: string): Promise<string>;
}

/** Signal strength as three words rather than dBm, which means nothing in a shop. */
export function strengthLabel(signal: number): string {
  if (signal >= -60) return "strong";
  if (signal >= -75) return "medium";
  return "weak";
}

export function renderStatus(status: NetworkStatus): string {
  const wired = !status.wired.present
    ? "Not present"
    : status.wired.carrier
      ? "Connected"
      : "Not connected";
  const wireless = !status.wireless.present
    ? "Not present"
    : status.wireless.carrier
      ? "Connected"
      : status.wirelessConfigured
        ? "Configured, not connected"
        : "Not configured";
  return [
    "",
    "  KITLUY STORE HUB",
    "",
    `  Ethernet: ${wired}`,
    `  Wi-Fi:    ${wireless}`,
    "",
    "  1. Configure Wi-Fi",
    "  2. Retry Ethernet",
    "",
  ].join("\n");
}

export function renderNetworks(points: readonly AccessPoint[]): string {
  if (points.length === 0) {
    return "\n  No Wi-Fi networks found. Move closer to the router, or retry.\n\n";
  }
  const rows = points.slice(0, 9).map((p, i) => {
    const name = p.ssid.length > 24 ? `${p.ssid.slice(0, 23)}…` : p.ssid;
    return `  ${i + 1}. ${name.padEnd(26)}${strengthLabel(p.signal).padEnd(8)}${
      p.secured ? "secured" : "open"
    }`;
  });
  return [
    "",
    "  Available Wi-Fi Networks",
    "",
    ...rows,
    "",
    "  Enter a number, or 0 to go back.",
    "",
  ].join("\n");
}

/**
 * Hold the console until the Hub can reach KitLuy, offering Wi-Fi when it cannot.
 *
 * Returns `true` when the cloud is reachable. Returns `false` when the caller
 * should carry on regardless — there is no configured endpoint to test against,
 * and blocking the pairing prompt for ever on an unanswerable question would be
 * worse than letting the operator see it.
 */
export async function awaitNetwork(
  io: ConsoleIo,
  options: {
    readonly baseUrl?: string;
    /** Injected in tests; the real ones talk to sysfs and wpa_supplicant. */
    readonly status?: () => NetworkStatus;
    readonly scan?: () => Promise<AccessPoint[]>;
    readonly join?: typeof joinNetwork;
    readonly reachable?: (url: string) => Promise<boolean>;
    readonly settle?: () => Promise<boolean>;
    readonly maxRounds?: number;
    readonly pause?: (ms: number) => Promise<void>;
  } = {},
): Promise<boolean> {
  const status = options.status ?? ((): NetworkStatus => readNetworkStatus());
  const scan = options.scan ?? ((): Promise<AccessPoint[]> => scanAccessPoints());
  const join = options.join ?? joinNetwork;
  const reachable = options.reachable ?? ((url: string): Promise<boolean> => isCloudReachable(url));
  const settle = options.settle ?? ((): Promise<boolean> => waitForWirelessCarrier());
  const maxRounds = options.maxRounds ?? Number.POSITIVE_INFINITY;
  const pause =
    options.pause ?? ((ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)));

  const baseUrl = options.baseUrl;
  if (baseUrl === undefined) return false;

  for (let round = 0; round < maxRounds; round += 1) {
    const now = status();

    // THE HAPPY PATH, AND IT IS SILENT. A live link plus a reachable cloud means
    // the installer never learns this screen exists.
    if (now.hasLink && (await reachable(baseUrl))) return true;

    io.write(CLEAR_SCREEN);
    io.write(renderStatus(now));

    if (now.hasLink) {
      // Link but no cloud: a cable into a switch that goes nowhere, or a captive
      // portal. Reporting "connected" and stopping would be the unhelpful answer.
      io.write("  Connected to the local network, but KitLuy cannot be reached.\n\n");
    }

    const choice = (await io.question("  Choose 1 or 2: ")).trim();
    if (choice !== "1") continue;

    if (!now.wireless.present) {
      io.write("\n  This device has no Wi-Fi adapter. Use Ethernet.\n\n");
      await pause(4000);
      continue;
    }

    io.write("\n  Scanning…\n");
    const points = await scan().catch((): AccessPoint[] => []);
    io.write(CLEAR_SCREEN);
    io.write(renderNetworks(points));
    if (points.length === 0) {
      await pause(3000);
      continue;
    }

    const picked = Number.parseInt((await io.question("  > ")).trim(), 10);
    if (!Number.isInteger(picked) || picked < 1 || picked > Math.min(points.length, 9)) continue;
    const target = points[picked - 1]!;

    io.write(`\n  Wi-Fi network: ${target.ssid}\n`);
    const passphrase = target.secured ? await io.secret("  Password: ") : "";
    if (target.secured && passphrase === "") continue;

    io.write("\n  Connecting…\n");
    // The REAL bytes, not the printable form. `target.ssid` has had control
    // characters replaced so it can be shown on a console; storing that instead
    // of what the radio broadcast would configure a network that does not exist
    // and salt the derived key with the wrong value.
    const outcome = await join({ ssid: target.ssidBytes, passphrase });
    if (outcome.kind !== "joined") {
      // The reason never contains the passphrase — `joinNetwork` is written so
      // that it cannot.
      io.write(`\n  ${outcome.reason}\n  Nothing was saved. You can try again.\n\n`);
      await pause(4000);
      continue;
    }

    if (!(await settle())) {
      // Association silently retries for ever on a wrong key, so a timeout is
      // reported as the cause it almost always is, and the installer is invited
      // to retype rather than left watching a spinner.
      io.write("\n  Could not join that network. The password may be wrong.\n\n");
      await pause(4000);
      continue;
    }

    if (await reachable(baseUrl)) {
      io.write("\n  Connected.\n  KitLuy Cloud: Reachable\n\n  Continuing setup…\n\n");
      await pause(2500);
      return true;
    }
    io.write("\n  Joined the Wi-Fi, but KitLuy cannot be reached from it.\n\n");
    await pause(4000);
  }
  return false;
}
