# Assignment and configuration model

**Date:** 2026-08-07
**Status:** already IMPLEMENTED-IN-DEV before this mission. **No change made.**

---

## 1. The locked chain

    Digital Store
      -> registered Store Hub hardware
        -> certificate-backed activation
          -> Location assignment
            -> terminal assignment
              -> signed configuration
                -> offline local authority

(`000_ACTIVE_PHASE.md` §10, KLD-2026-07-21-003, OWNER-LOCKED.) No step may be
skipped, reordered or inferred. This mission preserved it; the firstboot agent
composes it and adds no shortcut.

## 2. Hub assignment — existing implementation

`device_assignments` + `device_assignment_projections` bind a device to Tenant,
Digital Store and Location. `hub_replacement_operations` and
`hub_replacement_events` carry governed replacement without destroying history.
Migration group `0182` corrected assignment identity so an idempotency key
identifies artifact, scope, environment **and** device.

**A Hub does not become local Store authority on assignment alone.** It requires
activation, which requires certificate issuance — BLK-005-gated.

## 3. Terminal assignment — existing implementation

`device_terminal_assignments`, `device_terminal_activation_challenges`,
`device_terminal_provisioning_activations`, `terminal_pairing_receipts`, with
one-time `device_provisioning_codes` (expiring, lockout-protected, replay-
reconciled) and `device_provisioning_pop_challenges` for Ed25519 proof of
possession.

**A terminal cannot self-assign.** The cloud routes derive Tenant, Store,
Location, Hub, environment and profile server-side; the device may only name
what it is asking about. The firstboot agent mirrors this: it takes
`terminalProfileKey` from the server and has no code path that chooses one
(pinned by test).

## 4. Configuration publication — existing implementation

`kitluy_config`: `configuration_versions`, `configuration_publications`,
`configuration_targets`, `configuration_acknowledgements` — versioned, scoped,
auditable, retry-safe, rollback-capable, with issued and acknowledged
timestamps.

The agent's contribution is the **acceptance rule** on the device side: newer
wins, equal is a no-op, older is refused, malformed is refused. An older
version accepted is a silent downgrade via replay.

## 5. Open item carried, not resolved — `KLREQ-VERTICAL-ENVELOPE-001`

The Hub configuration/assignment envelope carries **no explicit vertical field**;
the vertical is derived from the Hub-signed `terminalProfileCode` prefix. That
derivation is accepted only as a `TEMPORARY-COMPATIBILITY-DERIVATION`.

This is precisely the mission's §4 concern ("Do not make terminal profile prefix
the permanent source of Store vertical truth"). The fix — delivering
`Digital Store.primary_vertical` through the envelope — belongs to the task that
**owns** that signed contract, and changing a signed envelope from outside its
owning task would be a cross-contract change made without its authority.

**Recorded, not fixed.** Fail-closed behaviour is retained: explicit vertical
plus a disagreeing derived vertical → REFUSE.
