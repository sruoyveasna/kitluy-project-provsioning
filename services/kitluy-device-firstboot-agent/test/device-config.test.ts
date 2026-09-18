/**
 * The device-configuration broker is a PRIVILEGE BOUNDARY, so most of this file
 * is about what it refuses.
 *
 * On the other side of this socket is a root process on a till. On this side is
 * an Electron renderer. Every test below is a property that has to hold for that
 * arrangement to be defensible: a closed verb list, no passphrase in any output,
 * bounded input, and no privileged call attempted on a request that was never
 * valid in the first place.
 */
import { describe, expect, it, vi } from "vitest";

import {
  MAX_REQUEST_BYTES,
  VERBS,
  handle,
  parseRequest,
  serve,
  toAccessPointDto,
} from "../src/device-config.js";

const PSK = "correct-horse-battery";
const SSID_HEX = Buffer.from("KitLuy-Shop", "utf8").toString("hex");
/** A real ESC byte, the way an attacker would smuggle colour into a journal. */
const ESC = String.fromCharCode(27);

describe("the verb list is closed", () => {
  it("refuses a verb that is not on the list, and never runs anything", async () => {
    const join = vi.fn();
    const res = await serve(JSON.stringify({ verb: "network.exec" }), { join });
    expect(res).toMatchObject({ ok: false, code: "UNKNOWN_VERB" });
    expect(join).not.toHaveBeenCalled();
  });

  it.each(["shell", "exec", "network.join; rm -rf /", "__proto__", "constructor"])(
    "refuses %j",
    async (verb) => {
      const res = await serve(JSON.stringify({ verb }));
      expect(res).toMatchObject({ ok: false });
      expect((res as { code: string }).code).not.toBe("FAILED");
    },
  );

  it("does not echo an unprintable verb back into the journal", async () => {
    const res = (await serve(JSON.stringify({ verb: `a ${ESC}[31mred` }))) as { message: string };
    expect(res.message).toContain("(unprintable)");
    expect(res.message).not.toContain(ESC);
  });

  it("lists exactly the verbs it dispatches", () => {
    // A verb added to the type but not to VERBS would be unreachable; one added
    // to VERBS but not handled would fall through. Both are silent.
    expect([...VERBS].sort()).toEqual([
      "display.getBrightness",
      "display.setBrightness",
      "network.forget",
      "network.join",
      "network.scan",
      "network.status",
      // T1-FIRST-BOOT-PIN-001: the first-boot device PIN, sealed by root.
      "pin.setup",
      "pin.status",
      "update.check",
    ]);
  });
});

describe("input is bounded and validated before anything privileged runs", () => {
  it("refuses an oversized line unread", async () => {
    const join = vi.fn();
    const huge = JSON.stringify({ verb: "network.join", ssidHex: "61".repeat(MAX_REQUEST_BYTES) });
    const res = await serve(huge, { join });
    expect(res).toMatchObject({ ok: false, code: "REQUEST_TOO_LARGE" });
    expect(join).not.toHaveBeenCalled();
  });

  it("refuses a non-hex network identifier", async () => {
    const join = vi.fn();
    for (const ssidHex of ["zz", "abc", "", "../../etc/passwd", "6b6974-6c7579"]) {
      const res = await serve(JSON.stringify({ verb: "network.join", ssidHex, psk: PSK }), {
        join,
      });
      expect(res, ssidHex).toMatchObject({ ok: false, code: "MALFORMED" });
    }
    expect(join).not.toHaveBeenCalled();
  });

  it("refuses an SSID longer than 802.11 allows", async () => {
    const res = await serve(
      JSON.stringify({ verb: "network.join", ssidHex: "61".repeat(33), psk: PSK }),
    );
    expect(res).toMatchObject({ ok: false, code: "MALFORMED" });
  });

  it("refuses a passphrase outside WPA2 bounds before wpa_passphrase sees it", async () => {
    const join = vi.fn();
    for (const psk of ["short", "x".repeat(64)]) {
      const res = await serve(JSON.stringify({ verb: "network.join", ssidHex: SSID_HEX, psk }), {
        join,
      });
      expect(res).toMatchObject({ ok: false, code: "PSK_LENGTH" });
    }
    expect(join).not.toHaveBeenCalled();
  });

  it("accepts an open network, which has no passphrase at all", async () => {
    const join = vi.fn(async () => ({ kind: "joined" }) as const);
    const res = await serve(JSON.stringify({ verb: "network.join", ssidHex: SSID_HEX }), { join });
    expect(res).toMatchObject({ ok: true });
    expect(join).toHaveBeenCalledWith(SSID_HEX, undefined);
  });

  it("refuses malformed JSON without calling anything", async () => {
    const scan = vi.fn();
    expect(await serve("{not json", { scan })).toMatchObject({ ok: false, code: "MALFORMED" });
    expect(await serve("[]", { scan })).toMatchObject({ ok: false, code: "MALFORMED" });
    expect(await serve("null", { scan })).toMatchObject({ ok: false, code: "MALFORMED" });
    expect(scan).not.toHaveBeenCalled();
  });
});

describe("the Wi-Fi passphrase never comes back out", () => {
  it("is absent from a successful response", async () => {
    const res = await serve(JSON.stringify({ verb: "network.join", ssidHex: SSID_HEX, psk: PSK }), {
      join: async () => ({ kind: "joined" }) as const,
    });
    expect(JSON.stringify(res)).not.toContain(PSK);
  });

  it("is absent from a refusal, including one raised by the underlying tool", async () => {
    // The realistic leak: wpa_passphrase fails and quotes its own input.
    const res = await serve(JSON.stringify({ verb: "network.join", ssidHex: SSID_HEX, psk: PSK }), {
      join: async () => {
        throw new Error(`wpa_passphrase: bad passphrase "${PSK}"`);
      },
    });
    expect(res).toMatchObject({ ok: false, code: "FAILED" });
    expect(JSON.stringify(res)).not.toContain(PSK);
  });

  it("is absent from a refusal raised by length validation", async () => {
    const secret = "1234567";
    const res = await serve(
      JSON.stringify({ verb: "network.join", ssidHex: SSID_HEX, psk: secret }),
    );
    expect(JSON.stringify(res)).not.toContain(secret);
  });
});

describe("brightness", () => {
  it("clamps rather than refuses, so a bad slider cannot black out a till", async () => {
    const setBrightness = vi.fn(async () => undefined);
    for (const [given, expected] of [
      [0, 1],
      [-40, 1],
      [137, 100],
      [55.6, 56],
    ] as const) {
      await serve(JSON.stringify({ verb: "display.setBrightness", percent: given }), {
        setBrightness,
      });
      expect(setBrightness).toHaveBeenLastCalledWith(expected);
    }
  });

  it("refuses a non-numeric brightness", async () => {
    const setBrightness = vi.fn();
    const res = await serve(JSON.stringify({ verb: "display.setBrightness", percent: "100" }), {
      setBrightness,
    });
    expect(res).toMatchObject({ ok: false, code: "MALFORMED" });
    expect(setBrightness).not.toHaveBeenCalled();
  });

  it("reports null rather than failing on a board with no backlight control", async () => {
    expect(await serve(JSON.stringify({ verb: "display.getBrightness" }))).toEqual({
      ok: true,
      data: { percent: null },
    });
  });

  it("refuses to SET brightness where it cannot be set", async () => {
    const res = await serve(JSON.stringify({ verb: "display.setBrightness", percent: 50 }));
    expect(res).toMatchObject({ ok: false, code: "UNAVAILABLE" });
  });
});

describe("scan results cross the socket as data, not as Buffers", () => {
  it("carries the real SSID bytes as hex beside the printable form", () => {
    // A shop SSID with a control byte in it: what is DISPLAYED must be safe, and
    // what is JOINED must be the original bytes, so the two are separate fields.
    const raw = Buffer.from(`Shop${ESC}Wi-Fi`, "utf8");
    const dto = toAccessPointDto({ ssid: "ignored", ssidBytes: raw, signal: -52, secured: true });
    expect(dto.ssidHex).toBe(raw.toString("hex"));
    expect(dto.ssid).not.toContain(ESC);
    expect(dto.signal).toBe(-52);
    expect(JSON.parse(JSON.stringify(dto)).ssidHex).toBe(dto.ssidHex);
  });

  it("serialises a scan without leaking a Buffer's JSON shape", async () => {
    const res = await serve(JSON.stringify({ verb: "network.scan" }), {
      scan: async () => [
        { ssid: "x", ssidBytes: Buffer.from("KitLuy", "utf8"), signal: -40, secured: true },
      ],
    });
    expect(JSON.stringify(res)).not.toContain('"type":"Buffer"');
  });
});

describe("parseRequest never runs a dependency", () => {
  it("returns a request for a valid line and a refusal for an invalid one", () => {
    expect(parseRequest(JSON.stringify({ verb: "network.status" }))).toEqual({
      verb: "network.status",
    });
    expect(parseRequest("{")).toMatchObject({ ok: false });
  });

  it("survives a prototype-pollution shaped payload", async () => {
    const res = await serve('{"verb":"network.status","__proto__":{"polluted":true}}', {
      status: () => ({
        wired: { name: "eth0", present: true, carrier: true, operstate: "routable" },
        wireless: { name: "wlan0", present: true, carrier: false, operstate: "off" },
        hasLink: true,
        wirelessConfigured: false,
      }),
    });
    expect(res).toMatchObject({ ok: true });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("handle reports failure without detail", () => {
  it("turns an underlying throw into a bounded refusal", async () => {
    const res = await handle(
      { verb: "network.scan" },
      {
        scan: async () => {
          throw new Error("iw: command not found at /usr/sbin/iw");
        },
      },
    );
    expect(res).toMatchObject({ ok: false, code: "FAILED" });
    expect((res as { message: string }).message).not.toContain("/usr/sbin/iw");
  });
});
