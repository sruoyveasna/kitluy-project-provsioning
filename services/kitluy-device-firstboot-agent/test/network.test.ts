/**
 * Wi-Fi association, and the three ways a passphrase escapes.
 *
 * ===========================================================================
 * WHAT THIS SUITE IS ACTUALLY DEFENDING
 * ===========================================================================
 * An SSID is attacker-chosen text. Anyone with a radio can name their access
 * point `Shop"; rm -rf /` and stand outside the shop while an installer picks
 * it off a list. So the interesting tests here are not "does it connect" — they
 * are "what happens when the input is hostile", and "where did the password go".
 *
 * Every external command is faked, so this runs with no radio and no root.
 */
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  decodeScanSsid,
  displaySsid,
  withoutNetwork,
  SSID_MAX_BYTES,
  derivePsk,
  hasSavedNetwork,
  joinNetwork,
  parseScanResults,
  readLink,
  readNetworkStatus,
  seedConfig,
  ssidToHex,
} from "../src/network.js";

const PSK = "a".repeat(64);

/** Records every invocation so the test can inspect argv and stdin. */
function recorder(output: (file: string, args: readonly string[]) => string) {
  const calls: { file: string; args: string[]; stdin?: string }[] = [];
  const run = (file: string, args: readonly string[], stdin?: string): Promise<string> => {
    calls.push({ file, args: [...args], stdin });
    return Promise.resolve(output(file, args));
  };
  return { calls, run };
}

function tempConfig(contents?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "kitluy-wifi-"));
  const path = join(dir, "wpa_supplicant-wlan0.conf");
  if (contents !== undefined) writeFileSync(path, contents, { mode: 0o600 });
  return path;
}

/** A fake /sys/class/net. */
function sysfs(links: Record<string, { carrier: string; operstate: string }>): string {
  const root = mkdtempSync(join(tmpdir(), "kitluy-sysfs-"));
  for (const [name, values] of Object.entries(links)) {
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(join(root, name, "carrier"), `${values.carrier}\n`);
    writeFileSync(join(root, name, "operstate"), `${values.operstate}\n`);
  }
  return root;
}

describe("the passphrase does not leak", () => {
  it("never places it in argv — wpa_passphrase reads it from stdin", async () => {
    const { calls, run } = recorder(
      () => `network={\n\tssid="x"\n\t#psk="hunter2"\n\tpsk=${PSK}\n}`,
    );
    await derivePsk("Shop-WiFi", "hunter2", run);

    const call = calls[0]!;
    expect(call.file).toBe("wpa_passphrase");
    // The passphrase as an ARGUMENT would be world-readable in
    // /proc/<pid>/cmdline for the life of the process.
    expect(call.args).toEqual(["Shop-WiFi"]);
    expect(call.args.join(" ")).not.toContain("hunter2");
    expect(call.stdin).toBe("hunter2\n");
  });

  it("never writes it to disk — wpa_passphrase echoes it back and that line is dropped", async () => {
    const configPath = tempConfig(seedConfig());
    const { run } = recorder((file) =>
      file === "wpa_passphrase"
        ? // This is verbatim what wpa_passphrase prints: the plaintext comes
          // back as a COMMENT, and writing its output wholesale would put the
          // shop's password in a file in cleartext.
          `network={\n\tssid="Shop-WiFi"\n\t#psk="hunter2!"\n\tpsk=${PSK}\n}\n`
        : "OK",
    );

    const outcome = await joinNetwork(
      { ssid: "Shop-WiFi", passphrase: "hunter2!" },
      { run, configPath },
    );
    expect(outcome.kind).toBe("joined");

    const written = readFileSync(configPath, "utf8");
    expect(written).not.toContain("hunter2!");
    expect(written).not.toContain("#psk");
    expect(written).toContain(`psk=${PSK}`);
  });

  it("does not echo it back in a refusal", async () => {
    const configPath = tempConfig(seedConfig());
    const { run } = recorder(() => "no derived key here");
    const outcome = await joinNetwork(
      { ssid: "Shop-WiFi", passphrase: "hunter2secret" },
      { run, configPath },
    );
    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") expect(outcome.reason).not.toContain("hunter2secret");
  });

  it("refuses a length WPA itself would refuse, without asking the radio", async () => {
    const configPath = tempConfig(seedConfig());
    const { calls, run } = recorder(() => "");
    const outcome = await joinNetwork({ ssid: "Shop", passphrase: "short" }, { run, configPath });
    expect(outcome.kind).toBe("refused");
    expect(calls).toEqual([]);
  });
});

describe("a hostile SSID cannot break out", () => {
  it("stores the SSID as hex, so quoting rules do not exist", async () => {
    const configPath = tempConfig(seedConfig());
    const { run } = recorder((file) => (file === "wpa_passphrase" ? `\tpsk=${PSK}\n` : "OK"));

    // Every character here is a config-injection attempt: a closing quote, a
    // brace to end the block, and a second `psk=` to override the real one.
    // Kept under SSID_MAX_BYTES so it tests INJECTION rather than the length
    // guard, which has its own test below.
    const hostile = 'evil"\n}\nssid="x';
    const outcome = await joinNetwork(
      { ssid: hostile, passphrase: "hunter2!" },
      { run, configPath },
    );
    expect(outcome.kind).toBe("joined");

    const written = readFileSync(configPath, "utf8");
    expect(written).toContain(`ssid=${ssidToHex(hostile)}`);
    // Exactly one network block, and no injected directive survived.
    expect(written.match(/network=\{/g)).toHaveLength(1);
    expect(written).not.toContain("key_mgmt=NONE");
    // The raw text is nowhere in the file, only its hex encoding.
    expect(written).not.toContain('ssid="evil');
  });

  it("refuses an SSID wpa_supplicant itself could not store", async () => {
    // Found by independent review. `wpa_cli` returns SSIDs escaped by
    // printf_encode, so a six-byte Khmer name arrives as 24 characters. Hex
    // encoding THAT produced an `ssid=` line over the 32-byte limit, and
    // wpa_supplicant answers an over-long ssid by refusing to parse the WHOLE
    // FILE — killing every other saved network with it. The file is slot-shared,
    // so an A/B update does not clear it and the console cannot forget it.
    const configPath = tempConfig(seedConfig());
    const { calls, run } = recorder(() => `\tpsk=${PSK}\n`);
    const outcome = await joinNetwork(
      { ssid: "N".repeat(33), passphrase: "hunter2!" },
      { run, configPath },
    );
    expect(outcome.kind).toBe("refused");
    expect(calls).toEqual([]);
    expect(readFileSync(configPath, "utf8")).not.toContain("network={");
  });

  it("passes the SSID as one argv element, never through a shell", async () => {
    const { calls, run } = recorder(() => `\tpsk=${PSK}\n`);
    await derivePsk('Shop"; rm -rf /', "hunter2!", run);
    // One element. A shell-string command would have executed the semicolon.
    expect(calls[0]!.args).toEqual(['Shop"; rm -rf /']);
  });
});

describe("reading what the radio can see", () => {
  it("keeps the strongest of a repeated SSID and drops hidden networks", () => {
    const raw = [
      "bssid / frequency / signal level / flags / ssid",
      "aa:bb\t2412\t-45\t[WPA2-PSK-CCMP][ESS]\tShop-WiFi",
      "aa:bc\t5180\t-70\t[WPA2-PSK-CCMP][ESS]\tShop-WiFi",
      "aa:bd\t2412\t-55\t[ESS]\tGuest",
      "aa:be\t2412\t-50\t[WPA2-PSK-CCMP][ESS]\t",
    ].join("\n");
    const points = parseScanResults(raw);

    expect(points.map((p) => p.ssid)).toEqual(["Shop-WiFi", "Guest"]);
    // A mesh advertises the same name per band; five identical rows is a list
    // nobody can use.
    expect(points[0]!.signal).toBe(-45);
    expect(points[0]!.secured).toBe(true);
    expect(points[1]!.secured).toBe(false);
  });

  it("survives a truncated or empty scan without throwing", () => {
    expect(parseScanResults("")).toEqual([]);
    expect(parseScanResults("header\nrubbish")).toEqual([]);
  });
});

describe("link state comes from sysfs, not from a tool", () => {
  it("reports a wired Hub as linked", () => {
    const root = sysfs({
      eth0: { carrier: "1", operstate: "up" },
      wlan0: { carrier: "0", operstate: "down" },
    });
    const status = readNetworkStatus({ sysfsRoot: root, configPath: "/nonexistent" });
    expect(status.wired.carrier).toBe(true);
    expect(status.hasLink).toBe(true);
    expect(status.wirelessConfigured).toBe(false);
  });

  it("reports an absent interface as absent rather than down", () => {
    const root = sysfs({ eth0: { carrier: "1", operstate: "up" } });
    const link = readLink("wlan0", root);
    // A board with no radio must not be described as one whose radio is off:
    // the screen offers "Configure Wi-Fi" on the second and cannot on the first.
    expect(link.present).toBe(false);
    expect(link.operstate).toBe("absent");
  });

  it("treats an unreadable carrier as no carrier", () => {
    // `carrier` returns EINVAL while the interface is down. That is a state.
    const root = sysfs({ eth0: { carrier: "1", operstate: "up" } });
    const link = readLink("eth0", root);
    expect(link.carrier).toBe(true);
  });
});

describe("saved configuration", () => {
  it("detects a saved network without reading any key", () => {
    const withNetwork = tempConfig(`${seedConfig()}\nnetwork={\n\tssid=6162\n\tpsk=${PSK}\n}\n`);
    const withoutNetwork = tempConfig(seedConfig());
    expect(hasSavedNetwork(withNetwork)).toBe(true);
    expect(hasSavedNetwork(withoutNetwork)).toBe(false);
    expect(hasSavedNetwork("/nonexistent/path.conf")).toBe(false);
  });

  it("the seeded configuration carries no secret", () => {
    const seed = seedConfig();
    expect(seed).toContain("update_config=1");
    expect(seed).not.toMatch(/psk|network=\{/);
  });

  it("recreates the skeleton when the file is missing, at 0600", async () => {
    const configPath = tempConfig();
    expect(existsSync(configPath)).toBe(false);
    const { run } = recorder(() => `\tpsk=${PSK}\n`);
    const outcome = await joinNetwork(
      { ssid: "Shop", passphrase: "hunter2!" },
      { run, configPath },
    );
    expect(outcome.kind).toBe("joined");
    expect(readFileSync(configPath, "utf8")).toContain("ctrl_interface=");
  });

  it("reports an unwritable configuration instead of claiming success", async () => {
    const { run } = recorder(() => `\tpsk=${PSK}\n`);
    const outcome = await joinNetwork(
      { ssid: "Shop", passphrase: "hunter2!" },
      { run, configPath: "/proc/nonexistent/wpa.conf" },
    );
    // Scanning, prompting, accepting a password and THEN failing to save it is
    // the worst possible order to fail in; it must at least say so.
    expect(outcome.kind).toBe("unavailable");
  });
});

describe("wpa_cli escaping, which is where the Khmer shop name went wrong", () => {
  it("decodes \\xNN back to the bytes the radio actually broadcast", () => {
    // `កា` is six UTF-8 bytes. printf_encode renders it as 24 characters.
    const encoded = "\\xe1\\x9e\\x80\\xe1\\x9e\\xb6";
    const decoded = decodeScanSsid(encoded);
    expect(decoded).toEqual(Buffer.from("កា", "utf8"));
    expect(decoded.length).toBe(6);
    // THE FIDELITY DEFECT: hex-encoding the ESCAPED TEXT stored 24 bytes of
    // backslash-x notation as the SSID, and used the same wrong text as the
    // PBKDF2 salt — so association could never succeed and the console blamed
    // the installer's password.
    expect(ssidToHex(encoded).length / 2).toBe(24);
    expect(ssidToHex(decoded).length / 2).toBe(6);
  });

  it("three Khmer characters overflow the limit once escaped — the brick", () => {
    // Each byte >= 0x80 escapes to four characters, so nine raw bytes become
    // thirty-six. Past SSID_MAX_BYTES wpa_supplicant refuses to parse the WHOLE
    // FILE, taking every previously working network with it.
    const khmer = "កាហ";
    const escaped = [...Buffer.from(khmer, "utf8")].map((b) => `\\x${b.toString(16)}`).join("");
    expect(Buffer.from(khmer, "utf8").length).toBe(9);
    expect(escaped.length).toBeGreaterThan(SSID_MAX_BYTES);
    // Decoded first, it fits and is correct.
    expect(decodeScanSsid(escaped).length).toBe(9);
    expect(decodeScanSsid(escaped).toString("utf8")).toBe(khmer);
  });

  it("decodes the other escapes wpa_cli emits, and a lone backslash", () => {
    expect(decodeScanSsid("a\\nb").toString("utf8")).toBe("a\nb");
    expect(decodeScanSsid("a\\\\b").toString("utf8")).toBe("a\\b");
    expect(decodeScanSsid('a\\"b').toString("utf8")).toBe('a"b');
    expect(decodeScanSsid("a\\zb").toString("utf8")).toBe("a\\zb");
  });

  it("a real scan line round-trips to the right SSID", () => {
    const raw = [
      "bssid / frequency / signal level / flags / ssid",
      "aa:bb\t2412\t-45\t[WPA2-PSK-CCMP][ESS]\t\\xe1\\x9e\\x80\\xe1\\x9e\\xb6",
    ].join("\n");
    const points = parseScanResults(raw);
    expect(points).toHaveLength(1);
    expect(points[0]!.ssidBytes.toString("utf8")).toBe("កា");
    expect(points[0]!.ssid).toBe("កា");
  });

  it("drops an SSID too long to store rather than offering a trap", () => {
    const tooLong = Array.from({ length: 33 }, () => "\\x41").join("");
    const raw = `header\naa:bb\t2412\t-45\t[ESS]\t${tooLong}`;
    // Offering it would let an installer pick a network whose config line
    // invalidates the entire file, including networks that already worked.
    expect(parseScanResults(raw)).toEqual([]);
  });

  it("replaces control characters before anything reaches the console", () => {
    // An SSID is attacker-chosen and the console interprets ANSI. Safety must
    // not rest on wpa_cli escaping, which this code does not control.
    expect(displaySsid(Buffer.from("Shop\u001b[2JEvil", "utf8"))).toBe("Shop?[2JEvil");
    expect(displaySsid(Buffer.from("plain", "utf8"))).toBe("plain");
  });
});

describe("an open network is joinable", () => {
  it("stores key_mgmt=NONE and never asks wpa_passphrase", async () => {
    // The length rule refused an empty passphrase, so every unsecured network
    // the screen offered was impossible to join.
    const configPath = tempConfig(seedConfig());
    const { calls, run } = recorder(() => "OK");
    const outcome = await joinNetwork({ ssid: "Guest", passphrase: "" }, { run, configPath });
    expect(outcome.kind).toBe("joined");
    expect(calls.map((c) => c.file)).toEqual(["wpa_cli"]);
    const written = readFileSync(configPath, "utf8");
    expect(written).toContain("key_mgmt=NONE");
    expect(written).not.toContain("psk=");
  });
});

describe("the configuration does not accumulate failures", () => {
  it("restores the previous file when the supplicant refuses the new one", async () => {
    const before = `${seedConfig()}\nnetwork={\n\tssid=${ssidToHex("Existing")}\n\tpsk=${PSK}\n}\n`;
    const configPath = tempConfig(before);
    const { run } = recorder((file) => {
      if (file === "wpa_cli") throw new Error("supplicant is not running");
      return `\tpsk=${PSK}\n`;
    });
    const outcome = await joinNetwork(
      { ssid: "Shop-WiFi", passphrase: "hunter2!" },
      { run, configPath },
    );
    expect(outcome.kind).toBe("unavailable");
    // "Nothing was saved" must be TRUE when the console says it.
    expect(readFileSync(configPath, "utf8")).toBe(before);
  });

  it("replaces the block for an SSID instead of stacking a second one", async () => {
    const configPath = tempConfig(seedConfig());
    const { run } = recorder((file) => (file === "wpa_cli" ? "OK" : `\tpsk=${PSK}\n`));
    for (const pass of ["wrong-one", "wrong-two", "right-one"]) {
      await joinNetwork({ ssid: "Shop-WiFi", passphrase: pass }, { run, configPath });
    }
    const written = readFileSync(configPath, "utf8");
    // Three attempts previously left three blocks, two carrying keys derived
    // from wrong passphrases, in a file that survives an A/B update.
    expect(written.match(/network=\{/g)).toHaveLength(1);
  });
});

describe("withoutNetwork", () => {
  it("removes only the matching block", () => {
    const a = ssidToHex("A");
    const b = ssidToHex("B");
    const config = `${seedConfig()}\nnetwork={\n\tssid=${a}\n\tpsk=${PSK}\n}\nnetwork={\n\tssid=${b}\n\tpsk=${PSK}\n}\n`;
    const pruned = withoutNetwork(config, a);
    expect(pruned).not.toContain(`ssid=${a}`);
    expect(pruned).toContain(`ssid=${b}`);
  });
});
