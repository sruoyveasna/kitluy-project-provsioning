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
  anyDeviceHasReported,
  sortForOperator,
  type FleetSummary,
  type DeviceClassFilter,
} from "./device-presentation.js";
import type {
  DeviceDetail,
  FleetDeviceView,
  FleetPage,
  PendingPage,
  PendingRegistrationView,
} from "./management-client.js";
import { t, type MessageKey } from "./messages.js";
import { routeHref } from "./routing.js";
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
    <section aria-label="sign-in">
      <h1>{t(locale, "signIn")}</h1>
      <p>{t(locale, "boundary")}</p>

      {props.notice !== undefined ? (
        <p role="status" data-notice={props.notice}>
          {t(locale, props.notice)}
        </p>
      ) : null}

      <form onSubmit={submit}>
        <p>
          <label htmlFor="email">{t(locale, "email")}</label>
          <br />
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            value={email}
            disabled={submitting}
            onChange={(event) => setEmail(event.target.value)}
          />
        </p>
        <p>
          <label htmlFor="password">{t(locale, "password")}</label>
          <br />
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={submitting}
            onChange={(event) => setPassword(event.target.value)}
          />
        </p>

        {state.kind === "failed" ? (
          <p
            role="alert"
            data-sign-in-failure={state.failure}
            style={{ color: kitluyTokens.colorDanger }}
          >
            {t(locale, FAILURE_MESSAGE[state.failure])}
          </p>
        ) : null}

        <button type="submit" disabled={submitting} data-state={state.kind}>
          {submitting ? t(locale, "signingIn") : t(locale, "signIn")}
        </button>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export function AdminNav(props: {
  locale: KitluyLocale;
  access: AccessState;
  onSignOut: () => void;
  onLocale: (locale: KitluyLocale) => void;
}): JSX.Element {
  const { locale } = props;
  return (
    <nav aria-label="admin" style={{ display: "flex", gap: "12px", alignItems: "baseline" }}>
      <a href={routeHref({ kind: "devices" })}>{t(locale, "devices")}</a>
      {/* Shown only to an Admin who holds the approval permission. This is
          PRESENTATION only — the API re-decides authority on every request, and a
          person who reaches the route without the permission is refused there
          (CLAUDE.md hard rule 7). Hiding it merely avoids offering a dead end. */}
      {holdsPermission(props.access, PERMISSION_FLEET_ENROLLMENT_APPROVE) ? (
        <a href={routeHref({ kind: "pending" })}>{t(locale, "pendingNav")}</a>
      ) : null}
      <span style={{ flex: 1 }} />
      <button onClick={() => props.onLocale("km-KH")} aria-pressed={locale === "km-KH"}>
        ខ្មែរ
      </button>
      <button onClick={() => props.onLocale("en-US")} aria-pressed={locale === "en-US"}>
        English
      </button>
      {props.access.kind === "granted" ? (
        <button onClick={props.onSignOut}>{t(locale, "signOut")}</button>
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
  const color =
    tone === "urgent"
      ? kitluyTokens.colorPrimary
      : tone === "bad"
        ? kitluyTokens.colorDanger
        : kitluyTokens.colorText;

  const body = (
    <>
      <div style={{ fontSize: "1.75rem", fontWeight: 700, color, lineHeight: 1.1 }}>
        {props.value}
      </div>
      <div style={{ fontSize: ".85rem", color: kitluyTokens.colorMuted }}>{props.label}</div>
    </>
  );

  const style = {
    border: `1px solid ${kitluyTokens.colorMuted}33`,
    borderRadius: kitluyTokens.radius,
    padding: ".75rem .9rem",
    minWidth: "8.5rem",
    textDecoration: "none",
    display: "block",
    color: "inherit",
  } as const;

  return props.href === undefined ? (
    <div style={style} data-stat={props.label}>
      {body}
    </div>
  ) : (
    <a style={style} href={props.href} data-stat={props.label}>
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
    <div
      aria-label="fleet-summary"
      style={{ display: "flex", gap: ".6rem", flexWrap: "wrap", margin: "0 0 1rem" }}
    >
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
        <h1>{t(locale, "devices")}</h1>
        <DataSurface state="empty" />
      </section>
    );
  }

  const visible = filterByClass(page.devices, classFilter);
  const summary = summariseFleet(page.devices);
  const reported = anyDeviceHasReported(page.devices);

  return (
    <section aria-label="devices">
      <h1>{t(locale, "devices")}</h1>

      <FleetSummaryBar locale={locale} summary={summary} canApprove={canApprove} />

      {/* The banner an operator cannot miss. Shown only when a decision is
          actually outstanding — a permanent "0 waiting" banner trains people to
          ignore the space where the real message will appear. */}
      {summary.awaitingApproval > 0 && canApprove ? (
        <p
          role="status"
          data-action-needed={summary.awaitingApproval}
          style={{
            border: `1px solid ${kitluyTokens.colorPrimary}`,
            borderLeft: `4px solid ${kitluyTokens.colorPrimary}`,
            borderRadius: kitluyTokens.radius,
            padding: ".8rem 1rem",
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

      <p>
        <label htmlFor="device-class">{t(locale, "showClass")}</label>{" "}
        <select
          id="device-class"
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value as DeviceClassFilter)}
        >
          <option value="all">{t(locale, "classAll")}</option>
          <option value="store_hub">{t(locale, "classStoreHub")}</option>
          <option value="pi_terminal">{t(locale, "classPiTerminal")}</option>
        </select>
        {classFilter === "all" ? null : (
          <>
            {" "}
            <small role="note">{t(locale, "filteredFromPage")}</small>
          </>
        )}
      </p>

      {visible.length === 0 ? (
        <p role="note">{t(locale, "noneOfClass")}</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th scope="col" style={TH}>
                {t(locale, "devices")}
              </th>
              <th scope="col" style={TH}>
                {t(locale, "statusColumn")}
              </th>
              <th scope="col" style={TH}>
                {t(locale, "assignment")}
              </th>
              <th scope="col" style={TH}>
                {t(locale, "reporting")}
              </th>
              <th scope="col" style={TH}>
                {t(locale, "openIncidents")}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortForOperator(visible).map((device) => (
              <tr key={device.deviceId} data-device-condition={deviceCondition(device)}>
                <td style={TD}>
                  <a href={routeHref({ kind: "device", deviceId: device.deviceId })}>
                    {device.deviceReference}
                  </a>
                  <br />
                  <small style={{ color: kitluyTokens.colorMuted }}>{device.deviceClass}</small>
                </td>
                <td style={TD}>
                  <StatusPill device={device} locale={locale} />
                </td>
                <td
                  style={TD}
                  data-hub-serving={hubAssignmentSummary(device)?.serving ?? undefined}
                >
                  <HubAssignmentCell device={device} locale={locale} />
                </td>
                <td style={TD}>
                  {device.lastSeenAt === null
                    ? t(locale, "neverReported")
                    : freshnessLabel(device.freshness, locale)}
                </td>
                <td style={TD}>
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
      )}
    </section>
  );
}

const TH = {
  textAlign: "left",
  padding: ".5rem .6rem",
  borderBottom: `2px solid ${kitluyTokens.colorMuted}44`,
  fontSize: ".8rem",
  textTransform: "uppercase",
  letterSpacing: ".04em",
  color: kitluyTokens.colorMuted,
  fontWeight: 500,
} as const;

const TD = {
  padding: ".65rem .6rem",
  borderBottom: `1px solid ${kitluyTokens.colorMuted}22`,
  verticalAlign: "top",
} as const;

function Field(props: { label: string; children: ReactNode }): JSX.Element {
  return (
    <p>
      <strong>{props.label}:</strong> {props.children}
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
      <p>
        <a href={routeHref({ kind: "devices" })}>← {t(locale, "back")}</a>
      </p>
      <h1>{device.deviceReference}</h1>

      <p data-condition={condition} style={{ color: conditionColor(condition), fontWeight: 700 }}>
        {conditionLabel(condition, locale)}
      </p>

      <Field label={t(locale, "lifecycle")}>{device.lifecycle}</Field>
      <Field label={t(locale, "lastSeen")}>
        {freshnessLabel(device.freshness, locale)}
        {device.lastSeenAt !== null ? ` · ${device.lastSeenAt}` : ""}
      </Field>
      <Field label={t(locale, "openIncidents")}>{device.openIncidentCount}</Field>

      <p role="note">
        {t(
          locale,
          props.detail.freshnessPolicyRuled ? "freshnessDevelopmentDefault" : "freshnessUnruled",
        )}
      </p>

      <h2>{t(locale, provisioning.eligible ? "provisioningEligible" : "provisioningRefused")}</h2>
      {provisioning.reasons.length > 0 ? (
        <ul data-provisioning="refused">
          {provisioning.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
      {/* Issuance is a governed mutation and is deliberately not reachable
          from this slice — saying so is better than an inert button. */}
      <p>
        <em>{t(locale, "provisioningNotHere")}</em>
      </p>
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
      <dt style={{ color: kitluyTokens.colorMuted }}>{props.label}</dt>
      <dd style={{ margin: "0 0 0.5rem 0", fontFamily: "monospace" }}>
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
      <p role="status" data-blocked="true" style={{ color: kitluyTokens.colorMuted }}>
        <strong>{t(locale, "approveBlocked")}:</strong> {device.blockingReasons.join(" · ")}
      </p>
    );
  }

  return (
    <form onSubmit={submit} aria-label={`approve-${device.deviceId}`}>
      <label>
        {t(locale, "approveReason")}
        <input value={reason} onChange={(e) => setReason(e.target.value)} required name="reason" />
      </label>
      <label>
        {t(locale, "approveEvidence")}
        <input
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
          required
          name="verificationEvidenceRef"
        />
      </label>
      {props.fourEyesRequired ? (
        <label>
          {t(locale, "approveSecond")}
          <input
            value={second}
            onChange={(e) => setSecond(e.target.value)}
            required
            name="secondApproverRef"
          />
        </label>
      ) : null}
      <button type="submit" disabled={!ready || props.busy}>
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
      <h1>{t(locale, "pendingTitle")}</h1>
      <p>{t(locale, "pendingIntro")}</p>

      {!props.canApprove ? (
        <p role="status" data-notice="approveNotPermitted">
          {t(locale, "approveNotPermitted")}
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
          style={{
            border: `1px solid ${kitluyTokens.colorMuted}`,
            borderRadius: kitluyTokens.radius,
            padding: "1rem",
            marginBottom: "1rem",
          }}
        >
          <h2 style={{ fontFamily: "monospace" }}>{device.deviceReference}</h2>

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
        </article>
      ))}

      {page.truncated ? <p role="status">{t(locale, "truncated")}</p> : null}
    </section>
  );
}
