/**
 * Production `HardwareProbe` — Raspberry Pi binding and tamper signals.
 *
 * Authority: @kitluy/device-identity THE IDENTITY RULE; migration group 0120
 *   (`kitluy_devices.record_hardware_observation_v1`).
 *
 * ===========================================================================
 * THESE ARE EVIDENCE. THEY ARE NOT IDENTITY.
 * ===========================================================================
 * Nothing here is hashed into a device identity. The primary identity is the
 * opaque, server-generated `device_record_id`; these values are transmitted so
 * the SERVER can decide whether the hardware under a known identity changed.
 *
 * That distinction is the whole design. Derive identity from a board serial
 * and a repaired device becomes a different device while a cloned SD card
 * becomes the same one — exactly backwards from what a fleet needs.
 *
 * Every read is therefore best-effort: a missing signal yields `undefined`,
 * never a thrown error and never a fabricated placeholder. A device that
 * cannot read its own storage serial must still be able to enrol; the server
 * sees one fewer signal and weighs it accordingly.
 */
import { readFileSync, readdirSync } from "node:fs";
export class LinuxHardwareProbe {
    #sys;
    #proc;
    constructor(options = {}) {
        this.#sys = options.sysRoot ?? "/sys";
        this.#proc = options.procRoot ?? "/proc";
    }
    async collect() {
        // Built by explicit assignment rather than object spread so a signal is
        // present only when it was actually read.
        const signals = {};
        const mac = this.#macAddress();
        if (mac !== undefined)
            signals.macAddress = mac;
        const board = this.#deviceTreeSerial() ?? this.#cpuinfoSerial();
        if (board !== undefined)
            signals.boardSerial = board;
        // On a Pi the SoC serial IS the cpuinfo serial; it is reported under its
        // own name so the server can tell which source a value came from rather
        // than guessing from equality.
        const soc = this.#cpuinfoSerial();
        if (soc !== undefined)
            signals.socSerial = soc;
        const storage = this.#storage();
        if (storage.serial !== undefined)
            signals.storageSerial = storage.serial;
        if (storage.model !== undefined)
            signals.storageModel = storage.model;
        return signals;
    }
    #macAddress() {
        // Lowest-named non-loopback, non-virtual interface, chosen deterministically:
        // a probe that returns eth0 on one boot and wlan0 on the next would look
        // like a hardware change to the server every time Wi-Fi came up first.
        let interfaces;
        try {
            interfaces = readdirSync(`${this.#sys}/class/net`).sort();
        }
        catch {
            return undefined;
        }
        for (const name of interfaces) {
            if (name === "lo")
                continue;
            const address = readTrimmed(`${this.#sys}/class/net/${name}/address`);
            // 00:00:00:00:00:00 is what virtual and unconfigured devices report.
            if (address !== undefined && address !== "00:00:00:00:00:00")
                return address;
        }
        return undefined;
    }
    #deviceTreeSerial() {
        // The device tree exposes NUL-terminated strings.
        const raw = readTrimmed(`${this.#proc}/device-tree/serial-number`);
        return raw === undefined ? undefined : raw.replace(/\0/g, "").trim() || undefined;
    }
    #cpuinfoSerial() {
        const raw = readTrimmed(`${this.#proc}/cpuinfo`);
        if (raw === undefined)
            return undefined;
        for (const line of raw.split("\n")) {
            const match = /^Serial\s*:\s*(\S+)/.exec(line);
            if (match?.[1] !== undefined)
                return match[1];
        }
        return undefined;
    }
    #storage() {
        let blocks;
        try {
            blocks = readdirSync(`${this.#sys}/block`).sort();
        }
        catch {
            return {};
        }
        // mmcblk* first (the SD card a Pi boots from), then nvme/sd.
        const ordered = [
            ...blocks.filter((b) => b.startsWith("mmcblk")),
            ...blocks.filter((b) => b.startsWith("nvme")),
            ...blocks.filter((b) => b.startsWith("sd")),
        ];
        for (const block of ordered) {
            const base = `${this.#sys}/block/${block}/device`;
            const serial = readTrimmed(`${base}/serial`) ?? readTrimmed(`${base}/cid`);
            const model = readTrimmed(`${base}/name`) ?? readTrimmed(`${base}/model`);
            if (serial !== undefined || model !== undefined) {
                const out = {};
                if (serial !== undefined)
                    out.serial = serial;
                if (model !== undefined)
                    out.model = model;
                return out;
            }
        }
        return {};
    }
}
function readTrimmed(path) {
    try {
        const value = readFileSync(path, "utf8").trim();
        return value === "" ? undefined : value;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=linux-hardware-probe.js.map