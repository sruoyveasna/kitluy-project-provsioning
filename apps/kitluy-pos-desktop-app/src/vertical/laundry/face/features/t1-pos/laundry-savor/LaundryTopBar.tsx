/**
 * The laundry top bar: brand, navigation, clock, Store Hub link, theme, the
 * terminal menu.
 *
 * PROVENANCE: donor `LaundryTopBar.tsx` (kitluy-laundry-pos-desk-app@8b2f107).
 * Gone: the exchange-rate pill (no published parity), Mode A/B chip (fixture
 * projections), booking notifications (Supabase realtime), the staff avatar,
 * "Back to terminals" (a terminal never chooses its identity) and "Log out"
 * (no staff login on a Pi — KLD-2026-09-17-TERMINAL-PIN-DEVICE-CREDENTIAL-001).
 * The user block became the TERMINAL block: what the runtime verified, and
 * the one action a person has — lock the terminal.
 */
import { useEffect, useState } from "react";

import { useAppState } from "@face/app/useAppState";
import { ConnectionIndicator } from "@face/components/common/ConnectionIndicator";
import { ThemeToggleButton } from "@face/components/common/ThemeToggleButton";
import type { T1View } from "@face/types";

import { SvIcon } from "./SvIcon";

/** The verified terminal facts the shell hands the face. Identifiers only. */
export interface TerminalFacts {
  readonly profileLabel: string;
  readonly profileCode: string;
  readonly hubDeviceId: string | null;
  readonly hubHost: string | null;
  readonly configurationVersion: number | null;
  readonly configurationFreshness: "current" | "cached_offline" | null;
  readonly hubReachable: boolean;
  readonly applicationVersion: string;
}

const NAV: { id: T1View; label: string; icon: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "new_order", label: "Booking", icon: "book" },
  { id: "orders", label: "Order Queue", icon: "clipboard" },
  { id: "handoff", label: "Handoff", icon: "check" },
  { id: "shift_close", label: "Close Shift", icon: "lock" },
  { id: "settings", label: "Settings", icon: "settings" },
];

export const LaundryTopBar = ({ terminal }: { readonly terminal: TerminalFacts }) => {
  const {
    ports,
    view,
    setView,
    wizStep,
    cart,
    selCustomer,
    custPhone,
    custName,
    bookingDraft,
    showToast,
  } = useAppState();
  const [now, setNow] = useState(() => new Date());
  const [menuOpen, setMenuOpen] = useState(false);
  const [locking, setLocking] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".sv-user-wrap")) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const nowStr = {
    time: now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
    date: now.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" }),
  };

  const hasDraft =
    bookingDraft === null &&
    (wizStep > 0 ||
      cart.length > 0 ||
      selCustomer !== null ||
      custPhone.trim().length > 0 ||
      custName.trim().length > 0);

  const lockTerminal = () => {
    setMenuOpen(false);
    setLocking(true);
    void ports
      .lockTerminal()
      .catch(() => {
        showToast("The terminal could not be locked — try again");
      })
      .finally(() => setLocking(false));
  };

  return (
    <div className="sv-topbar">
      <div className="sv-logo-wrap">
        <div className="sv-logo">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          >
            <circle cx="5" cy="12" r="2.4" fill="currentColor" />
            <line x1="7.4" y1="12" x2="12" y2="12" />
            <circle cx="12" cy="12" r="2.4" fill="none" stroke="currentColor" />
            <line x1="14.4" y1="12" x2="19" y2="12" />
            <circle cx="19" cy="12" r="2.4" fill="currentColor" />
          </svg>
        </div>
        <div className="sv-logo-text">
          <div className="n" style={{ fontSize: "22px" }}>
            KitLuy
          </div>
          <div className="km">ឃីត់លុយ · Laundry</div>
        </div>
      </div>

      <div className="sv-nav">
        {NAV.map((it) => {
          const active = view === it.id;
          const showDraft = it.id === "new_order" && hasDraft;
          return (
            <button
              key={it.id}
              type="button"
              className={"sv-nav-item" + (active ? " active" : "")}
              aria-current={active ? "page" : undefined}
              title={showDraft ? `Draft in progress — step ${String(wizStep + 1)} of 4` : undefined}
              onClick={() => setView(it.id)}
              data-nav={it.id}
            >
              <SvIcon name={it.icon} size={20} />
              {it.label}
              {showDraft && <span aria-hidden className="draft-dot" />}
            </button>
          );
        })}
      </div>

      <div className="sv-top-right">
        <div className="sv-util">
          <div className="sv-clock-pill">
            <div className="sv-clock-time">{nowStr.time}</div>
            <div className="sv-clock-date">{nowStr.date}</div>
          </div>
          <ConnectionIndicator online={terminal.hubReachable} />
          <span className="sv-util-div" />
          <div className="sv-fx" title="Configuration the Store Hub delivered">
            <span className="sv-fx-flag">
              <SvIcon name="settings" size={16} />
            </span>
            <div className="sv-fx-text">
              <div className="sv-fx-rate">
                {terminal.configurationVersion === null
                  ? "—"
                  : `v${String(terminal.configurationVersion)}`}
              </div>
              <div className="sv-fx-label">
                {terminal.configurationFreshness === "cached_offline" ? "cached" : "config"}
              </div>
            </div>
          </div>
          <span className="sv-util-div" />
          <ThemeToggleButton />
        </div>

        <div className="sv-user-wrap">
          <div
            className="sv-user"
            onClick={() => setMenuOpen((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setMenuOpen((v) => !v);
              }
            }}
            role="button"
            tabIndex={0}
            aria-expanded={menuOpen}
            style={{ cursor: "pointer" }}
          >
            <div className="sv-user-avatar">T1</div>
            <div className="sv-user-text">
              <div className="sv-user-name">Cashier / Intake</div>
              <div className="sv-user-role">PIN session</div>
            </div>
            <button type="button" className="sv-user-more" tabIndex={-1} aria-label="Terminal menu">
              <SvIcon name="more" size={20} />
            </button>
          </div>
          {menuOpen && (
            <div className="sv-user-menu" data-terminal-menu>
              <div className="sv-user-menu-head">
                <div className="sv-user-avatar" style={{ width: 52, height: 52, fontSize: 22 }}>
                  T1
                </div>
                <div>
                  <div className="sv-um-name">{terminal.profileLabel}</div>
                  <div className="sv-um-role">{terminal.profileCode}</div>
                  <div className="sv-um-shift">
                    Hub {terminal.hubDeviceId === null ? "—" : terminal.hubDeviceId.slice(0, 8)}
                    {terminal.hubHost === null ? "" : ` · ${terminal.hubHost}`}
                  </div>
                </div>
              </div>
              <div className="sv-user-menu-list">
                <button
                  type="button"
                  className="sv-um-item"
                  onClick={lockTerminal}
                  disabled={locking}
                >
                  <span className="sv-um-ic">
                    <SvIcon name="user" size={18} />
                  </span>
                  <span className="sv-um-body">
                    <span className="t">{locking ? "Locking…" : "Lock terminal"}</span>
                    <span className="s">PIN to unlock · the device credential stays</span>
                  </span>
                </button>
                <div className="sv-um-div" />
                <div className="sv-um-item" style={{ cursor: "default" }}>
                  <span className="sv-um-ic">
                    <SvIcon name="settings" size={18} />
                  </span>
                  <span className="sv-um-body">
                    <span className="t">
                      Configuration{" "}
                      {terminal.configurationVersion === null
                        ? "—"
                        : `v${String(terminal.configurationVersion)}`}
                    </span>
                    <span className="s">
                      {terminal.configurationFreshness === "cached_offline"
                        ? "cached — the Store Hub was not reachable at the last check"
                        : "current · delivered by the Store Hub"}
                    </span>
                  </span>
                </div>
              </div>
              <div className="sv-user-menu-foot">
                KitLuy Terminal · v{terminal.applicationVersion} ·{" "}
                {terminal.hubReachable ? "Store Hub linked" : "Hub offline"}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
