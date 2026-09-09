/**
 * Terminal Settings: the decisions, and what the screens render.
 *
 * The pure model is tested directly; the components through `renderToString`,
 * the same way `screens.test.tsx` does — a kiosk screen is checked for the
 * strings a person reads and the data hooks a test can hold onto, not for
 * classes that are free to change.
 */
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";

import {
  EMPTY_PRINTER_FORM,
  rankNetworks,
  signalBars,
  summariseConnection,
  validatePrinterForm,
} from "../src/model/settings.js";
import { DeviceTab, DisplayTab, NetworkTab, PrinterTab, SettingsTabs } from "../src/settings.js";
import type { NetworkStatusView, ScannedNetwork } from "../src/bridge.js";

const noop = (): void => undefined;
const hex = (name: string): string => Buffer.from(name, "utf8").toString("hex");

function net(name: string, signal: number, secured = true): ScannedNetwork {
  return { ssid: name, ssidHex: hex(name), signal, secured };
}

function status(wired: string, wireless: string, configured = false): NetworkStatusView {
  return {
    wired: { name: "eth0", present: true, carrier: wired === "routable", operstate: wired },
    wireless: {
      name: "wlan0",
      present: true,
      carrier: wireless === "routable",
      operstate: wireless,
    },
    hasLink: wired === "routable" || wireless === "routable",
    wirelessConfigured: configured,
  };
}

describe("signal strength becomes something a shop can read", () => {
  it("maps dBm to 0-4 bars on the conventional thresholds", () => {
    expect(signalBars(-35)).toBe(4);
    expect(signalBars(-55)).toBe(3);
    expect(signalBars(-65)).toBe(2);
    expect(signalBars(-72)).toBe(1);
    expect(signalBars(-90)).toBe(0);
  });

  it("treats a nonsense reading as no signal rather than full", () => {
    expect(signalBars(Number.NaN)).toBe(0);
    expect(signalBars(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("the network list is one row per network, strongest first", () => {
  it("collapses several access points broadcasting the same name", () => {
    // A shop with three ceiling points showed the same name three times and the
    // installer could not tell which to tap.
    const ranked = rankNetworks([net("Shop", -70), net("Shop", -41), net("Shop", -66)]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.signal).toBe(-41);
  });

  it("keeps two networks whose names differ only by a control byte apart", () => {
    // Deduplicating on the PRINTABLE name would merge these and join the wrong
    // one; the real bytes are the identity.
    const a: ScannedNetwork = { ssid: "Shop", ssidHex: hex("Shop"), signal: -40, secured: true };
    const b: ScannedNetwork = {
      ssid: "Shop",
      ssidHex: hex("Shop\u0007"),
      signal: -45,
      secured: true,
    };
    expect(rankNetworks([a, b])).toHaveLength(2);
  });

  it("orders by strength and breaks ties stably so the list does not jump", () => {
    const ranked = rankNetworks([net("Beta", -50), net("Alpha", -50), net("Weak", -80)]);
    expect(ranked.map((n) => n.ssid)).toEqual(["Alpha", "Beta", "Weak"]);
  });

  it("drops an entry with no SSID at all", () => {
    expect(rankNetworks([{ ssid: "", ssidHex: "", signal: -40, secured: false }])).toHaveLength(0);
  });
});

describe("the connection summary tells the truth about which link is working", () => {
  it("says wired when the cable is routable, even with Wi-Fi also up", () => {
    expect(summariseConnection(status("routable", "routable"))).toEqual({ kind: "wired" });
  });

  it("says wireless only when the cable is not carrying", () => {
    expect(summariseConnection(status("no-carrier", "routable"))).toEqual({ kind: "wireless" });
  });

  it("says none when nothing is routable, and when nothing is known", () => {
    expect(summariseConnection(status("no-carrier", "off"))).toEqual({ kind: "none" });
    expect(summariseConnection(null)).toEqual({ kind: "none" });
  });
});

describe("the printer form is checked before the button lights up", () => {
  it("accepts a hostname or an address, with a blank port meaning 9100", () => {
    expect(validatePrinterForm({ host: "192.168.1.50", port: "", label: "" })).toBeNull();
    expect(validatePrinterForm({ host: "printer.shop.local", port: "9100", label: "" })).toBeNull();
  });

  it("refuses an empty or malformed address", () => {
    expect(validatePrinterForm(EMPTY_PRINTER_FORM)).toBe("host");
    expect(validatePrinterForm({ host: "has space", port: "", label: "" })).toBe("host");
  });

  it("refuses a port that is not a port", () => {
    for (const port of ["0", "70000", "-1", "9100x", "9.1"]) {
      expect(validatePrinterForm({ host: "p", port, label: "" }), port).toBe("port");
    }
  });
});

describe("the screens render in both languages", () => {
  it("labels every tab in Khmer and English", () => {
    for (const locale of ["km-KH", "en-US"] as const) {
      const html = renderToString(
        <SettingsTabs locale={locale} active="network" onSelect={noop} />,
      );
      for (const tab of ["network", "printer", "device", "display"]) {
        expect(html, `${locale}/${tab}`).toContain(`data-tab="${tab}"`);
      }
      expect(html).toContain('data-active="yes"');
    }
  });

  it("renders a Khmer network tab that is not the English one", () => {
    const km = renderToString(
      <NetworkTab
        locale="km-KH"
        status={status("routable", "off")}
        networks={[]}
        scanning={false}
        selected={null}
        passphrase=""
        busy={false}
        notice={null}
        unavailable={false}
        onScan={noop}
        onSelect={noop}
        onPassphrase={noop}
        onJoin={noop}
      />,
    );
    const en = renderToString(
      <NetworkTab
        locale="en-US"
        status={status("routable", "off")}
        networks={[]}
        scanning={false}
        selected={null}
        passphrase=""
        busy={false}
        notice={null}
        unavailable={false}
        onScan={noop}
        onSelect={noop}
        onPassphrase={noop}
        onJoin={noop}
      />,
    );
    expect(km).not.toBe(en);
    expect(en).toContain("Connected by Ethernet");
    expect(km).toContain('data-connection="wired"');
  });
});

describe("the network tab", () => {
  const base = {
    locale: "en-US" as const,
    status: status("no-carrier", "off"),
    scanning: false,
    passphrase: "",
    busy: false,
    notice: null,
    unavailable: false,
    onScan: noop,
    onSelect: noop,
    onPassphrase: noop,
    onJoin: noop,
  };

  it("says the device cannot be configured, rather than showing dead controls", () => {
    const html = renderToString(<NetworkTab {...base} networks={[]} selected={null} unavailable />);
    expect(html).toContain('data-unavailable="yes"');
    expect(html).not.toContain('data-action="scan"');
  });

  it("asks for a passphrase on a secured network and not on an open one", () => {
    const secured = renderToString(
      <NetworkTab {...base} networks={[]} selected={net("Shop", -40, true)} />,
    );
    expect(secured).toContain('type="password"');

    const open = renderToString(
      <NetworkTab {...base} networks={[]} selected={net("Guest", -40, false)} />,
    );
    expect(open).not.toContain('type="password"');
  });

  it("never renders the passphrase as readable text", () => {
    const html = renderToString(
      <NetworkTab
        {...base}
        networks={[]}
        selected={net("Shop", -40, true)}
        passphrase="hunter2-secret"
      />,
    );
    // React renders a controlled input's value attribute; what matters is that
    // the field is a password field, so a wall-mounted screen does not display
    // it after the installer walks away.
    expect(html).toContain('type="password"');
    expect(html).not.toContain('type="text" name="passphrase"');
  });

  it("carries the real SSID bytes on the row, not the printable name", () => {
    const html = renderToString(
      <NetworkTab {...base} networks={[net("Shop", -40)]} selected={null} />,
    );
    expect(html).toContain(`data-ssid-hex="${hex("Shop")}"`);
  });

  it("has nowhere to navigate — a kiosk has no anchors", () => {
    const html = renderToString(
      <NetworkTab {...base} networks={[net("Shop", -40)]} selected={null} />,
    );
    expect(html).not.toContain("<a ");
  });
});

describe("the printer tab", () => {
  const base = {
    locale: "en-US" as const,
    form: EMPTY_PRINTER_FORM,
    busy: false,
    notice: null,
    onChange: noop,
    onSave: noop,
    onTest: noop,
  };

  it("says no printer is set up, and cannot be asked to test one", () => {
    const html = renderToString(<PrinterTab {...base} saved={null} error={null} />);
    expect(html).toContain('data-printer="none"');
    // The test button is disabled with nothing saved: pressing it would produce
    // a refusal the operator would read as a broken printer.
    expect(html).toMatch(/data-action="test-printer"[^>]*disabled/);
  });

  it("shows the saved printer and enables the test", () => {
    const html = renderToString(
      <PrinterTab
        {...base}
        saved={{ kind: "network", host: "192.168.1.50", port: 9100, label: "Counter" }}
        error={null}
      />,
    );
    expect(html).toContain("192.168.1.50");
    expect(html).toContain("Counter");
  });

  it("blocks save while the form is invalid", () => {
    const html = renderToString(<PrinterTab {...base} saved={null} error="host" />);
    expect(html).toMatch(/data-action="save-printer"[^>]*disabled/);
    expect(html).toContain('data-error="host"');
  });

  it("says plainly that USB is not supported yet", () => {
    const html = renderToString(<PrinterTab {...base} saved={null} error={null} />);
    expect(html).toContain('data-note="usb"');
  });
});

describe("the device tab", () => {
  it("renders an em dash for a fact this board does not have", () => {
    const html = renderToString(<DeviceTab locale="en-US" info={null} />);
    expect(html).toContain("—");
    expect(html).not.toContain("null");
    expect(html).not.toContain("undefined");
  });

  it("shows the serial, which is what the fleet knows this board as", () => {
    const html = renderToString(
      <DeviceTab
        locale="en-US"
        info={{
          hostname: "pi5-etzege",
          serial: "53b91c797e480ed6",
          imageVersion: "0.2.0-dev",
          deviceClass: "terminal",
          environment: "development",
          registrationUrl: null,
        }}
      />,
    );
    expect(html).toContain("53b91c797e480ed6");
    expect(html).toContain("pi5-etzege");
  });
});

describe("the display tab", () => {
  it("hides the slider on a board with no backlight instead of showing a dead one", () => {
    const html = renderToString(
      <DisplayTab
        locale="en-US"
        brightness={null}
        busy={false}
        onBrightness={noop}
        onToggleLocale={noop}
      />,
    );
    expect(html).toContain('data-backlight="absent"');
    expect(html).not.toContain('type="range"');
  });

  it("never offers a brightness of zero", () => {
    const html = renderToString(
      <DisplayTab
        locale="en-US"
        brightness={50}
        busy={false}
        onBrightness={noop}
        onToggleLocale={noop}
      />,
    );
    expect(html).toContain('min="1"');
    expect(html).not.toContain('min="0"');
  });
});
