/**
 * The Terminal PIN screen — TERMINAL-PIN-AND-REAL-POS-AUTH-001.
 *
 * Shown while the terminal is locked (`staff_authentication_required` on the Pi
 * path), i.e. after every terminal-level check (Hub link, eligibility, T1
 * profile, configuration) has passed. Three faces, chosen by the Store Hub's
 * answer carried in `report.pin` — never by anything this screen infers:
 *
 *   setup_required / reset_required   CREATE TERMINAL PIN, then CONFIRM
 *                                     (KLD-2026-09-03-TERMINAL-PROVISIONING-001 §10)
 *   set                               ENTER TERMINAL PIN
 *   set + lockedUntil                 locked; the keypad waits
 *
 * A touch keypad, four dots, submit at the fourth digit. The PIN crosses IPC
 * once and is cleared here whatever the answer. The Hub verifies; this only
 * carries. No staff name, no email, no password: the device credential plus
 * this PIN is the terminal's credential.
 */
import { useEffect, useState } from "react";
import type { KitluyLocale } from "@kitluy/localization";

import { T1_PIN_BRIDGE_KEY, type PinVerdict, type T1PinBridge } from "./bootstrap/bridge-types.js";
import type { T1BootstrapReport } from "./bootstrap/states.js";

const TEXT = {
  "km-KH": {
    create: "បង្កើត PIN របស់ Terminal",
    createHint: "បញ្ចូលលេខ ៤ ខ្ទង់",
    confirm: "បញ្ជាក់ PIN",
    confirmHint: "បញ្ចូលលេខ ៤ ខ្ទង់ដដែលម្ដងទៀត",
    unlock: "បញ្ចូល PIN របស់ Terminal",
    locked: "PIN ត្រូវបានចាក់សោ",
    lockedHint: "បញ្ចូលខុសច្រើនដងពេក។ សូមរង់ចាំរហូតដល់",
    resetHint: "PIN ត្រូវបានកំណត់ឡើងវិញ។ បង្កើត PIN ថ្មី។",
    mismatch: "លេខទាំងពីរមិនដូចគ្នាទេ។ សូមព្យាយាមម្ដងទៀត។",
    incorrect: "PIN មិនត្រឹមត្រូវ",
    attemptsLeft: "ការព្យាយាមនៅសល់",
    busy: "កំពុងពិនិត្យជាមួយ Store Hub…",
    refused: "Store Hub បានបដិសេធ",
    unavailable: "PIN របស់ Terminal មិនមាននៅលើកុំព្យូទ័រនេះទេ។",
    clear: "លុប",
    back: "⌫",
  },
  "en-US": {
    create: "Create Terminal PIN",
    createHint: "Enter 4 digits",
    confirm: "Confirm Terminal PIN",
    confirmHint: "Enter the same 4 digits again",
    unlock: "Enter Terminal PIN",
    locked: "PIN locked",
    lockedHint: "Too many wrong entries. Wait until",
    resetHint: "The PIN was reset. Create a new one.",
    mismatch: "The two entries differ. Try again.",
    incorrect: "Incorrect PIN",
    attemptsLeft: "attempts left",
    busy: "Checking with the Store Hub…",
    refused: "The Store Hub refused",
    unavailable: "The Terminal PIN is not available on this workstation.",
    clear: "Clear",
    back: "⌫",
  },
} as const;

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"] as const;

function pinBridge(): T1PinBridge | undefined {
  return (window as unknown as Record<string, T1PinBridge | undefined>)[T1_PIN_BRIDGE_KEY];
}

type Face = "create" | "confirm" | "unlock" | "locked";

export function PinScreen(props: {
  readonly locale: KitluyLocale;
  readonly report: T1BootstrapReport;
}) {
  const text = TEXT[props.locale];
  const posture = props.report.pin;
  const bridge = typeof window === "undefined" ? undefined : pinBridge();
  const [entry, setEntry] = useState("");
  const [first, setFirst] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<string | null>(posture?.lockedUntil ?? null);
  const [attempts, setAttempts] = useState<number | null>(null);

  // The Hub's latest word wins over anything remembered here.
  useEffect(() => {
    setLockedUntil(posture?.lockedUntil ?? null);
    if (posture?.state !== "set") setFirst(null);
  }, [posture?.lockedUntil, posture?.state]);

  if (bridge === undefined) return <p data-pin-screen="unavailable">{text.unavailable}</p>;

  const needsSetup = posture === undefined || posture.state !== "set";
  const face: Face =
    lockedUntil !== null
      ? "locked"
      : needsSetup
        ? first === null
          ? "create"
          : "confirm"
        : "unlock";

  const settle = (verdict: PinVerdict): void => {
    if (verdict.ok) {
      setMessage(null);
      setAttempts(null);
      return;
    }
    if (verdict.pin?.lockedUntil !== undefined && verdict.pin.lockedUntil !== null) {
      setLockedUntil(verdict.pin.lockedUntil);
    }
    if (verdict.code === "PIN_INCORRECT") {
      setAttempts(verdict.pin?.attemptsBeforeLock ?? null);
      setMessage(text.incorrect);
      return;
    }
    if (verdict.code === "PIN_CONFIRMATION_MISMATCH") {
      setMessage(text.mismatch);
      return;
    }
    setMessage(`${text.refused}: ${verdict.code}`);
  };

  const submit = (pin: string): void => {
    setEntry("");
    if (face === "create") {
      setFirst(pin);
      setMessage(null);
      return;
    }
    setBusy(true);
    setMessage(null);
    const action =
      face === "confirm"
        ? bridge.setup({ pin: first ?? "", pinConfirmation: pin })
        : bridge.unlock({ pin });
    setFirst(null);
    void action
      .then(settle)
      .catch(() => {
        setMessage(`${text.refused}: UNAVAILABLE`);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const press = (key: (typeof KEYS)[number]): void => {
    if (busy || face === "locked") return;
    if (key === "clear") {
      setEntry("");
      return;
    }
    if (key === "back") {
      setEntry((e) => e.slice(0, -1));
      return;
    }
    const next = `${entry}${key}`;
    setEntry(next);
    if (next.length === 4) submit(next);
  };

  const title =
    face === "create"
      ? text.create
      : face === "confirm"
        ? text.confirm
        : face === "locked"
          ? text.locked
          : text.unlock;
  const hint =
    face === "create"
      ? posture?.state === "reset_required"
        ? `${text.resetHint} ${text.createHint}`
        : text.createHint
      : face === "confirm"
        ? text.confirmHint
        : face === "locked"
          ? `${text.lockedHint} ${lockedUntil ?? ""}`
          : null;

  return (
    <section data-pin-screen={face} aria-label={title}>
      <h2>{title}</h2>
      {hint !== null ? <p>{hint}</p> : null}
      <p aria-label="pin-entry" data-pin-length={entry.length}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} data-dot={i < entry.length ? "filled" : "empty"}>
            {i < entry.length ? "●" : "○"}{" "}
          </span>
        ))}
      </p>
      {busy ? <p>{text.busy}</p> : null}
      {message !== null ? (
        <p role="alert">
          {message}
          {attempts !== null ? ` — ${String(attempts)} ${text.attemptsLeft}` : ""}
        </p>
      ) : null}
      <div role="group" aria-label="keypad">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            disabled={busy || face === "locked"}
            onClick={() => {
              press(key);
            }}
            data-key={key}
          >
            {key === "clear" ? text.clear : key === "back" ? text.back : key}
          </button>
        ))}
      </div>
    </section>
  );
}
