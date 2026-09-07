/**
 * The installer's path through the console, scenario by scenario.
 *
 * ===========================================================================
 * THE PROPERTY THAT MATTERS MOST IS AN ABSENCE
 * ===========================================================================
 * On Ethernet the installer must see NO network screen. That is the normal
 * installation and the one nobody will ever report a bug about, so it is
 * asserted first and asserted as an absence: not a word written, not a question
 * asked.
 *
 * Everything is injected — sysfs, the radio, the cloud, the clock — so these run
 * with no hardware, no root and no waiting.
 */
import { describe, expect, it } from "vitest";

import {
  awaitNetwork,
  renderNetworks,
  renderStatus,
  strengthLabel,
} from "../src/bin/network-ui.js";
import type { ConsoleIo } from "../src/bin/network-ui.js";
import type { AccessPoint, NetworkStatus, WifiJoinOutcome } from "../src/network.js";

const BASE_URL = "https://fleet.example.invalid";

function link(present: boolean, carrier: boolean) {
  return { name: "x", present, carrier, operstate: carrier ? "routable" : "no-carrier" };
}

function status(options: {
  wired?: boolean;
  wirelessPresent?: boolean;
  wirelessCarrier?: boolean;
  configured?: boolean;
}): NetworkStatus {
  const wired = options.wired ?? false;
  const wirelessCarrier = options.wirelessCarrier ?? false;
  return {
    wired: link(true, wired),
    wireless: link(options.wirelessPresent ?? true, wirelessCarrier),
    hasLink: wired || wirelessCarrier,
    wirelessConfigured: options.configured ?? false,
  };
}

/** A console that answers from a script and records everything written. */
function fakeIo(answers: string[], secrets: string[] = []) {
  const written: string[] = [];
  const asked: string[] = [];
  const io: ConsoleIo = {
    write: (t) => void written.push(t),
    question: (p) => {
      asked.push(p);
      return Promise.resolve(answers.shift() ?? "");
    },
    secret: (p) => {
      asked.push(p);
      return Promise.resolve(secrets.shift() ?? "");
    },
  };
  return { io, written, asked, output: (): string => written.join("") };
}

const point = (ssid: string, signal: number, secured: boolean): AccessPoint => ({
  ssid,
  // The REAL bytes. The screen shows `ssid`; the configuration stores these.
  ssidBytes: Buffer.from(ssid, "utf8"),
  signal,
  secured,
});

const POINTS: AccessPoint[] = [
  point("Shop-WiFi", -45, true),
  point("HET-Network", -50, true),
  point("Guest", -70, false),
];

const noPause = (): Promise<void> => Promise.resolve();

describe("A. fresh Hub with Ethernet", () => {
  it("says nothing at all and goes straight to pairing", async () => {
    const { io, written, asked } = fakeIo([]);
    const result = await awaitNetwork(io, {
      baseUrl: BASE_URL,
      status: () => status({ wired: true }),
      reachable: () => Promise.resolve(true),
      pause: noPause,
      maxRounds: 3,
    });

    expect(result).toBe(true);
    // The whole requirement, as an absence.
    expect(written).toEqual([]);
    expect(asked).toEqual([]);
  });
});

describe("B. fresh Hub with no Ethernet", () => {
  it("offers Wi-Fi, scans, takes a password and continues to pairing", async () => {
    const joined: { ssid: string | Buffer; passphrase: string }[] = [];
    const { io, output } = fakeIo(["1", "1"], ["shop-secret-1"]);
    let carrier = false;

    const result = await awaitNetwork(io, {
      baseUrl: BASE_URL,
      status: () => status({ wired: false, wirelessCarrier: carrier }),
      scan: () => Promise.resolve(POINTS),
      join: (input): Promise<WifiJoinOutcome> => {
        joined.push({ ...input });
        carrier = true;
        return Promise.resolve({ kind: "joined" });
      },
      settle: () => Promise.resolve(true),
      reachable: () => Promise.resolve(carrier),
      pause: noPause,
      maxRounds: 4,
    });

    expect(result).toBe(true);
    expect(joined).toHaveLength(1);
    expect(joined[0]!.passphrase).toBe("shop-secret-1");
    // BYTES, not the printable form: `ssid` has had control characters replaced
    // so it can be shown, and storing that would configure a different network.
    expect(Buffer.from(joined[0]!.ssid as Buffer).toString("utf8")).toBe("Shop-WiFi");

    const text = output();
    expect(text).toContain("Ethernet: Not connected");
    expect(text).toContain("Shop-WiFi");
    expect(text).toContain("KitLuy Cloud: Reachable");
    // THE SECRET IS NOT ON THE SCREEN. It is echoed as asterisks by the caller's
    // `secret()` and never reprinted by this module.
    expect(text).not.toContain("shop-secret-1");
  });

  it("shows secured and open networks distinctly, and never asks for an open one's password", async () => {
    const joined: { ssid: string | Buffer; passphrase: string }[] = [];
    const { io, asked } = fakeIo(["1", "3"], []);
    let carrier = false;

    await awaitNetwork(io, {
      baseUrl: BASE_URL,
      status: () => status({ wired: false, wirelessCarrier: carrier }),
      scan: () => Promise.resolve(POINTS),
      join: (input): Promise<WifiJoinOutcome> => {
        joined.push({ ...input });
        carrier = true;
        return Promise.resolve({ kind: "joined" });
      },
      settle: () => Promise.resolve(true),
      reachable: () => Promise.resolve(carrier),
      pause: noPause,
      maxRounds: 4,
    });

    expect(joined).toHaveLength(1);
    expect(Buffer.from(joined[0]!.ssid as Buffer).toString("utf8")).toBe("Guest");
    expect(joined[0]!.passphrase).toBe("");
    expect(asked.filter((a) => a.includes("Password"))).toEqual([]);
  });
});

describe("C. a bad Wi-Fi password", () => {
  it("fails safely, invites a retry, and leaks nothing", async () => {
    const { io, output } = fakeIo(["1", "1", "2"], ["wrong-password-1"]);

    const result = await awaitNetwork(io, {
      baseUrl: BASE_URL,
      status: () => status({ wired: false }),
      scan: () => Promise.resolve(POINTS),
      join: () => Promise.resolve<WifiJoinOutcome>({ kind: "joined" }),
      // The supplicant retries a wrong key for ever rather than reporting it, so
      // failure surfaces as a link that never comes up.
      settle: () => Promise.resolve(false),
      reachable: () => Promise.resolve(false),
      pause: noPause,
      maxRounds: 2,
    });

    expect(result).toBe(false);
    const text = output();
    expect(text).toContain("The password may be wrong");
    expect(text).not.toContain("wrong-password-1");
    // It came back to the menu rather than dying on the failure.
    expect(text).toContain("1. Configure Wi-Fi");
  });

  it("reports a refusal from the join without echoing the input", async () => {
    const { io, output } = fakeIo(["1", "1"], ["short"]);

    await awaitNetwork(io, {
      baseUrl: BASE_URL,
      status: () => status({ wired: false }),
      scan: () => Promise.resolve(POINTS),
      join: () =>
        Promise.resolve<WifiJoinOutcome>({
          kind: "refused",
          reason: "A Wi-Fi password is between 8 and 63 characters.",
        }),
      settle: () => Promise.resolve(false),
      reachable: () => Promise.resolve(false),
      pause: noPause,
      maxRounds: 1,
    });

    const text = output();
    expect(text).toContain("between 8 and 63 characters");
    expect(text).toContain("Nothing was saved");
  });
});

describe("D. Ethernet restored after Wi-Fi was configured", () => {
  it("is accepted immediately, and the saved Wi-Fi is not touched", async () => {
    const joined: unknown[] = [];
    const { io, written } = fakeIo([]);

    const result = await awaitNetwork(io, {
      baseUrl: BASE_URL,
      // A Hub that HAS Wi-Fi saved, now on a cable.
      status: () => status({ wired: true, configured: true }),
      join: (input) => {
        joined.push(input);
        return Promise.resolve<WifiJoinOutcome>({ kind: "joined" });
      },
      reachable: () => Promise.resolve(true),
      pause: noPause,
      maxRounds: 3,
    });

    expect(result).toBe(true);
    expect(written).toEqual([]);
    // Nothing re-saved, nothing forgotten. Which interface actually CARRIES the
    // traffic is decided by RouteMetric in the .network files, not here.
    expect(joined).toEqual([]);
  });
});

describe("the edges an installer will find", () => {
  it("does not offer Wi-Fi on a board with no radio", async () => {
    const { io, output } = fakeIo(["1", "1"]);
    await awaitNetwork(io, {
      baseUrl: BASE_URL,
      status: () => status({ wired: false, wirelessPresent: false }),
      reachable: () => Promise.resolve(false),
      pause: noPause,
      maxRounds: 1,
    });
    expect(output()).toContain("no Wi-Fi adapter");
  });

  it("distinguishes a live link that cannot reach KitLuy", async () => {
    const { io, output } = fakeIo(["2"]);
    await awaitNetwork(io, {
      baseUrl: BASE_URL,
      status: () => status({ wired: true }),
      reachable: () => Promise.resolve(false),
      pause: noPause,
      maxRounds: 1,
    });
    // A cable into a switch that goes nowhere, or a captive portal. "Connected"
    // alone would send the installer looking in the wrong place.
    expect(output()).toContain("KitLuy cannot be reached");
  });

  it("carries on rather than blocking when the image has no endpoint", async () => {
    const { io, written } = fakeIo([]);
    // Nothing to test reachability against; holding the pairing prompt for ever
    // on an unanswerable question would be worse than showing it.
    expect(await awaitNetwork(io, { baseUrl: undefined })).toBe(false);
    expect(written).toEqual([]);
  });

  it("survives a scan that throws", async () => {
    const { io, output } = fakeIo(["1", "1"]);
    await awaitNetwork(io, {
      baseUrl: BASE_URL,
      status: () => status({ wired: false }),
      scan: () => Promise.reject(new Error("radio is busy")),
      reachable: () => Promise.resolve(false),
      pause: noPause,
      maxRounds: 1,
    });
    expect(output()).toContain("No Wi-Fi networks found");
  });

  it("ignores an out-of-range selection instead of picking something", async () => {
    const joined: unknown[] = [];
    const { io } = fakeIo(["1", "99"]);
    await awaitNetwork(io, {
      baseUrl: BASE_URL,
      status: () => status({ wired: false }),
      scan: () => Promise.resolve(POINTS),
      join: (i) => {
        joined.push(i);
        return Promise.resolve<WifiJoinOutcome>({ kind: "joined" });
      },
      reachable: () => Promise.resolve(false),
      pause: noPause,
      maxRounds: 1,
    });
    expect(joined).toEqual([]);
  });
});

describe("what the screen says", () => {
  it("names the three link states an installer can act on", () => {
    expect(renderStatus(status({ wired: true }))).toContain("Ethernet: Connected");
    expect(renderStatus(status({ wired: false }))).toContain("Ethernet: Not connected");
    expect(renderStatus(status({ wirelessPresent: false }))).toContain("Wi-Fi:    Not present");
    expect(renderStatus(status({ configured: true }))).toContain(
      "Wi-Fi:    Configured, not connected",
    );
  });

  it("reports strength in words, because dBm means nothing in a shop", () => {
    expect(strengthLabel(-45)).toBe("strong");
    expect(strengthLabel(-70)).toBe("medium");
    expect(strengthLabel(-85)).toBe("weak");
  });

  it("numbers the networks and marks which need a password", () => {
    const text = renderNetworks(POINTS);
    expect(text).toContain("1. Shop-WiFi");
    expect(text).toMatch(/Shop-WiFi\s+strong\s+secured/);
    expect(text).toMatch(/Guest\s+medium\s+open/);
  });

  it("says so plainly when the radio found nothing", () => {
    expect(renderNetworks([])).toContain("No Wi-Fi networks found");
  });
});
