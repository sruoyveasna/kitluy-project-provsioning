/**
 * Presentational views for the Admin Portal.
 *
 * Every component here is a pure function of its props — no fetching, no
 * session access, no clock. That is what makes each operational state (loading,
 * refused, unreachable, abnormal device) renderable in a test without a
 * browser, and it is the reason those states can be asserted rather than
 * assumed.
 */
import { useState, type FormEvent, type ReactNode } from "react";
import type { KitluyLocale } from "@kitluy/localization";
import { DataSurface, kitluyTokens } from "@kitluy/web-ui";
import {
  holdsPermission,
  PERMISSION_FLEET_ENROLLMENT_APPROVE,
  PERMISSION_PARTNERS_READ,
  PERMISSION_STORE_CREATE,
  type AccessState,
} from "./access.js";
import {
  conditionColor,
  conditionLabel,
  deviceCondition,
  filterByClass,
  freshnessLabel,
  hubAssignmentSummary,
  lifecycleLabel,
  summariseFleet,
  terminalAssignmentSummary,
  anyDeviceHasReported,
  sortForOperator,
  type FleetSummary,
  type DeviceClassFilter,
} from "./device-presentation.js";
import type {
  CreateStoreResult,
  DeviceDetail,
  FleetDeviceView,
  FleetPage,
  PendingPage,
  PendingRegistrationView,
  StoreCreationOptions,
  StoreListPage,
} from "./management-client.js";
import { t, type MessageKey } from "./messages.js";
import { routeHref, type Route } from "./routing.js";
import { FAILURE_MESSAGE, type SignInState } from "./sign-in.js";

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

export function LoginView(props: {
  locale: KitluyLocale;
  state: SignInState;
  /** Denial carried over from a guard decision, e.g. a disabled account. */
  notice?: MessageKey | undefined;
  onSubmit: (email: string, password: string) => void;
}): JSX.Element {
  const { locale, state } = props;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const submitting = state.kind === "submitting";

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    props.onSubmit(email, password);
  };

  return (
    <section aria-label="sign-in" className="kl-login">
      <div className="kl-card" style={{ width: "100%", maxWidth: 420 }}>
        <div className="kl-card-body">
          <div className="kl-page-head">
            <h1>{t(locale, "signIn")}</h1>
            <p>{t(locale, "boundary")}</p>
          </div>

          {props.notice !== undefined ? (
            <div className="kl-notice kl-notice-warn" role="status" data-notice={props.notice}>
              {t(locale, props.notice)}
            </div>
          ) : null}

          <form onSubmit={submit}>
            <div className="kl-field">
              <label htmlFor="email">{t(locale, "email")}</label>
              <input
                className="kl-input"
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                value={email}
                disabled={submitting}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="kl-field">
              <label htmlFor="password">{t(locale, "password")}</label>
              <input
                className="kl-input"
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                disabled={submitting}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            {state.kind === "failed" ? (
              <div
                className="kl-notice kl-notice-critical"
                role="alert"
                data-sign-in-failure={state.failure}
              >
                {t(locale, FAILURE_MESSAGE[state.failure])}
              </div>
            ) : null}

            <button
              className="kl-btn kl-btn-primary"
              type="submit"
              disabled={submitting}
              data-state={state.kind}
            >
              {submitting ? t(locale, "signingIn") : t(locale, "signIn")}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

/** A sidebar link. Highlighted (`aria-current="page"`) when its route is live. */
function NavItem(props: {
  href: string;
  label: string;
  icon: ReactNode;
  active: boolean;
}): JSX.Element {
  return (
    <a className="kl-nav-item" href={props.href} aria-current={props.active ? "page" : undefined}>
      <span className="kl-ic" aria-hidden="true">
        {props.icon}
      </span>
      {props.label}
    </a>
  );
}

const ICON_FLEET = (
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
const ICON_PENDING = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
const ICON_STORES = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 9h16l-1-4H5L4 9z" />
    <path d="M5 9v10h14V9M9 19v-5h6v5" />
  </svg>
);
const ICON_NEW_STORE = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v8M8 12h8" />
  </svg>
);

/**
 * The left sidebar. Two groups: the fleet (devices, and the approval queue for
 * whoever can approve) and the business (Digital Stores, and their creation for
 * whoever can create one).
 *
 * Every link is PRESENTATION only — the API re-decides authority on each request
 * and refuses anyone who reaches a route without the permission (CLAUDE.md hard
 * rule 7). Gating a link merely avoids offering an operator a dead end.
 */
export function AdminNav(props: {
  locale: KitluyLocale;
  access: AccessState;
  route: Route;
}): JSX.Element {
  const { locale, access, route } = props;
  const canApprove = holdsPermission(access, PERMISSION_FLEET_ENROLLMENT_APPROVE);
  const canReadStores = holdsPermission(access, PERMISSION_PARTNERS_READ);
  const canCreateStore = holdsPermission(access, PERMISSION_STORE_CREATE);
  return (
    <nav aria-label="admin" className="kl-nav">
      <div className="kl-nav-label">{t(locale, "navFleet")}</div>
      <NavItem
        href={routeHref({ kind: "devices" })}
        label={t(locale, "devices")}
        icon={ICON_FLEET}
        active={route.kind === "devices" || route.kind === "device"}
      />
      {canApprove ? (
        <NavItem
          href={routeHref({ kind: "pending" })}
          label={t(locale, "pendingNav")}
          icon={ICON_PENDING}
          active={route.kind === "pending"}
        />
      ) : null}
      {canReadStores || canCreateStore ? (
        <>
          <div className="kl-nav-label">{t(locale, "navBusiness")}</div>
          {canReadStores ? (
            <NavItem
              href={routeHref({ kind: "stores" })}
              label={t(locale, "storesNav")}
              icon={ICON_STORES}
              active={route.kind === "stores"}
            />
          ) : null}
          {canCreateStore ? (
            <NavItem
              href={routeHref({ kind: "store_new" })}
              label={t(locale, "newStoreNav")}
              icon={ICON_NEW_STORE}
              active={route.kind === "store_new"}
            />
          ) : null}
        </>
      ) : null}
    </nav>
  );
}

/**
 * A refusal or outage panel. Never rendered in place of data that exists.
 *
 * The explanation is a SIBLING of the data surface, not its child: `DataSurface`
 * renders children only for the `partial` and `stale` states, so nesting the
 * reason inside an `unavailable` surface would silently drop it and leave an
 * operator with "Unavailable" and nothing else.
 */
export function NoticePanel(props: {
  locale: KitluyLocale;
  messageKey: MessageKey;
  detail?: string | undefined;
  children?: ReactNode;
}): JSX.Element {
  return (
    <section aria-label="notice">
      <DataSurface state="unavailable" />
      <p role="alert" data-notice={props.messageKey}>
        {t(props.locale, props.messageKey)}
      </p>
      {props.detail !== undefined ? <p>{props.detail}</p> : null}
      {props.children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Fleet
// ---------------------------------------------------------------------------

function ConditionBadge(props: { device: FleetDeviceView; locale: KitluyLocale }): JSX.Element {
  const condition = deviceCondition(props.device);
  return (
    <span
      data-condition={condition}
      style={{ color: conditionColor(condition), fontWeight: condition === "normal" ? 400 : 700 }}
    >
      {conditionLabel(condition, props.locale)}
    </span>
  );
}

/**
 * A Hub's readiness to serve its Store.
 *
 * Rendered only for `store_hub`, and separately from the condition badge: a Hub
 * at `pending_trust` is not faulty — it paired correctly and waits on
 * certificate-backed activation (BLK-005) — but its Store still cannot provision
 * Terminals. "Broken" and "waiting" need different answers from an operator.
 */
function HubAssignmentCell(props: { device: FleetDeviceView; locale: KitluyLocale }): JSX.Element {
  const summary = hubAssignmentSummary(props.device);
  if (summary === null) return <>—</>;
  return (
    <>
      {summary.state}
      <br />
      <small>{t(props.locale, summary.serving ? "hubServing" : "hubNotServing")}</small>
    </>
  );
}

/**
 * A Terminal's place in the four stages: unassigned, assigned and awaiting
 * activation, active. The Store label and the profile count sit under the
 * word so an operator sees WHICH shop and HOW MANY roles without opening the
 * row. An unknown assignment state is printed verbatim.
 */
function TerminalAssignmentCell(props: {
  device: FleetDeviceView;
  locale: KitluyLocale;
}): JSX.Element {
  const summary = terminalAssignmentSummary(props.device);
  if (summary === null) return <>—</>;
  if (summary.kind === "unassigned") {
    return (
      <span data-terminal-assignment="unassigned">{t(props.locale, "terminalUnassigned")}</span>
    );
  }
  if (summary.kind === "other") {
    return <span data-terminal-assignment="other">{summary.state}</span>;
  }
  return (
    <span data-terminal-assignment={summary.kind}>
      {t(props.locale, summary.kind === "active" ? "terminalActive" : "terminalAssignedAwaiting")}
      <br />
      <small style={{ color: kitluyTokens.colorMuted }}>
        {`${summary.profiles} ${t(props.locale, "terminalProfiles")}`}
        {summary.store === null ? "" : ` · ${summary.store}`}
      </small>
    </span>
  );
}

/** One cell for the assignment column, whichever class the device is. */
function AssignmentCell(props: { device: FleetDeviceView; locale: KitluyLocale }): JSX.Element {
  if (props.device.deviceClass === "store_hub") {
    return <HubAssignmentCell device={props.device} locale={props.locale} />;
  }
  return <TerminalAssignmentCell device={props.device} locale={props.locale} />;
}

/**
 * A single counted fact about the fleet.
 *
 * The `urgent` variant is reserved for counts that mean a PERSON is being waited
 * on. Colour is redundant with the label, never the only cue.
 */
function StatTile(props: {
  label: string;
  value: number;
  tone?: "urgent" | "bad" | "plain";
  href?: string;
}): JSX.Element {
  const tone = props.tone ?? "plain";
  const className =
    tone === "urgent" ? "kl-tile kl-accent" : tone === "bad" ? "kl-tile kl-critical" : "kl-tile";

  const body = (
    <>
      <div className="kl-n">{props.value}</div>
      <div className="kl-l">{props.label}</div>
    </>
  );

  return props.href === undefined ? (
    <div className={className} data-stat={props.label}>
      {body}
    </div>
  ) : (
    <a className={className} href={props.href} data-stat={props.label}>
      {body}
    </a>
  );
}

/**
 * What needs a person, answered before any table is read.
 *
 * This exists because the fleet screen previously answered "here are your
 * devices" and left "is anything waiting for me?" to be worked out by reading
 * every row's lifecycle enum. The pending queue was a nav link that was easy to
 * miss entirely.
 */
export function FleetSummaryBar(props: {
  locale: KitluyLocale;
  summary: FleetSummary;
  canApprove: boolean;
}): JSX.Element {
  const { locale, summary } = props;
  return (
    <div aria-label="fleet-summary" className="kl-tiles" style={{ margin: "0 0 1rem" }}>
      <StatTile label={t(locale, "summaryTotal")} value={summary.total} />
      <StatTile
        label={t(locale, "summaryAwaiting")}
        value={summary.awaitingApproval}
        tone={summary.awaitingApproval > 0 ? "urgent" : "plain"}
        {...(props.canApprove && summary.awaitingApproval > 0
          ? { href: routeHref({ kind: "pending" }) }
          : {})}
      />
      <StatTile
        label={t(locale, "summaryIncidents")}
        value={summary.withIncidents}
        tone={summary.withIncidents > 0 ? "bad" : "plain"}
      />
      <StatTile
        label={t(locale, "summaryContained")}
        value={summary.contained}
        tone={summary.contained > 0 ? "bad" : "plain"}
      />
      <StatTile label={t(locale, "summaryAssignedAwaiting")} value={summary.assignedAwaiting} />
      <StatTile label={t(locale, "summaryHubs")} value={summary.hubs} />
    </div>
  );
}

/** Lifecycle as a pill: plain words, with a dot carrying the same meaning. */
function StatusPill(props: { device: FleetDeviceView; locale: KitluyLocale }): JSX.Element {
  const condition = deviceCondition(props.device);
  const awaiting = props.device.lifecycle === "manufactured";
  const color = awaiting ? kitluyTokens.colorPrimary : conditionColor(condition);
  return (
    <span
      data-lifecycle={props.device.lifecycle}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: ".4rem",
        whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: ".55rem",
          height: ".55rem",
          borderRadius: "50%",
          background: color,
          flex: "0 0 auto",
        }}
      ></span>
      <span style={{ color, fontWeight: awaiting || condition !== "normal" ? 700 : 400 }}>
        {lifecycleLabel(props.device.lifecycle, props.locale)}
      </span>
      {/* The condition word stays alongside the lifecycle. "Quarantined" says
          which abnormality; "Abnormal" says that it IS one, and a screen that
          dropped the second would present containment as just another state. */}
      {condition === "normal" ? null : (
        <>
          {" "}
          <ConditionBadge device={props.device} locale={props.locale} />
        </>
      )}
    </span>
  );
}

export function DeviceListView(props: {
  locale: KitluyLocale;
  page: FleetPage;
  /** Presentation only — the API re-decides authority on every request. */
  canApprove?: boolean;
}): JSX.Element {
  const { locale, page } = props;
  const [classFilter, setClassFilter] = useState<DeviceClassFilter>("all");
  const canApprove = props.canApprove ?? false;

  if (page.devices.length === 0) {
    return (
      <section aria-label="devices">
        <div className="kl-page-head">
          <h1>{t(locale, "devices")}</h1>
        </div>
        <DataSurface state="empty" />
      </section>
    );
  }

  const visible = filterByClass(page.devices, classFilter);
  const summary = summariseFleet(page.devices);
  const reported = anyDeviceHasReported(page.devices);

  return (
    <section aria-label="devices">
      <div className="kl-page-head">
        <h1>{t(locale, "devices")}</h1>
      </div>

      <FleetSummaryBar locale={locale} summary={summary} canApprove={canApprove} />

      {/* The banner an operator cannot miss. Shown only when a decision is
          actually outstanding — a permanent "0 waiting" banner trains people to
          ignore the space where the real message will appear. */}
      {summary.awaitingApproval > 0 && canApprove ? (
        <p
          role="status"
          data-action-needed={summary.awaitingApproval}
          className="kl-notice"
          style={{
            background: "var(--kl-accent-subtle)",
            color: "var(--kl-text)",
            borderLeft: "3px solid var(--kl-accent)",
            margin: "0 0 1rem",
          }}
        >
          <strong>{t(locale, "actionNeeded")}:</strong> {summary.awaitingApproval}{" "}
          {t(locale, "summaryAwaiting")}.{" "}
          <a href={routeHref({ kind: "pending" })}>{t(locale, "reviewNow")}</a>
        </p>
      ) : null}

      <p>
        {t(locale, "deviceCount")}: {page.count}
      </p>
      {page.truncated ? <p role="alert">{t(locale, "truncated")}</p> : null}

      {/* TWO DIFFERENT FACTS, both true, so both are said.
          The first is about the POLICY — whether a threshold has been ruled at
          all, which decides whether this portal may ever use the word "online".
          The second is about the DATA — that no device has reported anything
          yet. Collapsing them would drop a caveat that still applies the moment
          reporting starts. Said once here rather than as "Unknown" on every row,
          because a per-row ambiguity reads as "offline". */}
      <p role="note">
        {t(locale, page.freshnessPolicyRuled ? "freshnessDevelopmentDefault" : "freshnessUnruled")}
      </p>
      {reported ? null : (
        <p role="note" data-no-reporting="true">
          {t(locale, "noReporting")}
        </p>
      )}

      <div className="kl-field" style={{ maxWidth: 300 }}>
        <label htmlFor="device-class">{t(locale, "showClass")}</label>
        <select
          className="kl-select"
          id="device-class"
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value as DeviceClassFilter)}
        >
          <option value="all">{t(locale, "classAll")}</option>
          <option value="store_hub">{t(locale, "classStoreHub")}</option>
          <option value="terminal">{t(locale, "classTerminal")}</option>
        </select>
        {classFilter === "all" ? null : (
          <small className="kl-muted" role="note">
            {t(locale, "filteredFromPage")}
          </small>
        )}
      </div>

      {visible.length === 0 ? (
        <p role="note">{t(locale, "noneOfClass")}</p>
      ) : (
        <div className="kl-table-wrap">
          <table className="kl-table">
            <thead>
              <tr>
                <th scope="col">{t(locale, "devices")}</th>
                <th scope="col">{t(locale, "statusColumn")}</th>
                <th scope="col">{t(locale, "assignment")}</th>
                <th scope="col">{t(locale, "reporting")}</th>
                <th scope="col">{t(locale, "openIncidents")}</th>
              </tr>
            </thead>
            <tbody>
              {sortForOperator(visible).map((device) => (
                <tr key={device.deviceId} data-device-condition={deviceCondition(device)}>
                  <td>
                    <a href={routeHref({ kind: "device", deviceId: device.deviceId })}>
                      {device.deviceReference}
                    </a>
                    <br />
                    <small style={{ color: kitluyTokens.colorMuted }}>{device.deviceClass}</small>
                  </td>
                  <td>
                    <StatusPill device={device} locale={locale} />
                  </td>
                  <td data-hub-serving={hubAssignmentSummary(device)?.serving ?? undefined}>
                    <AssignmentCell device={device} locale={locale} />
                  </td>
                  <td>
                    {device.lastSeenAt === null
                      ? t(locale, "neverReported")
                      : freshnessLabel(device.freshness, locale)}
                  </td>
                  <td>
                    {device.openIncidentCount > 0 ? (
                      <strong style={{ color: kitluyTokens.colorDanger }}>
                        {device.openIncidentCount}
                      </strong>
                    ) : (
                      device.openIncidentCount
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Field(props: { label: string; children: ReactNode }): JSX.Element {
  return (
    <p style={{ display: "flex", flexWrap: "wrap", gap: "0 12px", margin: "0 0 10px" }}>
      <strong style={{ minWidth: 150, color: "var(--kl-text-muted)", fontWeight: 600 }}>
        {props.label}
      </strong>
      <span>{props.children}</span>
    </p>
  );
}

export function DeviceDetailView(props: {
  locale: KitluyLocale;
  detail: DeviceDetail;
}): JSX.Element {
  const { locale } = props;
  const { device, provisioning } = props.detail;
  const condition = deviceCondition(device);

  return (
    <section aria-label="device">
      <p style={{ margin: "0 0 12px" }}>
        <a href={routeHref({ kind: "devices" })}>← {t(locale, "back")}</a>
      </p>
      <div className="kl-page-head">
        <h1 className="kl-mono">{device.deviceReference}</h1>
      </div>

      <div className="kl-card" style={{ marginBottom: 16 }}>
        <div className="kl-card-body">
          <p
            data-condition={condition}
            style={{ color: conditionColor(condition), fontWeight: 700, margin: "0 0 12px" }}
          >
            {conditionLabel(condition, locale)}
          </p>

          {/* The plain words AND the raw enum: the words are what an operator
              reads, the enum is what they quote back over the phone. */}
          <Field label={t(locale, "lifecycle")}>
            {lifecycleLabel(device.lifecycle, locale)} <code>{device.lifecycle}</code>
          </Field>
          <Field label={t(locale, "assignment")}>
            <AssignmentCell device={device} locale={locale} />
          </Field>
          <Field label={t(locale, "lastSeen")}>
            {freshnessLabel(device.freshness, locale)}
            {device.lastSeenAt !== null ? ` · ${device.lastSeenAt}` : ""}
          </Field>
          <Field label={t(locale, "openIncidents")}>{device.openIncidentCount}</Field>

          <p role="note" className="kl-muted" style={{ margin: 0 }}>
            {t(
              locale,
              props.detail.freshnessPolicyRuled
                ? "freshnessDevelopmentDefault"
                : "freshnessUnruled",
            )}
          </p>
        </div>
      </div>

      <div className="kl-card">
        <div className="kl-card-body">
          <h2 style={{ margin: "0 0 10px", fontSize: 16 }}>
            {t(locale, provisioning.eligible ? "provisioningEligible" : "provisioningRefused")}
          </h2>
          {provisioning.reasons.length > 0 ? (
            <ul data-provisioning="refused">
              {provisioning.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
          {/* Issuance is a governed mutation and is deliberately not reachable
              from this slice — saying so is better than an inert button. */}
          <p className="kl-muted" style={{ margin: 0 }}>
            <em>{t(locale, "provisioningNotHere")}</em>
          </p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Verify & approve
// ---------------------------------------------------------------------------

/**
 * One evidence row.
 *
 * Rendered as `dt`/`dd` rather than a table cell because a verifier reads these
 * aloud while holding the board — a definition list is the shape that survives
 * being read one item at a time on a narrow screen.
 */
function Evidence(props: { label: string; value: string | number | null }): JSX.Element {
  return (
    <>
      <dt style={{ color: "var(--kl-text-muted)", fontSize: 12 }}>{props.label}</dt>
      <dd className="kl-mono" style={{ margin: "0 0 0.5rem 0" }}>
        {props.value === null || props.value === "" ? "—" : String(props.value)}
      </dd>
    </>
  );
}

/**
 * The approval form for ONE pending device.
 *
 * ===========================================================================
 * WHY THIS IS NOT A BUTTON
 * ===========================================================================
 * Plan §4.4 supersedes the old "never approve an unknown Pi" rule in exactly one
 * narrow way: an Admin may approve an observed device AFTER explicit HET
 * hardware verification. A single "Trust device" button would be precisely the
 * casual action that rule forbids — so approval requires a typed reason and a
 * verification evidence reference, and the submit control stays disabled until
 * both exist.
 *
 * The fields are not ceremony. `verificationEvidenceRef` is what makes the
 * immutable audit record answer "what was checked", not merely "who clicked".
 */
export function ApprovalForm(props: {
  locale: KitluyLocale;
  device: PendingRegistrationView;
  fourEyesRequired: boolean;
  busy: boolean;
  onApprove: (input: {
    reason: string;
    verificationEvidenceRef: string;
    secondApproverRef?: string;
  }) => void;
}): JSX.Element {
  const { locale, device } = props;
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [second, setSecond] = useState("");

  const ready =
    reason.trim() !== "" &&
    evidence.trim() !== "" &&
    (!props.fourEyesRequired || second.trim() !== "");

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!ready || props.busy) return;
    props.onApprove({
      reason: reason.trim(),
      verificationEvidenceRef: evidence.trim(),
      ...(props.fourEyesRequired ? { secondApproverRef: second.trim() } : {}),
    });
  };

  // An unapprovable device shows WHY instead of a form. A disabled control with
  // no explanation is how an operator concludes the portal is broken.
  if (!device.approvable) {
    return (
      <p role="status" data-blocked="true" className="kl-notice kl-notice-warn">
        <span>
          <strong>{t(locale, "approveBlocked")}:</strong> {device.blockingReasons.join(" · ")}
        </span>
      </p>
    );
  }

  return (
    <form onSubmit={submit} aria-label={`approve-${device.deviceId}`}>
      <div className="kl-field">
        <label htmlFor={`approve-reason-${device.deviceId}`}>{t(locale, "approveReason")}</label>
        <input
          className="kl-input"
          id={`approve-reason-${device.deviceId}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          name="reason"
        />
      </div>
      <div className="kl-field">
        <label htmlFor={`approve-evidence-${device.deviceId}`}>
          {t(locale, "approveEvidence")}
        </label>
        <input
          className="kl-input"
          id={`approve-evidence-${device.deviceId}`}
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
          required
          name="verificationEvidenceRef"
        />
      </div>
      {props.fourEyesRequired ? (
        <div className="kl-field">
          <label htmlFor={`approve-second-${device.deviceId}`}>{t(locale, "approveSecond")}</label>
          <input
            className="kl-input"
            id={`approve-second-${device.deviceId}`}
            value={second}
            onChange={(e) => setSecond(e.target.value)}
            required
            name="secondApproverRef"
          />
        </div>
      ) : null}
      <button type="submit" disabled={!ready || props.busy} className="kl-btn kl-btn-primary">
        {props.busy ? t(locale, "approving") : t(locale, "approveAction")}
      </button>
    </form>
  );
}

/**
 * The queue of devices waiting for a HET decision.
 *
 * Every value is labelled as REPORTED. The intro says so once in plain words and
 * the field labels repeat it, because the single most dangerous way to read this
 * screen is as a list of facts the system has established.
 */
export function PendingApprovalsView(props: {
  locale: KitluyLocale;
  page: PendingPage;
  /** Presentation gate only; the API re-decides authority on every call. */
  canApprove: boolean;
  busyDeviceId: string | null;
  notice?: { readonly deviceId: string; readonly message: string } | undefined;
  onApprove: (
    deviceId: string,
    input: { reason: string; verificationEvidenceRef: string; secondApproverRef?: string },
  ) => void;
}): JSX.Element {
  const { locale, page } = props;

  return (
    <section aria-label="pending-approvals">
      <div className="kl-page-head">
        <h1>{t(locale, "pendingTitle")}</h1>
        <p>{t(locale, "pendingIntro")}</p>
      </div>

      {!props.canApprove ? (
        <p role="status" data-notice="approveNotPermitted" className="kl-notice kl-notice-warn">
          <span>{t(locale, "approveNotPermitted")}</span>
        </p>
      ) : null}

      {page.pending.length === 0 ? (
        <>
          <DataSurface state="empty" />
          <p>{t(locale, "pendingNone")}</p>
        </>
      ) : null}

      {page.pending.map((device) => (
        <article
          key={device.deviceId}
          data-device-id={device.deviceId}
          className="kl-card"
          style={{ marginBottom: "1rem" }}
        >
          <div className="kl-card-body">
            <h2 className="kl-mono" style={{ marginTop: 0, fontSize: 16 }}>
              {device.deviceReference}
            </h2>

            <dl>
              <Evidence label={t(locale, "pendingHostname")} value={device.reportedHostname} />
              <Evidence label={t(locale, "pendingBoardSerial")} value={device.claimedBoardSerial} />
              <Evidence label={t(locale, "pendingSocSerial")} value={device.claimedSocSerial} />
              <Evidence label={t(locale, "pendingMac")} value={device.claimedMacAddress} />
              <Evidence label={t(locale, "pendingProfile")} value={device.hardwareProfile} />
              <Evidence
                label={t(locale, "pendingGeneration")}
                value={device.installationGeneration}
              />
              <Evidence
                label={t(locale, "pendingFingerprint")}
                value={device.registrationKeyFingerprint}
              />
              <Evidence label={t(locale, "pendingFirstSeen")} value={device.firstSeenAt} />
              <Evidence
                label={t(locale, "pendingLastRegistration")}
                value={device.lastRegistrationAt}
              />
              {/* The device id is shown because contract §9 makes it the one
                identifier a pending device receives — it is what an operator on
                the phone can quote back. */}
              <Evidence label="device id" value={device.deviceId} />
            </dl>

            {device.suspectedCredentialReuse ? (
              <p role="alert" data-alert="credential-reuse" style={{ fontWeight: 700 }}>
                {t(locale, "pendingCredentialReuse")}
              </p>
            ) : null}

            {device.openIncidents.length > 0 ? (
              <ul data-incidents={device.openIncidents.length}>
                {device.openIncidents.map((incident) => (
                  <li key={`${incident.incidentType}-${incident.detectedAt}`}>
                    <strong>{incident.severity}</strong> {incident.incidentType}
                    {incident.detail === null ? null : ` — ${incident.detail}`}
                  </li>
                ))}
              </ul>
            ) : null}

            {props.notice !== undefined && props.notice.deviceId === device.deviceId ? (
              <p role="alert" data-approval-notice={device.deviceId}>
                {props.notice.message}
              </p>
            ) : null}

            {props.canApprove ? (
              <ApprovalForm
                locale={locale}
                device={device}
                fourEyesRequired={page.fourEyesRequired}
                busy={props.busyDeviceId === device.deviceId}
                onApprove={(input) => props.onApprove(device.deviceId, input)}
              />
            ) : null}
          </div>
        </article>
      ))}

      {page.truncated ? <p role="status">{t(locale, "truncated")}</p> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Digital Stores (owner decision v2.0.0 §2: the Admin creates the Store)
// ---------------------------------------------------------------------------

export function StoreListView(props: { locale: KitluyLocale; page: StoreListPage }): JSX.Element {
  const { locale, page } = props;
  return (
    <section aria-label="stores">
      <div className="kl-page-head">
        <h1>{t(locale, "storesTitle")}</h1>
      </div>
      {page.stores.length === 0 ? (
        <div className="kl-card">
          <div className="kl-card-body">
            <DataSurface state="empty" />
            <p className="kl-muted">{t(locale, "storesNone")}</p>
          </div>
        </div>
      ) : (
        <div className="kl-card">
          <div className="kl-card-body kl-tight">
            <div className="kl-table-wrap">
              <table className="kl-table">
                <thead>
                  <tr>
                    <th scope="col">{t(locale, "storeCode")}</th>
                    <th scope="col">{t(locale, "storeName")}</th>
                    <th scope="col">{t(locale, "storeTenant")}</th>
                    <th scope="col">{t(locale, "storeVertical")}</th>
                    <th scope="col">{t(locale, "storeStatus")}</th>
                    <th scope="col">{t(locale, "storeLocations")}</th>
                  </tr>
                </thead>
                <tbody>
                  {page.stores.map((store) => (
                    <tr key={store.digitalStoreId} data-store={store.storeCode}>
                      <td className="kl-mono" style={{ fontWeight: 600 }}>
                        {store.storeCode}
                      </td>
                      <td>{store.name}</td>
                      <td>{store.tenantReference}</td>
                      <td>{store.primaryVerticalCode}</td>
                      <td data-store-status={store.status}>
                        <span className="kl-badge kl-badge-neutral">{store.status}</span>
                      </td>
                      <td>
                        {store.locations.length === 0
                          ? t(locale, "storeNoLocations")
                          : store.locations
                              .map((l) => `${l.locationCode} — ${l.name} (${l.operatingStatus})`)
                              .join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {page.truncated ? (
        <p role="alert" className="kl-muted">
          {t(locale, "truncated")}
        </p>
      ) : null}
    </section>
  );
}

/**
 * The create form. Ready-gated like `ApprovalForm`: the submit stays disabled
 * until a Tenant, a code, a name, an ACTIVE vertical and a reason exist, and a
 * second approver when the SERVER says the environment needs one.
 */
export function StoreCreateView(props: {
  locale: KitluyLocale;
  options: StoreCreationOptions;
  canCreate: boolean;
  busy: boolean;
  notice:
    | { readonly kind: "created"; readonly result: CreateStoreResult }
    | { readonly kind: "refused"; readonly reason: string; readonly message: string }
    | null;
  onCreate: (input: {
    tenantId: string;
    storeCode: string;
    name: string;
    primaryVerticalCode: string;
    reason: string;
    grantExistingPartnerStaff: boolean;
    firstLocation?: { locationCode: string; name: string; addressLine1?: string; city?: string };
    secondApproverRef?: string;
  }) => void;
}): JSX.Element {
  const { locale, options } = props;
  const firstActive = options.verticals.find((v) => v.status === "ACTIVE");
  const [tenantId, setTenantId] = useState(options.tenants[0]?.tenantId ?? "");
  const [storeCode, setStoreCode] = useState("");
  const [name, setName] = useState("");
  const [vertical, setVertical] = useState(firstActive?.code ?? "");
  const [locationCode, setLocationCode] = useState("");
  const [locationName, setLocationName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [grant, setGrant] = useState(true);
  const [reason, setReason] = useState("");
  const [second, setSecond] = useState("");

  const tenant = options.tenants.find((tn) => tn.tenantId === tenantId);
  const verticalActive = options.verticals.some(
    (v) => v.code === vertical && v.status === "ACTIVE",
  );
  const locationHalfFilled = (locationCode.trim() === "") !== (locationName.trim() === "");
  const ready =
    tenantId !== "" &&
    /^[A-Za-z0-9][A-Za-z0-9-]{2,39}$/.test(storeCode.trim()) &&
    name.trim() !== "" &&
    verticalActive &&
    reason.trim() !== "" &&
    !locationHalfFilled &&
    (!options.fourEyesRequired || second.trim() !== "");

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!ready || props.busy) return;
    props.onCreate({
      tenantId,
      storeCode: storeCode.trim(),
      name: name.trim(),
      primaryVerticalCode: vertical,
      reason: reason.trim(),
      grantExistingPartnerStaff: grant,
      ...(locationCode.trim() !== "" && locationName.trim() !== ""
        ? {
            firstLocation: {
              locationCode: locationCode.trim(),
              name: locationName.trim(),
              ...(address.trim() === "" ? {} : { addressLine1: address.trim() }),
              ...(city.trim() === "" ? {} : { city: city.trim() }),
            },
          }
        : {}),
      ...(options.fourEyesRequired ? { secondApproverRef: second.trim() } : {}),
    });
  };

  if (!props.canCreate) {
    return (
      <section aria-label="store-create">
        <div className="kl-page-head">
          <h1>{t(locale, "newStoreTitle")}</h1>
        </div>
        <div className="kl-card">
          <div className="kl-card-body">
            <p role="status" data-notice="storeCreateNotPermitted" className="kl-muted">
              {t(locale, "storeCreateNotPermitted")}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="store-create">
      <div className="kl-page-head">
        <h1>{t(locale, "newStoreTitle")}</h1>
        <p>{t(locale, "newStoreIntro")}</p>
      </div>

      {props.notice?.kind === "created" ? (
        <div
          className="kl-notice kl-notice-good"
          data-store-created={props.notice.result.digitalStoreId}
          style={{ marginBottom: 16 }}
        >
          <div>
            <strong>{t(locale, "storeCreatedDone")}</strong> {props.notice.result.detail}
            <br />
            {t(locale, "auditEventId")}:{" "}
            <span className="kl-mono">{props.notice.result.auditEventId}</span>
            <br />
            <a href={routeHref({ kind: "stores" })}>{t(locale, "viewStores")}</a>
          </div>
        </div>
      ) : null}
      {props.notice?.kind === "refused" ? (
        <div
          className="kl-notice kl-notice-critical"
          role="alert"
          data-store-refused={props.notice.reason}
          style={{ marginBottom: 16 }}
        >
          {props.notice.message}
        </div>
      ) : null}

      <div className="kl-card" style={{ maxWidth: 620 }}>
        <div className="kl-card-body">
          <form onSubmit={submit} aria-label="create-store">
            <div className="kl-field">
              <label htmlFor="store-tenant">{t(locale, "fieldTenant")}</label>
              <select
                className="kl-select"
                id="store-tenant"
                name="tenantId"
                value={tenantId}
                disabled={props.busy}
                onChange={(e) => setTenantId(e.target.value)}
              >
                {options.tenants.map((tn) => (
                  <option key={tn.tenantId} value={tn.tenantId}>
                    {`${tn.tenantCode} — ${tn.displayName}${
                      tn.partnerVerificationStatus === null
                        ? ""
                        : ` (${tn.partnerVerificationStatus})`
                    }`}
                  </option>
                ))}
              </select>
            </div>
            <div className="kl-field">
              <label htmlFor="store-code">{t(locale, "fieldStoreCode")}</label>
              <input
                className="kl-input"
                id="store-code"
                name="storeCode"
                value={storeCode}
                disabled={props.busy}
                onChange={(e) => setStoreCode(e.target.value)}
              />
              <span className="kl-hint">{t(locale, "fieldStoreCodeRule")}</span>
            </div>
            <div className="kl-field">
              <label htmlFor="store-name">{t(locale, "fieldStoreName")}</label>
              <input
                className="kl-input"
                id="store-name"
                name="name"
                value={name}
                disabled={props.busy}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="kl-field">
              <label htmlFor="store-vertical">{t(locale, "fieldVertical")}</label>
              <select
                className="kl-select"
                id="store-vertical"
                name="primaryVerticalCode"
                value={vertical}
                disabled={props.busy}
                onChange={(e) => setVertical(e.target.value)}
              >
                {options.verticals.map((v) => (
                  <option key={v.code} value={v.code} disabled={v.status !== "ACTIVE"}>
                    {`${v.labels[locale] ?? v.code}${
                      v.status === "ACTIVE" ? "" : ` — ${t(locale, "verticalNotActive")}`
                    }`}
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="kl-fieldset kl-field">
              <legend>{t(locale, "fieldFirstLocation")}</legend>
              <div className="kl-field">
                <label htmlFor="location-code">{t(locale, "fieldLocationCode")}</label>
                <input
                  className="kl-input"
                  id="location-code"
                  name="locationCode"
                  value={locationCode}
                  disabled={props.busy}
                  onChange={(e) => setLocationCode(e.target.value)}
                />
              </div>
              <div className="kl-field">
                <label htmlFor="location-name">{t(locale, "fieldLocationName")}</label>
                <input
                  className="kl-input"
                  id="location-name"
                  name="locationName"
                  value={locationName}
                  disabled={props.busy}
                  onChange={(e) => setLocationName(e.target.value)}
                />
              </div>
              <div className="kl-field">
                <label htmlFor="location-address">{t(locale, "fieldAddress")}</label>
                <input
                  className="kl-input"
                  id="location-address"
                  name="addressLine1"
                  value={address}
                  disabled={props.busy}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>
              <div className="kl-field" style={{ marginBottom: 0 }}>
                <label htmlFor="location-city">{t(locale, "fieldCity")}</label>
                <input
                  className="kl-input"
                  id="location-city"
                  name="city"
                  value={city}
                  disabled={props.busy}
                  onChange={(e) => setCity(e.target.value)}
                />
              </div>
            </fieldset>
            <div className="kl-field">
              <label className="kl-check" style={{ padding: 0 }}>
                <input
                  type="checkbox"
                  name="grantExistingPartnerStaff"
                  checked={grant}
                  disabled={props.busy}
                  onChange={(e) => setGrant(e.target.checked)}
                />
                {t(locale, "fieldGrantPartnerStaff")}
              </label>
              <span className="kl-hint" data-partner-staff={tenant?.partnerStaffCount ?? 0}>
                {tenant === undefined || tenant.partnerStaffCount === 0
                  ? t(locale, "partnerStaffNone")
                  : `${tenant.partnerStaffCount} ${t(locale, "partnerStaffCount")}`}
              </span>
            </div>
            <div className="kl-field">
              <label htmlFor="store-reason">{t(locale, "fieldReason")}</label>
              <input
                className="kl-input"
                id="store-reason"
                name="reason"
                value={reason}
                disabled={props.busy}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            {options.fourEyesRequired ? (
              <div className="kl-field">
                <label htmlFor="store-second">{t(locale, "approveSecond")}</label>
                <input
                  className="kl-input"
                  id="store-second"
                  name="secondApproverRef"
                  value={second}
                  disabled={props.busy}
                  onChange={(e) => setSecond(e.target.value)}
                />
              </div>
            ) : null}
            <button type="submit" disabled={!ready || props.busy} className="kl-btn kl-btn-primary">
              {props.busy ? t(locale, "creatingStore") : t(locale, "createStoreAction")}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
