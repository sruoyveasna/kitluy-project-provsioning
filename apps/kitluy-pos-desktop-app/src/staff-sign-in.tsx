/**
 * Staff sign-in for the T1 terminal — T1-STORE-OPERATIONS-001.
 *
 * Shown only in `staff_authentication_required`, i.e. after every terminal-level
 * check (Hub link, eligibility, T1 profile, configuration) has passed. The Hub
 * verifies the passcode; this form only carries it, once, over IPC, and clears
 * it whatever the answer. The profile is not a choice here: it is always T1.
 */
import { useState, type FormEvent } from "react";
import type { KitluyLocale } from "@kitluy/localization";

import { T1_STAFF_BRIDGE_KEY, type T1StaffBridge } from "./bootstrap/bridge-types.js";

const TEXT = {
  "km-KH": {
    title: "ចូលប្រើដោយបុគ្គលិក",
    actorId: "លេខសម្គាល់បុគ្គលិក",
    passcode: "លេខសម្ងាត់",
    submit: "ចូល",
    busy: "កំពុងពិនិត្យជាមួយ Store Hub…",
    unavailable: "ការចូលប្រើមិនមាននៅលើកុំព្យូទ័រនេះទេ។",
    refused: "Store Hub បានបដិសេធ",
  },
  "en-US": {
    title: "Staff sign-in",
    actorId: "Staff ID",
    passcode: "Passcode",
    submit: "Sign in",
    busy: "Checking with the Store Hub…",
    unavailable: "Staff sign-in is not available on this workstation.",
    refused: "The Store Hub refused",
  },
} as const;

function staffBridge(): T1StaffBridge | undefined {
  return (window as unknown as Record<string, T1StaffBridge | undefined>)[T1_STAFF_BRIDGE_KEY];
}

export function StaffSignIn(props: { readonly locale: KitluyLocale }) {
  const text = TEXT[props.locale];
  const [actorId, setActorId] = useState("");
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const bridge = typeof window === "undefined" ? undefined : staffBridge();

  if (bridge === undefined) return <p data-staff-sign-in="unavailable">{text.unavailable}</p>;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setBusy(true);
    setRefusal(null);
    const attempt = { actorId, passcode };
    setPasscode("");
    void bridge
      .signIn(attempt)
      .then((verdict) => {
        if (!verdict.ok) setRefusal(`${text.refused}: ${verdict.code}`);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <form data-staff-sign-in="form" onSubmit={submit} aria-label={text.title}>
      <h2>{text.title}</h2>
      <label>
        {text.actorId}{" "}
        <input
          name="actorId"
          autoComplete="off"
          value={actorId}
          onChange={(e) => {
            setActorId(e.target.value);
          }}
        />
      </label>{" "}
      <label>
        {text.passcode}{" "}
        <input
          name="passcode"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={passcode}
          onChange={(e) => {
            setPasscode(e.target.value);
          }}
        />
      </label>{" "}
      <button type="submit" disabled={busy || actorId.trim() === "" || passcode.length < 4}>
        {busy ? text.busy : text.submit}
      </button>
      {refusal !== null ? <p role="alert">{refusal}</p> : null}
    </form>
  );
}
