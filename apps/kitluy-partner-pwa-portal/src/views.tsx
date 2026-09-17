/**
 * Presentational views for the Partner Portal.
 *
 * Every component here is a pure function of its props — no fetching, no
 * session, no clock, no timers. That is what makes each state an operator can
 * meet (blocked Hub, live code, expired code, paired, cancelled, empty list)
 * renderable with `renderToString` and therefore assertable.
 *
 * The one-time code is rendered from props only. Nothing here puts it in an
 * href, a src, storage or a log.
 */
import { useState, type FormEvent, type ReactNode } from "react";
import type { KitluyLocale } from "@kitluy/localization";
import { DataSurface, kitluyTokens } from "@kitluy/web-ui";

import { MESSAGES, type MessageKey } from "./messages.js";
import type { PartnerStore, StoreLocationOption } from "./pairing-client.js";
import { groupCode, type CodeLife } from "./pairing-presentation.js";
import { routeHref, storeRoute, type StoreTab } from "./routing.js";
import {
  codePresentation,
  type HubReadiness,
  type LadderRung,
  type PairBlock,
  type RungKey,
} from "./terminal-presentation.js";
import {
  roleShortCode,
  validateTerminalLabel,
  validateTerminalRoles,
  type RoleVocabulary,
} from "./terminal-roles.js";
import type {
  IssuedTerminalCode,
  PhysicalTerminal,
  TerminalSessionStatus,
} from "./terminals-client.js";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

export function NoticePanel(props: {
  locale: KitluyLocale;
  messageKey: MessageKey;
  detail?: string | undefined;
  children?: ReactNode;
}): JSX.Element {
  return (
    <section aria-label="notice">
      <DataSurface state="unavailable" />
      <p role="alert" data-notice={props.messageKey} className="kl-notice kl-notice-warn">
        <span>{MESSAGES[props.locale][props.messageKey]}</span>
      </p>
      {props.detail !== undefined ? <p className="kl-muted">{props.detail}</p> : null}
      {props.children}
    </section>
  );
}

/** The Store picker and the two tabs. The Store id lives in the hash. */
const ICON_HUB = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M9 9h6v6H9z" />
  </svg>
);
const ICON_TERMINALS = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </svg>
);

/**
 * The left-sidebar navigation for one Store: the Store switcher, then the two
 * tabs (Store Hub and Terminals). The active tab carries `aria-current="page"`.
 */
export function StoreNav(props: {
  locale: KitluyLocale;
  stores: readonly PartnerStore[];
  storeId: string;
  tab: StoreTab;
  onStore: (storeId: string) => void;
}): JSX.Element {
  const t = MESSAGES[props.locale];
  return (
    <nav aria-label="store" className="kl-nav">
      <div className="kl-field" style={{ margin: "0 2px 12px" }}>
        <label htmlFor="store">{t.store}</label>
        <select
          className="kl-select"
          id="store"
          value={props.storeId}
          onChange={(e) => props.onStore(e.target.value)}
        >
          {props.stores.map((s) => (
            <option key={s.digitalStoreId} value={s.digitalStoreId}>
              {s.digitalStoreReference}
            </option>
          ))}
        </select>
      </div>
      <a
        className="kl-nav-item"
        href={routeHref(storeRoute("hub", props.storeId))}
        aria-current={props.tab === "hub" ? "page" : undefined}
      >
        <span className="kl-ic" aria-hidden="true">
          {ICON_HUB}
        </span>
        {t.navHub}
      </a>
      <a
        className="kl-nav-item"
        href={routeHref(storeRoute("terminals", props.storeId))}
        aria-current={props.tab === "terminals" ? "page" : undefined}
      >
        <span className="kl-ic" aria-hidden="true">
          {ICON_TERMINALS}
        </span>
        {t.navTerminals}
      </a>
    </nav>
  );
}

const HUB_MESSAGE: Readonly<Record<HubReadiness["kind"], MessageKey>> = {
  active: "hubActive",
  pending_trust: "hubPending",
  none: "hubNone",
  other: "hubNotActive",
  unreported: "hubUnreported",
};

/** The precondition of every terminal, said plainly. */
export function HubReadinessLine(props: {
  locale: KitluyLocale;
  readiness: HubReadiness;
  storeId: string;
}): JSX.Element {
  const t = MESSAGES[props.locale];
  const r = props.readiness;
  const reference = "deviceReference" in r ? r.deviceReference : null;
  return (
    <p
      data-hub-readiness={r.kind}
      className="kl-hub-line"
      style={{
        background: r.kind === "active" ? "var(--kl-good-bg)" : "var(--kl-warn-bg)",
        color: r.kind === "active" ? "var(--kl-good)" : "var(--kl-warn)",
      }}
    >
      <span>{t[HUB_MESSAGE[r.kind]]}</span>
      {reference === null ? null : <strong className="kl-mono">{reference}</strong>}
      {r.kind === "active" ? null : (
        <a href={routeHref(storeRoute("hub", props.storeId))} style={{ marginLeft: "auto" }}>
          {t.goToHub}
        </a>
      )}
    </p>
  );
}

export interface CodeWording {
  readonly heading: MessageKey;
  readonly waiting: MessageKey;
  readonly pairedDetail: MessageKey;
  readonly replaced: MessageKey;
}

/**
 * ONE display of a one-time code, shared by the Hub and Terminal panels so the
 * two can never drift (a space, never a hyphen; `aria-label` carries the
 * ungrouped code; urgent under two minutes; success wins over the clock).
 */
export function PairingCodeDisplay(props: {
  locale: KitluyLocale;
  code: string;
  life: CodeLife;
  status: {
    readonly paired: boolean;
    readonly locked: boolean;
    readonly failedAttemptCount: number;
    readonly pairedDeviceReference: string | null;
  } | null;
  wording: CodeWording;
  children?: ReactNode;
}): JSX.Element {
  const t = MESSAGES[props.locale];
  const face = codePresentation(props.status, props.life);

  if (face === "paired") {
    return (
      <section aria-label="pairing-code" data-paired="true">
        <h2 style={{ color: kitluyTokens.colorPrimary }}>{t.pairedHeading}</h2>
        <p>{t[props.wording.pairedDetail]}</p>
        {props.status?.pairedDeviceReference == null ? null : (
          <p style={{ color: kitluyTokens.colorMuted }}>
            {t.pairedDevice}:{" "}
            <strong style={{ fontFamily: MONO }}>{props.status.pairedDeviceReference}</strong>
          </p>
        )}
      </section>
    );
  }

  if (face === "locked") {
    return (
      <section aria-label="pairing-code" data-locked="true">
        <h2>{t[props.wording.heading]}</h2>
        <p role="alert" style={{ color: kitluyTokens.colorDanger, fontWeight: 700 }}>
          {t.lockedOut}
        </p>
        {props.children}
      </section>
    );
  }

  const urgent = props.life.kind === "live" && props.life.secondsRemaining <= 120;
  return (
    <section aria-label="pairing-code">
      <h2>{t[props.wording.heading]}</h2>
      {face === "expired" ? (
        <p role="alert" style={{ color: kitluyTokens.colorDanger, fontWeight: 700 }}>
          {t.expired}
        </p>
      ) : (
        <div className="kl-codebox">
          <p aria-label={props.code} className="kl-code" style={{ margin: 0 }}>
            {groupCode(props.code)}
          </p>
          <p className="kl-timer" style={urgent ? { color: "var(--kl-critical)" } : undefined}>
            {t.expiresIn}{" "}
            <time style={{ fontWeight: urgent ? 700 : 500, fontVariantNumeric: "tabular-nums" }}>
              {props.life.kind === "live" ? props.life.label : ""}
            </time>
          </p>
        </div>
      )}
      {face === "expired" ? null : (
        <p role="status" style={{ color: kitluyTokens.colorMuted }}>
          {t[props.wording.waiting]}
        </p>
      )}
      {props.status !== null && props.status.failedAttemptCount > 0 ? (
        <p role="alert" style={{ color: kitluyTokens.colorWarning }}>
          {t.attemptsFailed}: {props.status.failedAttemptCount}
        </p>
      ) : null}
      <p style={{ color: kitluyTokens.colorMuted }}>
        <em>{t.shownOnce}</em>
      </p>
      <p style={{ color: kitluyTokens.colorMuted }}>
        <em>{t[props.wording.replaced]}</em>
      </p>
      {props.children}
    </section>
  );
}

/** Define a seat: optional name, Location, role checkboxes from the vertical. */
export function DefineTerminalForm(props: {
  locale: KitluyLocale;
  locations: readonly StoreLocationOption[];
  vocabulary: RoleVocabulary;
  busy: boolean;
  /** A governed refusal, verbatim. */
  notice: string | null;
  onSubmit: (input: {
    readonly storeLocationId: string;
    readonly label: string;
    readonly terminalProfileKeys: readonly string[];
  }) => void;
}): JSX.Element {
  const t = MESSAGES[props.locale];
  const [label, setLabel] = useState("");
  const [locationId, setLocationId] = useState(props.locations[0]?.storeLocationId ?? "");
  const [keys, setKeys] = useState<readonly string[]>([]);
  const [error, setError] = useState<MessageKey | null>(null);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const labelError = validateTerminalLabel(label);
    if (labelError !== null) return setError(labelError);
    const rolesError = validateTerminalRoles(keys, props.vocabulary);
    if (rolesError !== null) return setError(rolesError);
    if (locationId === "") return setError("noLocation");
    setError(null);
    props.onSubmit({ storeLocationId: locationId, label: label.trim(), terminalProfileKeys: keys });
  };

  const toggle = (key: string, on: boolean): void => {
    setKeys((current) =>
      on ? (current.includes(key) ? current : [...current, key]) : current.filter((k) => k !== key),
    );
  };

  return (
    <form aria-label="define-terminal" onSubmit={submit}>
      <h2 style={{ fontSize: 16, margin: "0 0 14px" }}>{t.defineTerminal}</h2>
      <div className="kl-field">
        <label htmlFor="terminal-label">{t.terminalLabel}</label>
        <input
          className="kl-input"
          id="terminal-label"
          name="label"
          maxLength={64}
          value={label}
          disabled={props.busy}
          onChange={(e) => setLabel(e.target.value)}
        />
        <small className="kl-hint">{t.terminalLabelHint}</small>
      </div>
      {props.locations.length === 0 ? (
        <p role="alert" className="kl-notice kl-notice-warn">
          <span>{t.noLocation}</span>
        </p>
      ) : (
        <div className="kl-field">
          <label htmlFor="terminal-location">{t.location}</label>
          <select
            className="kl-select"
            id="terminal-location"
            name="storeLocationId"
            value={locationId}
            disabled={props.busy}
            onChange={(e) => setLocationId(e.target.value)}
          >
            {props.locations.map((l) => (
              <option key={l.storeLocationId} value={l.storeLocationId}>
                {l.locationReference}
              </option>
            ))}
          </select>
        </div>
      )}
      <fieldset className="kl-fieldset kl-field">
        <legend>{t.terminalProfiles}</legend>
        {props.vocabulary.kind === "offered" ? (
          <>
            <p className="kl-hint" style={{ margin: "0 0 6px" }}>
              {t.terminalProfilesHint}
            </p>
            <div className="kl-checks">
              {props.vocabulary.roles.map((role) => (
                <label key={role.key} className="kl-check">
                  <input
                    type="checkbox"
                    name="terminalProfileKeys"
                    value={role.key}
                    checked={keys.includes(role.key)}
                    disabled={props.busy}
                    onChange={(e) => toggle(role.key, e.target.checked)}
                  />
                  {t[role.labelKey]}
                </label>
              ))}
            </div>
          </>
        ) : (
          <p role="status" data-vocabulary={props.vocabulary.kind} className="kl-muted">
            {props.vocabulary.kind === "unreported" ? t.verticalUnreported : t.verticalUnsupported}
          </p>
        )}
      </fieldset>
      {error === null ? null : (
        <p role="alert" data-form-error={error} className="kl-notice kl-notice-critical">
          <span>{t[error]}</span>
        </p>
      )}
      {props.notice === null ? null : (
        <p role="alert" className="kl-notice kl-notice-critical">
          <span>{props.notice}</span>
        </p>
      )}
      {props.vocabulary.kind === "offered" && props.locations.length > 0 ? (
        <button type="submit" disabled={props.busy} className="kl-btn kl-btn-primary">
          {props.busy ? t.defining : t.defineTerminal}
        </button>
      ) : null}
    </form>
  );
}

const RUNG_LABEL: Readonly<Record<RungKey, MessageKey>> = {
  hubActive: "rungHubActive",
  issued: "rungIssued",
  redeemed: "rungRedeemed",
  activated: "rungActivated",
  hubConnected: "rungHubConnected",
  appInstalled: "rungAppInstalled",
  appRunning: "rungAppRunning",
  configurationLoaded: "rungConfigurationLoaded",
  pinSet: "rungPinSet",
  active: "rungActive",
};

const BLOCK_MESSAGE: Readonly<Record<PairBlock, MessageKey>> = {
  hubNotActive: "hubNotActive",
  hubNone: "hubNone",
  hubUnreported: "hubUnreported",
};

/** The ladder: colour is redundant with the state word, never the only cue. */
export function ProvisioningLadder(props: {
  locale: KitluyLocale;
  rungs: readonly LadderRung[];
}): JSX.Element {
  const t = MESSAGES[props.locale];
  const stateWord: Readonly<Record<LadderRung["state"], MessageKey>> = {
    done: "rungDone",
    current: "rungCurrent",
    not_reported: "rungNotReported",
    blocked: "rungBlocked",
    // DISTINCT from not_reported on purpose: that one means "nothing has been
    // reported YET", which the ladder's own footnote promises. This one means
    // nothing ever will in this build, and showing them alike made a working
    // terminal look stalled behind a step that could never complete.
    unbuilt: "rungUnbuilt",
    // Reported once, too long ago to still be true. Not a failure and not
    // "nothing reported yet" — a third thing, said as itself.
    stale: "rungStale",
  };
  const rungClass = (state: LadderRung["state"]) =>
    state === "done"
      ? "kl-rung kl-done"
      : state === "blocked"
        ? "kl-rung kl-blocked"
        : state === "current"
          ? "kl-rung kl-current"
          : "kl-rung kl-pending";
  return (
    <ol aria-label="provisioning-ladder" className="kl-ladder">
      {props.rungs.map((rung) => (
        <li
          key={rung.key}
          className={rungClass(rung.state)}
          data-rung={rung.key}
          data-rung-state={rung.state}
        >
          <span className="kl-rail" aria-hidden="true">
            <span className="kl-node" />
            <span className="kl-line" />
          </span>
          <div
            className="kl-rbody"
            style={{
              fontWeight: rung.state === "blocked" ? 700 : 400,
              fontStyle: rung.state === "not_reported" ? "italic" : "normal",
            }}
          >
            {t[RUNG_LABEL[rung.key]]} — {t[stateWord[rung.state]]}
            {rung.detail === undefined ? null : (
              <>
                {" "}
                <span className="kl-mono">{rung.detail}</span>
              </>
            )}
            {rung.source === "device_reported" ? (
              <>
                {" "}
                <small className="kl-muted" data-rung-source="device_reported">
                  · {t.deviceReported}
                </small>
              </>
            ) : null}
            {rung.note === undefined ? null : (
              <>
                <br />
                <small className="kl-muted" data-rung-note={rung.note}>
                  {t[rung.note]}
                </small>
              </>
            )}
            {rung.reason === undefined ? null : (
              <>
                <br />
                <small className="kl-muted">{t[BLOCK_MESSAGE[rung.reason]]}</small>
              </>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

const TERMINAL_WORDING: CodeWording = {
  heading: "terminalCodeHeading",
  waiting: "waitingForTerminal",
  pairedDetail: "terminalPairedDetail",
  replaced: "terminalReplaced",
};

/** The live code for ONE seat, with Cancel. */
export function TerminalPairPanel(props: {
  locale: KitluyLocale;
  issued: IssuedTerminalCode;
  session: TerminalSessionStatus | null;
  life: CodeLife;
  cancelling: boolean;
  cancelled: boolean;
  gone: boolean;
  onCancel: () => void;
}): JSX.Element {
  const t = MESSAGES[props.locale];
  if (props.cancelled) {
    return (
      <section aria-label="terminal-pairing" data-cancelled="true">
        <p role="alert">{t.sessionCancelled}</p>
      </section>
    );
  }
  if (props.gone) {
    return (
      <section aria-label="terminal-pairing" data-gone="true">
        <p role="alert">{t.sessionGone}</p>
      </section>
    );
  }
  const face = codePresentation(props.session, props.life);
  return (
    <section aria-label="terminal-pairing">
      <PairingCodeDisplay
        locale={props.locale}
        code={props.issued.code}
        life={props.life}
        status={props.session}
        wording={TERMINAL_WORDING}
      >
        {face === "live" ? (
          <p>
            <button
              type="button"
              className="kl-btn kl-btn-ghost kl-btn-sm"
              onClick={props.onCancel}
              disabled={props.cancelling}
            >
              {props.cancelling ? t.cancelling : t.cancelSession}
            </button>
          </p>
        ) : null}
      </PairingCodeDisplay>
    </section>
  );
}

export interface PairingState {
  readonly terminalId: string;
  readonly issued: IssuedTerminalCode;
  readonly session: TerminalSessionStatus | null;
  readonly cancelling: boolean;
  readonly cancelled: boolean;
  readonly gone: boolean;
}

export function TerminalsView(props: {
  locale: KitluyLocale;
  store: PartnerStore;
  readiness: HubReadiness;
  terminals: readonly PhysicalTerminal[];
  ladders: ReadonlyMap<string, readonly LadderRung[]>;
  vocabulary: RoleVocabulary;
  dataAsOf: string | undefined;
  now: Date;
  pairing: PairingState | null;
  life: CodeLife | null;
  busyTerminalId: string | null;
  defineBusy: boolean;
  defineNotice: string | null;
  pairNotice: { readonly terminalId: string; readonly message: string } | null;
  canPair: { readonly allowed: true } | { readonly allowed: false; readonly reason: PairBlock };
  onDefine: (input: {
    readonly storeLocationId: string;
    readonly label: string;
    readonly terminalProfileKeys: readonly string[];
  }) => void;
  onPair: (terminalId: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const t = MESSAGES[props.locale];
  return (
    <section aria-label="terminals">
      <div className="kl-page-head">
        <h1>{t.terminalsTitle}</h1>
        <p>{t.terminalsIntro}</p>
      </div>
      <HubReadinessLine
        locale={props.locale}
        readiness={props.readiness}
        storeId={props.store.digitalStoreId}
      />
      {props.dataAsOf === undefined ? null : (
        <p className="kl-muted" style={{ marginTop: 0 }}>
          {t.dataAsOf} {props.dataAsOf}
        </p>
      )}

      {props.terminals.length === 0 ? (
        <div className="kl-card">
          <div className="kl-card-body">
            <DataSurface state="empty" />
            <p className="kl-muted">{t.noTerminals}</p>
          </div>
        </div>
      ) : (
        <div className="kl-card">
          <div className="kl-card-body kl-tight">
            <div className="kl-table-wrap">
              <table className="kl-table">
                <thead>
                  <tr>
                    <th scope="col">{t.terminalColumn}</th>
                    <th scope="col">{t.profilesColumn}</th>
                    <th scope="col">{t.locationColumn}</th>
                    <th scope="col">{t.deviceColumn}</th>
                    <th scope="col">{t.progressColumn}</th>
                    <th scope="col">{t.actionColumn}</th>
                  </tr>
                </thead>
                <tbody>
                  {props.terminals.map((terminal) => {
                    const busy = props.busyTerminalId === terminal.physicalTerminalId;
                    const pairingHere =
                      props.pairing !== null &&
                      props.pairing.terminalId === terminal.physicalTerminalId;
                    return (
                      <tr
                        key={terminal.physicalTerminalId}
                        data-terminal={terminal.physicalTerminalId}
                      >
                        <td>
                          <strong>{terminal.label}</strong>
                        </td>
                        <td>
                          {terminal.terminalProfileKeys.map((key, i) => {
                            const short = roleShortCode(key);
                            return (
                              <span key={key}>
                                {i > 0 ? " + " : ""}
                                {short === null ? (
                                  <>
                                    <span style={{ fontFamily: MONO }}>{key}</span>{" "}
                                    <small>({t.profileNotRecognised})</small>
                                  </>
                                ) : (
                                  short
                                )}
                              </span>
                            );
                          })}
                        </td>
                        <td>{terminal.locationReference ?? "—"}</td>
                        <td>
                          {terminal.boundDevice === null ? (
                            <span className="kl-muted">{t.noBoundDevice}</span>
                          ) : (
                            <span style={{ fontFamily: MONO }}>
                              {terminal.boundDevice.deviceReference}
                            </span>
                          )}
                        </td>
                        <td>
                          <ProvisioningLadder
                            locale={props.locale}
                            rungs={props.ladders.get(terminal.physicalTerminalId) ?? []}
                          />
                        </td>
                        <td>
                          {props.canPair.allowed ? (
                            <button
                              type="button"
                              className="kl-btn kl-btn-primary kl-btn-sm"
                              disabled={busy || props.defineBusy}
                              onClick={() => props.onPair(terminal.physicalTerminalId)}
                            >
                              {busy ? t.pairingBusy : t.pair}
                            </button>
                          ) : (
                            <p
                              role="status"
                              data-blocked={props.canPair.reason}
                              className="kl-muted"
                              style={{ margin: 0 }}
                            >
                              {t[BLOCK_MESSAGE[props.canPair.reason]]}
                            </p>
                          )}
                          {props.pairNotice !== null &&
                          props.pairNotice.terminalId === terminal.physicalTerminalId ? (
                            <p role="alert" data-pair-notice={terminal.physicalTerminalId}>
                              {props.pairNotice.message}
                            </p>
                          ) : null}
                          {pairingHere && props.pairing !== null && props.life !== null ? (
                            <TerminalPairPanel
                              locale={props.locale}
                              issued={props.pairing.issued}
                              session={props.pairing.session}
                              life={props.life}
                              cancelling={props.pairing.cancelling}
                              cancelled={props.pairing.cancelled}
                              gone={props.pairing.gone}
                              onCancel={props.onCancel}
                            />
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      <p role="note" className="kl-muted">
        {t.ladderHonesty}
      </p>

      <div className="kl-card" style={{ marginTop: 16, maxWidth: 640 }}>
        <div className="kl-card-body">
          <DefineTerminalForm
            locale={props.locale}
            locations={props.store.locations}
            vocabulary={props.vocabulary}
            busy={props.defineBusy}
            notice={props.defineNotice}
            onSubmit={props.onDefine}
          />
        </div>
      </div>
    </section>
  );
}
