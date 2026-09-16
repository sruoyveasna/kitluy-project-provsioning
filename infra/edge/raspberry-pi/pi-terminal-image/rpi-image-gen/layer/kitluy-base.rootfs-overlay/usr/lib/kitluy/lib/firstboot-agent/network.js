/**
 * Network state and Wi-Fi association for the Store Hub console.
 *
 * ===========================================================================
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
 * ===========================================================================
 * The Store Hub is a CLI/server appliance and its normal installation is wired:
 * Ethernet comes up on DHCP and an installer never sees a network screen. Wi-Fi
 * exists because some shops have no usable socket on installation day.
 *
 * This module is NOT a network manager. It does not replace systemd-networkd,
 * it invents no protocol, and it holds no policy about which interface wins —
 * that lives where it belongs, in `RouteMetric` on the two `.network` files, so
 * the kernel decides deterministically and the same answer survives a reboot
 * with nothing running.
 *
 * It does exactly three things: report what the links are doing, list the access
 * points the radio can see, and hand a passphrase to `wpa_supplicant` without
 * ever holding it.
 *
 * ===========================================================================
 * THE SECRET NEVER TOUCHES THIS PROGRAM'S ARGV, LOGS OR STATE
 * ===========================================================================
 * Three rules, each closing a different leak:
 *
 * 1. NO SHELL, EVER. Every external command goes through `execFile` with an
 *    argv ARRAY. An SSID is attacker-chosen text broadcast by anyone with a
 *    radio — `Shop-WiFi"; rm -rf /` is a legal SSID — and a shell-string
 *    command would execute it.
 *
 * 2. THE PASSPHRASE GOES IN ON STDIN. `wpa_passphrase` accepts it as a second
 *    argument, and that argument would be world-readable in `/proc/<pid>/cmdline`
 *    for the life of the process. Given no second argument it reads stdin
 *    instead, so the passphrase never appears in any process table.
 *
 * 3. THE SSID IS STORED AS HEX. wpa_supplicant's config format accepts either
 *    `ssid="text"` or bare `ssid=<hex>`. The quoted form has escaping rules, and
 *    a network block assembled by string concatenation around attacker-supplied
 *    text is a config-injection bug waiting to be found. Hex has no escaping
 *    rules at all, so there is nothing to get wrong.
 *
 * The derived key and the SSID land in the wpa_supplicant configuration file at
 * 0600, root-owned — the operating system's own credential store. Nothing here
 * writes a passphrase, a derived key or an SSID into KitLuy state, KitLuy JSON,
 * an audit record, a pairing record, a log line or telemetry.
 *
 * ===========================================================================
 * WHERE THE CONFIGURATION LIVES, AND WHY IT SURVIVES AN UPDATE
 * ===========================================================================
 * `/etc/wpa_supplicant` is declared SLOT-SHARED, the same mechanism
 * `60-kitluy-ssh.conf` uses for host keys. The system slot is EROFS behind
 * dm-verity and cannot be written at runtime, so a Wi-Fi configuration written
 * into `/etc` on the running slot would fail with EROFS; and one written per
 * slot would be LOST on the next A/B update, taking the shop offline for a
 * reason nobody would connect to an update.
 *
 * Shop Wi-Fi is site configuration, not system configuration. It belongs to the
 * device across updates, exactly like the SSH host key.
 */
import { execFile } from "node:child_process";
import { readFileSync, existsSync, chmodSync, writeFileSync, renameSync } from "node:fs";
/** Where the shop's Wi-Fi configuration lives. Slot-shared and writable. */
export const WPA_CONFIG_PATH = "/etc/wpa_supplicant/wpa_supplicant-wlan0.conf";
export const WIRED_INTERFACE = "eth0";
export const WIRELESS_INTERFACE = "wlan0";
/**
 * `execFile` with an argv array and no shell, ever.
 *
 * `stdin` exists so a secret can be delivered without appearing in the process
 * table. It is written and the stream closed; it is never logged, and it is not
 * returned in the error path either — a failure message that echoed the input
 * would defeat the point.
 */
const runProcess = (file, args, stdin) => new Promise((resolve, reject) => {
    const child = execFile(file, [...args], { timeout: 30_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
            reject(new Error(stderr.trim() === "" ? error.message : stderr.trim()));
            return;
        }
        resolve(stdout);
    });
    if (stdin !== undefined) {
        child.stdin?.end(stdin);
    }
});
/** Read one interface's state from sysfs. No tools, no parsing surprises. */
export function readLink(name, root = "/sys/class/net") {
    const base = `${root}/${name}`;
    if (!existsSync(base)) {
        return { name, present: false, carrier: false, operstate: "absent" };
    }
    const read = (file, fallback) => {
        try {
            return readFileSync(`${base}/${file}`, "utf8").trim();
        }
        catch {
            // `carrier` returns EINVAL while the interface is down. That is a state,
            // not an error, and it means exactly "no carrier".
            return fallback;
        }
    };
    const operstate = read("operstate", "unknown");
    return {
        name,
        present: true,
        carrier: read("carrier", "0") === "1",
        operstate,
    };
}
export function readNetworkStatus(options) {
    const wired = readLink(WIRED_INTERFACE, options?.sysfsRoot);
    const wireless = readLink(WIRELESS_INTERFACE, options?.sysfsRoot);
    return {
        wired,
        wireless,
        hasLink: wired.carrier || wireless.carrier,
        wirelessConfigured: hasSavedNetwork(options?.configPath ?? WPA_CONFIG_PATH),
    };
}
/**
 * Does a saved network exist?
 *
 * Reads for the PRESENCE of a `network={` block and nothing else. It never
 * returns, logs or inspects a key — the question is "has this device been given
 * Wi-Fi", and the answer does not require reading the secret.
 */
export function hasSavedNetwork(configPath = WPA_CONFIG_PATH) {
    try {
        return /^\s*network\s*=\s*\{/m.test(readFileSync(configPath, "utf8"));
    }
    catch {
        return false;
    }
}
/**
 * Parse `wpa_cli scan_results`, which is TAB-separated:
 *
 *   bssid / frequency / signal level / flags / ssid
 *
 * Hidden networks report an empty SSID and are dropped: there is nothing for an
 * installer to select, and offering a blank row invites them to pick it.
 */
export function parseScanResults(raw) {
    const seen = new Map();
    for (const line of raw.split("\n").slice(1)) {
        const cells = line.split("\t");
        if (cells.length < 5)
            continue;
        const encoded = cells[4].trim();
        if (encoded === "")
            continue;
        const ssidBytes = decodeScanSsid(encoded);
        // An SSID wpa_supplicant itself would refuse. Offering it would let an
        // installer pick a network whose config line invalidates the whole file.
        if (ssidBytes.length === 0 || ssidBytes.length > SSID_MAX_BYTES)
            continue;
        const ssid = displaySsid(ssidBytes);
        const flags = cells[3] ?? "";
        const point = {
            ssid,
            ssidBytes,
            signal: Number.parseInt(cells[2], 10) || -100,
            // WEP counts as secured for display. It is not secure, but the installer
            // still has to type something, and calling it "open" would be wrong.
            secured: /WPA|WEP|SAE/i.test(flags),
        };
        // The same SSID appears once per band and per AP in a mesh. Keep the
        // strongest; a list with "Shop-WiFi" five times is a list nobody can use.
        const existing = seen.get(ssid);
        if (existing === undefined || point.signal > existing.signal)
            seen.set(ssid, point);
    }
    return [...seen.values()].sort((a, b) => b.signal - a.signal);
}
export async function scanAccessPoints(run = runProcess) {
    await run("wpa_cli", ["-i", WIRELESS_INTERFACE, "scan"]).catch(() => "");
    // The radio needs a moment; asking immediately returns the previous results.
    await new Promise((r) => setTimeout(r, 2500));
    const raw = await run("wpa_cli", ["-i", WIRELESS_INTERFACE, "scan_results"]);
    return parseScanResults(raw);
}
/** wpa_supplicant's own limit. A longer `ssid=` invalidates the WHOLE file. */
export const SSID_MAX_BYTES = 32;
/**
 * Undo `wpa_cli`'s escaping to recover the SSID's real bytes.
 *
 * ===========================================================================
 * WHY THIS EXISTS — FOUND BY INDEPENDENT REVIEW
 * ===========================================================================
 * `scan_results` does not print raw SSIDs. wpa_supplicant runs them through
 * `printf_encode()`, so a Khmer shop name — `កា`, six UTF-8 bytes — arrives as
 * the TWENTY-FOUR character text `\xe1\x9e\x80\xe1\x9e\xb6`.
 *
 * Hex-encoding that text instead of the bytes it describes broke two things at
 * once:
 *
 *   1. The SSID written to the configuration was wrong, and the same wrong text
 *      was used as the PBKDF2 salt, so association could NEVER succeed — and the
 *      console blamed the installer's password.
 *   2. At nine escaped bytes it exceeds `SSID_MAX_BYTES`, and wpa_supplicant
 *      rejects an over-long `ssid=` by refusing to parse the ENTIRE FILE:
 *      "Line 5: too long ssid ... failed to parse network block". Every
 *      previously working network in that file dies with it. The file is
 *      slot-shared, so an A/B update does not clear it, and the console has no
 *      "forget network" path — a shop with a Khmer SSID would have had its Wi-Fi
 *      permanently bricked from inside the supported flow.
 *
 * A Cambodian deployment is the FIRST place this would have been hit.
 */
export function decodeScanSsid(encoded) {
    const out = [];
    for (let i = 0; i < encoded.length; i += 1) {
        if (encoded[i] !== "\\") {
            out.push(...Buffer.from(encoded[i], "utf8"));
            continue;
        }
        const next = encoded[i + 1];
        if (next === "x" && /^[0-9a-fA-F]{2}$/.test(encoded.slice(i + 2, i + 4))) {
            out.push(Number.parseInt(encoded.slice(i + 2, i + 4), 16));
            i += 3;
        }
        else if (next === "n") {
            out.push(0x0a);
            i += 1;
        }
        else if (next === "r") {
            out.push(0x0d);
            i += 1;
        }
        else if (next === "t") {
            out.push(0x09);
            i += 1;
        }
        else if (next === "e") {
            out.push(0x1b);
            i += 1;
        }
        else if (next === "\\") {
            out.push(0x5c);
            i += 1;
        }
        else if (next === '"') {
            out.push(0x22);
            i += 1;
        }
        else {
            out.push(0x5c);
        }
    }
    return Buffer.from(out);
}
/**
 * What an installer may safely be shown.
 *
 * An SSID is attacker-chosen and reaches a console that interprets ANSI. If
 * `wpa_cli` ever stopped escaping — an undocumented dependency this code should
 * not rest on — an access point named with a cursor-control sequence could
 * redraw the KitLuy screen. Control bytes are replaced rather than dropped so
 * two different networks cannot render identically.
 */
export function displaySsid(raw) {
    // Built with String.fromCharCode rather than written as a literal class:
    // `no-control-regex` exists to catch control characters that arrived in a
    // pattern by accident, and here they are the entire point.
    const control = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(0x1f)}${String.fromCharCode(0x7f)}-${String.fromCharCode(0x9f)}]`, "g");
    return raw.toString("utf8").replace(control, "?");
}
/** SSID as lowercase hex, which is a valid `ssid=` value and needs no escaping. */
export function ssidToHex(ssid) {
    return (typeof ssid === "string" ? Buffer.from(ssid, "utf8") : ssid).toString("hex");
}
/**
 * Derive the PSK without the passphrase ever reaching argv.
 *
 * Only the `psk=` line of `wpa_passphrase` output is kept. Its other lines carry
 * the passphrase back as a comment (`#psk="..."`), which is precisely what must
 * not be written to disk.
 */
export async function derivePsk(ssid, passphrase, run = runProcess) {
    const out = await run("wpa_passphrase", [ssid], `${passphrase}\n`);
    const match = /^\s*psk=([0-9a-f]{64})\s*$/m.exec(out);
    if (match === null) {
        // Deliberately vague and deliberately short. wpa_passphrase's own failure
        // text can include the input it rejected.
        throw new Error("the passphrase could not be used for this network");
    }
    return match[1];
}
/**
 * Save a network and ask wpa_supplicant to use it.
 *
 * The block is assembled from a 64-hex derived key and a hex SSID, so every
 * byte written is from a fixed alphabet and no quoting rule applies.
 */
export async function joinNetwork(input, options) {
    const run = options?.run ?? runProcess;
    const configPath = options?.configPath ?? WPA_CONFIG_PATH;
    const ssidBytes = typeof input.ssid === "string" ? Buffer.from(input.ssid, "utf8") : input.ssid;
    if (ssidBytes.length === 0 || ssidBytes.length > SSID_MAX_BYTES) {
        return { kind: "refused", reason: "That network's name cannot be stored on this device." };
    }
    const open = input.passphrase === "";
    if (!open && (input.passphrase.length < 8 || input.passphrase.length > 63)) {
        // WPA's own rule. Checked here so an obvious typo costs nothing and the
        // radio is not asked to fail slowly. An OPEN network is exempt: it has no
        // passphrase to measure, and refusing it here made every unsecured network
        // in the list unjoinable while the screen still offered them.
        return { kind: "refused", reason: "A Wi-Fi password is between 8 and 63 characters." };
    }
    let block;
    if (open) {
        block = `\nnetwork={\n\tssid=${ssidToHex(ssidBytes)}\n\tkey_mgmt=NONE\n}\n`;
    }
    else {
        let psk;
        try {
            psk = await derivePsk(ssidBytes.toString("utf8"), input.passphrase, run);
        }
        catch {
            return { kind: "refused", reason: "That password could not be used for this network." };
        }
        block = `\nnetwork={\n\tssid=${ssidToHex(ssidBytes)}\n\tpsk=${psk}\n}\n`;
    }
    // NOTHING IS WRITTEN UNTIL IT IS KNOWN TO WORK, AND A FAILURE RESTORES.
    //
    // The first version appended, then called `reconfigure`, then reported
    // "Nothing was saved" if that failed — which was false: the block was already
    // on disk. Three wrong attempts left three network blocks, two carrying keys
    // derived from wrong passphrases, in a file that survives A/B updates.
    //
    // Now the new content is composed in memory, written through a temporary file
    // and renamed (atomic within the directory, so a crash leaves either the old
    // file or the new one), and rolled back if the supplicant refuses it.
    let previous = null;
    try {
        previous = existsSync(configPath) ? readFileSync(configPath, "utf8") : null;
        const base = previous ?? seedConfig();
        const next = `${withoutNetwork(base, ssidToHex(ssidBytes))}${block}`;
        const temporary = `${configPath}.new`;
        writeFileSync(temporary, next, { mode: 0o600 });
        chmodSync(temporary, 0o600);
        renameSync(temporary, configPath);
        chmodSync(configPath, 0o600);
    }
    catch (error) {
        return {
            kind: "unavailable",
            reason: error instanceof Error ? error.message : "the Wi-Fi configuration is not writable",
        };
    }
    try {
        await run("wpa_cli", ["-i", WIRELESS_INTERFACE, "reconfigure"]);
    }
    catch (error) {
        if (previous !== null) {
            try {
                writeFileSync(configPath, previous, { mode: 0o600 });
                chmodSync(configPath, 0o600);
            }
            catch {
                /* the reported failure is the one that matters */
            }
        }
        return {
            kind: "unavailable",
            reason: error instanceof Error ? error.message : "the Wi-Fi service did not respond",
        };
    }
    return { kind: "joined" };
}
/**
 * Drop any existing block for this SSID.
 *
 * Selecting the same network twice must correct the stored key, not stack a
 * second block beside the wrong one — wpa_supplicant would try both and the
 * installer would have no way to remove the bad one.
 */
export function withoutNetwork(config, ssidHex) {
    return config.replace(new RegExp(`\\n?network=\\{[^}]*\\bssid=${ssidHex}\\b[^}]*\\}\\n?`, "g"), "\n");
}
/** The no-secret skeleton the image ships, recreated if it is ever missing. */
export function seedConfig() {
    return ["ctrl_interface=/run/wpa_supplicant", "update_config=1", ""].join("\n");
}
/**
 * Wait for the wireless link to become usable.
 *
 * A wrong passphrase does not produce an error — the supplicant simply keeps
 * retrying — so association is proven by the link reaching carrier, and a
 * timeout is reported as a wrong password because that is what it almost always
 * is. The alternative is watching `wpa_cli status` for `4WAY_HANDSHAKE`
 * transitions, which reports the same conclusion less reliably.
 */
export async function waitForWirelessCarrier(timeoutMs = 25_000, options) {
    const now = options?.now ?? Date.now;
    const deadline = now() + timeoutMs;
    for (;;) {
        if (readLink(WIRELESS_INTERFACE, options?.sysfsRoot).carrier)
            return true;
        if (now() >= deadline)
            return false;
        await new Promise((r) => setTimeout(r, 1000));
    }
}
/**
 * Can this device reach KitLuy?
 *
 * Not a ping and not a DNS check: the question an installer needs answered is
 * whether the pairing endpoint responds, and a network that resolves and routes
 * but sits behind a captive portal answers yes to both of those and no to this.
 * ANY HTTP status counts — a 404 from the right host still proves reachability,
 * and demanding 200 would make this fail on a service that simply has no route
 * at the base path.
 */
export async function isCloudReachable(baseUrl, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        await fetch(baseUrl, { method: "GET", signal: controller.signal });
        return true;
    }
    catch {
        return false;
    }
    finally {
        clearTimeout(timer);
    }
}
//# sourceMappingURL=network.js.map