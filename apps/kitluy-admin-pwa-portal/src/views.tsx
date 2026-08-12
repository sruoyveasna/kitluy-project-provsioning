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
import type { AccessState } from "./access.js";
import {
  conditionColor,
  conditionLabel,
  deviceCondition,
  freshnessLabel,
  sortForOperator,
} from "./device-presentation.js";
import type { DeviceDetail, FleetDeviceView, FleetPage } from "./management-client.js";
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

export function DeviceListView(props: { locale: KitluyLocale; page: FleetPage }): JSX.Element {
  const { locale, page } = props;
  if (page.devices.length === 0) {
    return (
      <section aria-label="devices">
        <h1>{t(locale, "devices")}</h1>
        <DataSurface state="empty" />
      </section>
    );
  }

  return (
    <section aria-label="devices">
      <h1>{t(locale, "devices")}</h1>
      <p>
        {t(locale, "deviceCount")}: {page.count}
      </p>
      {page.truncated ? <p role="alert">{t(locale, "truncated")}</p> : null}
      {/* Which caveat is shown is itself the truth claim: an unruled policy
          cannot report liveness at all, whereas a ruled DEVELOPMENT policy can
          — but must say that its thresholds are provisional. */}
      <p role="note">
        {t(locale, page.freshnessPolicyRuled ? "freshnessDevelopmentDefault" : "freshnessUnruled")}
      </p>

      <table>
        <thead>
          <tr>
            <th scope="col">{t(locale, "devices")}</th>
            <th scope="col">{t(locale, "lifecycle")}</th>
            <th scope="col">{t(locale, "lastSeen")}</th>
            <th scope="col">{t(locale, "openIncidents")}</th>
          </tr>
        </thead>
        <tbody>
          {sortForOperator(page.devices).map((device) => (
            <tr key={device.deviceId} data-device-condition={deviceCondition(device)}>
              <td>
                <a href={routeHref({ kind: "device", deviceId: device.deviceId })}>
                  {device.deviceReference}
                </a>
                <br />
                <small>{device.deviceClass}</small>
              </td>
              <td>
                {device.lifecycle} <ConditionBadge device={device} locale={locale} />
              </td>
              <td>{freshnessLabel(device.freshness, locale)}</td>
              <td>{device.openIncidentCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

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
