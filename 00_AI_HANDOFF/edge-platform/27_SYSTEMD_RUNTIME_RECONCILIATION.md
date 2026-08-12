# systemd runtime reconciliation — Pi Terminal

**Date:** 2026-08-10
**Status:** ANALYSIS COMPLETE — recommendation recorded, **not applied**.
No unit file was edited, renamed or deleted.

---

## 1. The divergence is real, and it is not a naming accident

The prior report flagged `kitluy-terminal-client.service` vs
`kitluy-terminal-session.service` as two names for one runtime. **That framing
is wrong.** Reading both definitions shows two genuinely different concepts
that each build path collapsed differently.

### Path A — `scripts/build-image.sh` (staged tree)

`scripts/profiles/pi-terminal.sh:27`

    [Unit]
    Description=KitLuy terminal kiosk client (Electron POS runtime)
    After=kitluy-enrollment-agent.service graphical.target
    Wants=graphical.target
    Requires=kitluy-enrollment-agent.service
    [Service]
    User=${KITLUY_KIOSK_USER}
    ExecStart=/usr/lib/kitluy/terminal-client
    ProtectSystem=strict
    ProtectHome=yes
    ReadWritePaths=/var/lib/kitluy/terminal
    [Install]
    WantedBy=graphical.target

This is **the Electron POS application**. It assumes a graphical session
already exists (`WantedBy=graphical.target`) and is well hardened.

### Path B — `rpi-image-gen/layer/kitluy-pi-terminal.yaml` (the real `.img`)

    [Unit]
    Description=KitLuy POS terminal kiosk session (Wayland/labwc)
    After=kitluy-enrollment-agent.service seatd.service
    Wants=seatd.service
    Requires=kitluy-enrollment-agent.service
    [Service]
    User=%i
    ExecStart=/usr/lib/kitluy/terminal-session
    NoNewPrivileges=yes
    [Install]
    WantedBy=multi-user.target

This is **the Wayland compositor session**. It orders after `seatd` and is
wanted by `multi-user.target` — it is what *creates* the graphical session.

## 2. Therefore

| Concept                        | Correct owner                              |
| ------------------------------ | ------------------------------------------ |
| Start the Wayland/labwc session | `kitluy-terminal-session.service` (Path B) |
| Run the Electron POS app in it  | `kitluy-terminal-client.service` (Path A)  |

**Both units are legitimate and both are needed.** Neither should be deleted.
The actual defects are different from the reported one:

1. **Path B has no POS client unit at all.** The image that produced
   `v2.7.0` starts a compositor and never starts an application.
2. **Path A has no compositor unit at all.** It targets `graphical.target`
   without anything establishing one.
3. **Each path invents a different `ExecStart` name for its single unit**, which
   is what made them look like duplicates.

Only Path B produces the flashable `.img`, so defect 1 is the one that ships.

## 3. Two further defects found while reconciling

**`User=%i` is invalid here.** `kitluy-terminal-session.service` is a *plain*
unit, not a template (`@.service`). `%i` expands to the empty string in a
non-template unit, so `User=` is empty and the specifier is meaningless.
Path A does this correctly with `User=${KITLUY_KIOSK_USER}`.

**Path B dropped Path A's hardening.** `ProtectSystem=strict`, `ProtectHome=yes`
and the explicit `ReadWritePaths=` are absent from the unit that actually ships.

## 4. Recommended canonical service map

Recorded as a recommendation. **Applying it requires the DEC-1 decision in
`28_…MISSION_BLOCKERS.md`**, because whether these units may reference baked-in
executables at all is exactly what DEC-1 settles.

| Unit                                | Responsibility                       | ExecStart                            |
| ----------------------------------- | ------------------------------------ | ------------------------------------ |
| `kitluy-firstboot.service`          | one-shot per-device identity         | `/usr/lib/kitluy/firstboot-identity` |
| `kitluy-enrollment-agent.service`   | cloud enrollment + assignment poll   | `/usr/lib/kitluy/enrollment-agent`   |
| `kitluy-health-reporter.service`    | heartbeat                            | `/usr/lib/kitluy/health-reporter`    |
| `kitluy-hub-discovery-client.service` | mDNS Hub discovery (post-assignment) | `/usr/lib/kitluy/hub-discovery-listen` |
| `kitluy-terminal-session.service`   | Wayland/labwc compositor session     | `/usr/lib/kitluy/terminal-session`   |
| `kitluy-terminal-client.service`    | Electron POS application             | `/usr/lib/kitluy/terminal-client`    |
| `kitluy-update-agent.service`       | A/B release install + rollback       | `/usr/lib/kitluy/update-agent`       |

This keeps **both** disputed names, because both concepts exist. It adds no new
name that the architecture does not already imply.

### 4.1 Ordering that must hold

    kitluy-firstboot.service
      └─> kitluy-enrollment-agent.service   (Requires — no identity, no enrolment)
            ├─> kitluy-health-reporter.service
            ├─> kitluy-hub-discovery-client.service
            └─> kitluy-terminal-session.service   (compositor)
                  └─> kitluy-terminal-client.service  (POS app, After=session)

`kitluy-terminal-client.service` must gain `After=kitluy-terminal-session.service`
rather than `After=graphical.target`, since the KitLuy session is what provides
the graphical environment.

## 5. Required regression tests (§37)

Neither build path currently tests that an `ExecStart` target exists. That is
precisely the defect that shipped in `v2.7.0`, and it is cheap to prevent:

- every enabled KitLuy unit's `ExecStart` binary exists in the built tree and is
  executable;
- unit names are identical across both build paths (Path A and Path B must not
  drift again);
- a non-template unit contains no `%i` specifier;
- the hardening directives present in Path A are present in Path B;
- the ordering graph in §4.1 holds.

`test/build-gates.test.sh` currently asserts unit **presence** only — which is
why it reported 34/34 green against an image whose every agent was missing.
