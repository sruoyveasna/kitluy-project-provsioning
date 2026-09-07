/**
 * Provisioning → Terminals — the container. Effects only; every rendered
 * state is a pure view in `views.tsx`, every decision a pure function in
 * `terminal-presentation.ts` / `terminal-roles.ts`.
 *
 * Owner decision v2.0.0 §6 and §17: define a seat, choose its roles, open a
 * session, read the one-time code to the installer. No QR: the code is typed
 * on the Pi (owner clarification 2026-09-04). The code lives in component
 * state and nowhere else.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { KitluyLocale } from "@kitluy/localization";
import { DataSurface } from "@kitluy/web-ui";

import { outcomeMessage } from "./hub-screen.js";
import { MESSAGES, type MessageKey } from "./messages.js";
import type { PartnerStore } from "./pairing-client.js";
import { codeLife } from "./pairing-presentation.js";
import {
  canOpenTerminalSession,
  deriveLadder,
  hubReadiness,
  sessionFacts,
  type LadderRung,
} from "./terminal-presentation.js";
import { roleVocabulary } from "./terminal-roles.js";
import type { TerminalsClient, TerminalsPage } from "./terminals-client.js";
import { NoticePanel, TerminalsView, type PairingState } from "./views.js";

type Loadable<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly value: T }
  | { readonly kind: "problem"; readonly messageKey: MessageKey };

export function TerminalsScreen({
  locale,
  client,
  store,
}: {
  locale: KitluyLocale;
  client: TerminalsClient;
  store: PartnerStore;
}) {
  const [page, setPage] = useState<Loadable<TerminalsPage>>({ kind: "loading" });
  const [defineBusy, setDefineBusy] = useState(false);
  const [defineNotice, setDefineNotice] = useState<string | null>(null);
  const [pairing, setPairing] = useState<PairingState | null>(null);
  const [pairNotice, setPairNotice] = useState<{ terminalId: string; message: string } | null>(
    null,
  );
  const [busyTerminalId, setBusyTerminalId] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const readiness = useMemo(() => hubReadiness(store), [store]);
  const vocabulary = useMemo(() => roleVocabulary(store.vertical), [store.vertical]);
  const canPair = useMemo(() => canOpenTerminalSession(readiness), [readiness]);

  const load = useCallback(async () => {
    const outcome = await client.listTerminals(store.digitalStoreId);
    if (outcome.kind === "ok") setPage({ kind: "ready", value: outcome.value });
    else setPage({ kind: "problem", messageKey: outcomeMessage(outcome) });
  }, [client, store.digitalStoreId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const outcome = await client.listTerminals(store.digitalStoreId);
      if (cancelled) return;
      if (outcome.kind === "ok") setPage({ kind: "ready", value: outcome.value });
      else setPage({ kind: "problem", messageKey: outcomeMessage(outcome) });
    })();
    return () => {
      cancelled = true;
    };
  }, [client, store.digitalStoreId]);

  // The countdown tick, only while a code is on screen.
  useEffect(() => {
    if (pairing === null || pairing.cancelled || pairing.gone) return;
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [pairing]);

  // Watch the session: stop on paired / locked / gone / expired; survive a
  // transient failure (the installer is still standing at the Pi).
  useEffect(() => {
    if (pairing === null || pairing.cancelled || pairing.gone) return;
    const { issued } = pairing;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (): Promise<void> => {
      const outcome = await client.sessionStatus(issued.sessionId);
      if (!live) return;
      if (outcome.kind === "ok") {
        setPairing((p) => (p === null ? p : { ...p, session: outcome.value }));
        if (outcome.value.paired) {
          void load();
          return;
        }
        if (outcome.value.locked) return;
      } else if (outcome.kind === "not_found") {
        setPairing((p) => (p === null ? p : { ...p, gone: true }));
        return;
      }
      if (Date.parse(issued.expiresAt) <= Date.now()) return;
      timer = setTimeout(() => void poll(), 3000);
    };
    void poll();
    return () => {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [client, load, pairing?.issued.sessionId, pairing?.cancelled, pairing?.gone]);

  const onDefine = useCallback(
    async (input: {
      readonly storeLocationId: string;
      readonly label: string;
      readonly terminalProfileKeys: readonly string[];
    }) => {
      setDefineBusy(true);
      setDefineNotice(null);
      try {
        const outcome = await client.defineTerminal({
          digitalStoreId: store.digitalStoreId,
          storeLocationId: input.storeLocationId,
          label: input.label,
          terminalProfileKeys: input.terminalProfileKeys,
        });
        if (outcome.kind === "ok") {
          // Re-read rather than insert locally: the server generated the name.
          await load();
        } else if (outcome.kind === "refused") {
          setDefineNotice(outcome.message);
        } else {
          setPage({ kind: "problem", messageKey: outcomeMessage(outcome) });
        }
      } finally {
        setDefineBusy(false);
      }
    },
    [client, store.digitalStoreId, load],
  );

  const onPair = useCallback(
    async (terminalId: string) => {
      setBusyTerminalId(terminalId);
      setPairNotice(null);
      // Clear the previous code BEFORE the call: opening a session supersedes
      // the last one for this seat.
      setPairing(null);
      try {
        const outcome = await client.openSession({ physicalTerminalId: terminalId });
        if (outcome.kind === "ok") {
          setNow(new Date());
          setPairing({
            terminalId,
            issued: outcome.value,
            session: null,
            cancelling: false,
            cancelled: false,
            gone: false,
          });
          void load();
        } else if (outcome.kind === "refused") {
          setPairNotice({ terminalId, message: outcome.message });
        } else if (outcome.kind === "not_found") {
          setPairNotice({ terminalId, message: MESSAGES[locale].notFound });
          void load();
        } else {
          setPage({ kind: "problem", messageKey: outcomeMessage(outcome) });
        }
      } finally {
        setBusyTerminalId(null);
      }
    },
    [client, load, locale],
  );

  const onCancel = useCallback(async () => {
    if (pairing === null) return;
    setPairing({ ...pairing, cancelling: true });
    const outcome = await client.cancelSession(pairing.issued.sessionId);
    setPairing((p) =>
      p === null
        ? p
        : {
            ...p,
            cancelling: false,
            cancelled: outcome.kind === "ok",
            gone: outcome.kind === "not_found",
          },
    );
    void load();
  }, [client, pairing, load]);

  if (page.kind === "loading") return <DataSurface state="loading" />;
  if (page.kind === "problem") return <NoticePanel locale={locale} messageKey={page.messageKey} />;

  const ladders = new Map<string, readonly LadderRung[]>();
  for (const terminal of page.value.terminals) {
    const session =
      pairing !== null && pairing.terminalId === terminal.physicalTerminalId
        ? (sessionFacts(pairing.session) ?? sessionFacts(terminal.lastSession))
        : sessionFacts(terminal.lastSession);
    ladders.set(
      terminal.physicalTerminalId,
      deriveLadder({ hub: readiness, terminal, session }, now),
    );
  }

  return (
    <TerminalsView
      locale={locale}
      store={store}
      readiness={readiness}
      terminals={page.value.terminals}
      ladders={ladders}
      vocabulary={vocabulary}
      dataAsOf={page.value.dataAsOf}
      now={now}
      pairing={pairing}
      life={pairing === null ? null : codeLife(pairing.issued.expiresAt, now)}
      busyTerminalId={busyTerminalId}
      defineBusy={defineBusy}
      defineNotice={defineNotice}
      pairNotice={pairNotice}
      canPair={canPair}
      onDefine={(input) => void onDefine(input)}
      onPair={(id) => void onPair(id)}
      onCancel={() => void onCancel()}
    />
  );
}
