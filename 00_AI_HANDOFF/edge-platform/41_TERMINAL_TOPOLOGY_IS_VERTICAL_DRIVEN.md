# Terminal topology is vertical-driven — reconciliation audit (TERMINAL-TOPOLOGY-001)

**Date:** 2026-09-15
**Task:** `TERMINAL-TOPOLOGY-001` — Dynamic Vertical Terminal Architecture Reconciliation
**Status:** **AUDIT COMPLETE. Every recommendation here is PROPOSED.** No source,
schema or test changed. One Laundry defect was **reproduced on the Store Hub
code path** against the local Hub database (not on hardware), and it affects
the Phase 0 hardware baseline — §4 D1.
**Starting commit:** `82b62e3` (`dev` = `provisioning/dev`, clean tree)

Authority: owner architecture clarification 2026-09-15, recorded as
`KLD-2026-09-15-TERMINAL-TOPOLOGY-001` in the decision register. Conflicts are
recorded as `KLREC-2026-09-15-MULTI-PROFILE-SEAT-PAIRING-001` and
`KLREC-2026-09-15-TERMINAL-TOPOLOGY-CONFLICTS-001`.

---

## 0. The rule this audit measures against

```text
ONE generic KitLuy terminal platform (one Pi image)
  -> Business vertical            (per Digital Store)
  -> Vertical-specific logical terminal profiles   (namespaced: laundry.t3.ready_scan_in)
  -> Terminal seats / instances   (Front Counter 01)
  -> Physical devices             (KL-…; replaceable, re-flashable)
  -> Desired runtime configuration
```

T1–T4 is the **Laundry** vertical contract, not a KitLuy-wide one. A bare `T3`
is never globally meaningful. A logical profile is not a Pi. Multiplicity is
not fixed. The owner's clarification is consistent with every current binding
decision (KLV4-DEC-005, KLD-2026-07-26-002 Group 2): no authoritative document
states a global terminal model (§2), so nothing is reinterpreted.

## 1. Current state (A)

**The cloud is already mostly vertical-neutral. The Store Hub and the terminal
runtime are Laundry-and-T1 shaped.** Layer by layer:

| Layer            | What it does today                                                                                                                                                                                                                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud Supabase   | Vertical per Digital Store (`primary_vertical_code`, registry value). Seat (`physical_terminals`) ≠ role set (`physical_terminal_roles`, 1–8 keys) ≠ device (`devices`) ≠ assignment. Profile keys are checked **structurally** (`<vertical>.t<n>.<role>`) and by **vertical prefix** only. No vocabulary list, no combination rule, no instance cap. |
| Management API   | Shape + 1–8 distinct keys in TypeScript; vertical prefix enforced by the DB door. Accepts any role name under the right prefix.                                                                                                                                                                                                                       |
| Partner Portal   | Offers roles only for `laundry`, from the vertical package; `unsupported` for any other vertical. Stricter than the backend. Role ORDER = checkbox click order. No roles-edit screen.                                                                                                                                                                 |
| Admin Portal     | Device class, hardware profile and a role COUNT. No seat, no role keys, no vertical assumption.                                                                                                                                                                                                                                                       |
| Chain Portal     | Lists active verticals only. No terminal code.                                                                                                                                                                                                                                                                                                        |
| Store Hub        | No vertical concept (compiled-in Laundry; "single-vertical appliance"). Pairing session CHECK hard-codes `laundry.t[1-4]`. Pairing binds ONE profile. Runtime eligibility serves **T1 only**.                                                                                                                                                         |
| Terminal runtime | Receives the role set, pairs into `profileCodes[0]`, stores ONE profile locally; POS app is T1-only; its vertical registry exists but is not wired.                                                                                                                                                                                                   |
| Pi image         | Generic. Bakes device class `terminal` only — no vertical, no profile, no Laundry app.                                                                                                                                                                                                                                                                |
| Release system   | Keyed by product, architecture, hardware profile, environment. No vertical or terminal-profile dimension. Only `device-shell` is deliverable.                                                                                                                                                                                                         |
| Desired state    | None beyond `device_installations.desired_version` and unused `configuration_targets`.                                                                                                                                                                                                                                                                |

## 2. Source evidence (B)

### 2a. Cloud

- Vertical per store: `kitluy_core.digital_stores.primary_vertical_code`, only a
  non-empty CHECK (`supabase/migrations/…0020_digital_store_and_location.sql:33,42-44`).
  Allowed values are registry rows: `LAUNDRY` ACTIVE; `CAFE_RESTAURANT`,
  `ECOMMERCE`, `CONVENIENCE`, `PHARMACY`, `DEPARTMENT_STORE`, `GROCERY`,
  `SUPERMARKET` ROADMAP (`supabase/seed/dev-fixtures.sql:55-65`). Store creation
  refuses unknown and non-ACTIVE verticals: `KLUY-STORE-VERTICAL-UNKNOWN`,
  `KLUY-STORE-VERTICAL-NOT-ACTIVE` (`…0215_digital_store_creation.sql:136-151`).
- Seat: "A named seat in a Store (Front Counter 01) with an ordered set of
  terminal profile keys … It exists before any board does and binds to exactly
  one device" (`…0213_terminal_pairing_sessions.sql:28-31`). Roles are a separate
  soft-removed table with the structural shape CHECK and the comment "Neutral
  Fleet carries no vertical vocabulary" (`0213:97-119`).
- Role validation, the whole of it: count 1–8, no duplicates, shape, and
  `split_part(v_key, '.', 1) <> lower(p_vertical_code)` → `KLUY-PHYSTERM-ROLE-VERTICAL`
  (`0213:386-416`).
- Multiplicity: the only per-store unique index is the seat LABEL
  (`0213:83-84`); one seat per device (`0213:85-86`); one live row per
  (device, profile) (`…0121_…sql:343-345`). No per-store profile cap anywhere.
- Device carries many profiles: `device_terminal_assignments` one row per key
  (`0121:321-345`); pairing consumes one assignment per key (`0213:1067-1072`).
- Seat roles are ordered: `array_agg(r.terminal_profile_key order by r.ordinal, r.added_at)`
  (`0213:376`). `set_physical_terminal_roles_v1` **keeps the ordinal of a key that
  stays live** and appends new keys after the maximum, and refuses while a device
  holds the seat's assignment (`KLUY-PHYSTERM-BOUND`).
- The only Laundry list in cloud SQL is correct and vertical-scoped: the custody
  table `kitluy_laundry.garment_scan_events.terminal_role` CHECK
  (`…0100_terminal_profile_identifiers.sql`).
- Releases: `release_artifacts(product_key, version, build_id, architecture, hardware_profile, environment, channel …)`
  (`…0180_release_authority.sql:99-108`); the pairing context returns
  `'required_app_family', null, 'release_channel', null` (`0213:980-981`).
- Stale comment: 0121 says its regex "enforces the owner-locked T1-T4 shape"
  (`0121:321-330`), but `t[1-9][0-9]*` accepts any terminal number.

### 2b. API and portals

- `PROFILE_KEY_PATTERN = /^[a-z0-9_]+\.t[1-9][0-9]*\.[a-z0-9_]+$/` and
  `readProfileKeys` (1–8 distinct) are the only TypeScript checks
  (`services/kitluy-management-api/src/http.ts:513,556-580`). OpenAPI: array,
  1–8 strings, no pattern or enum.
- Partner Portal: `roleVocabulary` returns roles only for `laundry`, `unsupported`
  otherwise; `validateTerminalRoles` requires `isLaundryTerminalProfile`
  (`apps/kitluy-partner-pwa-portal/src/terminal-roles.ts:45-79`). Keys are kept
  in **click order** (`views.tsx` `toggle`: `[...current, key]`). The hint says
  "One terminal can run more than one, such as T1 and T2 together"
  (`messages.ts:191`).
- `packages/feature-flags/src/index.ts:20-29`: `laundry: "ACTIVE"`, every other
  vertical `REGISTERED_INACTIVE`; `client.restaurant_kds` is a Phase 2 flag, off.

### 2c. Neutral Core contract

- `packages/edge-contracts/src/terminal-profiles.ts:37-44`:
  `LOGICAL_TERMINAL_PROFILES` = the four Laundry keys, `TerminalProfileId` their
  union, commented "The owner-locked T1–T4 model".
- `packages/edge-contracts/src/types.ts:68-72`: every route's
  `allowedTerminalProfiles: readonly TerminalProfileId[]` — including the
  vertical-neutral `/edge/v1/*` routes, e.g. display sessions
  `allowedTerminalProfiles: [TERMINAL_PROFILE_T1_INTAKE_CASHIER]`
  (`generic-routes.ts:188`). The neutral contract cannot express a non-Laundry
  profile.
- `packages/device-identity/src` is structural only; Laundry keys appear in its
  tests as fixture data.

### 2d. Store Hub

- `services/kitluy-hub-agent/src/index.ts:40-48` re-exports
  `LAUNDRY_TERMINAL_PROFILES as TERMINAL_PROFILES`. `hub/migrations/0005_laundry.sql:65`:
  "the Hub is a single-vertical appliance". No vertical column or projection.
- `hub/migrations/0031_terminal_pairing.sql:97-98`:
  `pairing_session_profile_ck check (terminal_profile_code ~ '^laundry\.t[1-4]\.[a-z_]+$')`.
  `begin_terminal_pairing_v1` inserts before its prerequisite check
  (`0042:233` then `0042:272`), so a foreign-vertical key fails the CHECK and the
  Hub returns `INTERNAL_ERROR` (`src/hub/pairing.ts` `mapSentinel` fallback), not
  a governed refusal.
- Grants: `edge_config.terminal_profile_assignment` one row per (terminal,
  profile), multi-profile allowed (`0003:93-107`, `0012:332-334`).
- **Eligibility is T1-only and picks one grant:** `T1_PROFILE_CODE`
  (`src/hub/edge/runtime-bootstrap.ts:52`); the grant query ends
  `order by tpa.assignment_version desc limit 1` with no tie-breaker, then
  `PROFILE_NOT_T1`, then "the pairing receipt binds another profile"
  (`runtime-bootstrap.ts:355-378`). The development publisher writes every grant
  of a snapshot with the SAME `assignment_version` (`src/hub/dev-configuration.ts:213-233`).
- Command authorization is Laundry-typed (`authorization.ts:184`
  `isLaundryTerminalProfile`, `:364` per-command `allowedProfiles`).
- Discovery grants nothing; pairing needs a recognised, activated terminal and a
  grant; operating also needs eligibility, a staff session and permissions.
- Release cache/installation: product, architecture, hardware profile, device
  kind — no profile or vertical (hub `0038`, `0039`).

### 2e. Terminal runtime and image

- Image: `rpi-image-gen/layer/kitluy-pi-terminal.yaml:12-22` "THE TERMINAL PROFILE
  IS NOT BAKED IN … NOR IS THE VERTICAL"; `image.env` carries
  `KITLUY_DEVICE_CLASS=terminal` (confirmed inside the built image, handoff 40 §8).
- Terminal pairs into the first key: `bin/terminal-edge.ts:43-52` reads the
  assignment's keys in order; `edge-session.ts:331` `options.profileCodes?.[0]`
  ("The Hub pairs a terminal INTO one profile", `:105-106`).
- One profile stored: `packages/terminal-local-store/src/configuration-snapshot-store.ts:49,87-90`
  (`terminalProfileCode`, `singleton = 1`).
- POS app: `apps/kitluy-pos-desktop-app/src/bootstrap/machine.ts:526-533` refuses
  anything but T1 (`PROFILE_NOT_T1`). `src/vertical/registry.ts` selects a module
  by vertical then profile, but nothing outside `src/vertical/` imports it; the
  Café module is `REGISTERED_INACTIVE_PHASE2` with `terminals: []`
  (`modules.ts:88-95`).

### 2f. Documents

| Source                                                                                                                | Status (as the repo labels it)                                                              | What it says                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RB v4 `KLV4-DEC-005` (`docs/source/canonical/kitluy-suite-rebuild-bible-v4.0.0.md:993`)                               | OWNER-LOCKED                                                                                | "Laundry T1–T4 architecture: T1 Cashier/Intake; T2 CDS; T3 Ready Scan-In; T4 Pickup Scan-Out."                                                                                                                                   |
| RB v4 §5.5 (`:469`)                                                                                                   | canonical                                                                                   | "T3 and T4 may share one physical device in a small Store, but they remain separate modes, permissions, sessions, state machines and audit events."                                                                              |
| KLD-2026-07-26-002 Group 2 (`docs/decisions/kitluy-contract-vocabulary-and-edge-api-owner-decision-v1.0.0.md:92-122`) | OWNER-APPROVED                                                                              | The four `laundry.t*` keys; a logical profile is not a device assignment or a hardware profile; `t2_scan_in`/`t3_scan_out` never reused.                                                                                         |
| Terminal Profile Contract (`docs/source/offline/kitluy-terminal-profile-contract-t1-t4-v1.0.0.md:13-28`)              | Canonical target contract                                                                   | Device profiles: `laundry_front_counter` = T1 + paired T2; `laundry_ready_pickup` = T3 + T4; four dedicated codes. "Installer cannot self-select profiles."                                                                      |
| Store Hub spec (`docs/source/imported/kitluy-storehub-phase1-spec-v1.0.0.md:392-394`)                                 | OWNER-APPROVED target                                                                       | "High-volume · Multiple certified terminals · Multiple T1/T2, T3 and T4 instances".                                                                                                                                              |
| POS Desktop spec (`…pos-desktop-app-phase1-spec-v4.0.0.md:248`)                                                       | SOT-104, active Phase 1 target                                                              | "A larger store may deploy T1, T2, T3 and T4 on separate devices. The logical model must not depend on physical colocation."                                                                                                     |
| Terminal transport & pairing owner decision v2.0.0 (`docs/decisions/…-v2.0.0.md:186,222,533`)                         | owner decision                                                                              | One Pi running "T1 + T2"; a second Pi for another role set.                                                                                                                                                                      |
| Owner workflow (`docs/source/owner-decisions/…pi-terminal-workflow-v1.0.0.md:667,746,756`)                            | owner decision                                                                              | "The profile must be compatible with `primary_vertical`"; `cafe.cashier` shown only as an INVALID profile for a Laundry store.                                                                                                   |
| RB md v1.0.0 (`docs/source/imported/kitluy-suite-rebuild-bible-md-v1.0.0.md:131-136,185`)                             | **SUPERSEDED** by RB v4 (`docs/authority/kitluy-superseded-document-register-v1.0.0.md:90`) | Café T1 Cashier, T2 CDS (T1's HDMI-2, no separate Pi), T3 KDS "Multi-instance, one per station", T4 DDS Dispatch/expediter, T5 QDS; "Café · Active build · 5 (T1–T5) · `cafe.*`". The same file says Laundry has "3 (T1,T2,T4)". |

## 3. Terminal topology matrix (C)

| Vertical                                                                           | Profiles                                                                                                             | Multiplicity                                                                                        | Profile sharing                                                                                                                              | Current support                                                                                                                                        | Authority                                                                                                                |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **Laundry** (`LAUNDRY`, ACTIVE)                                                    | `laundry.t1.intake_cashier`, `laundry.t2.customer_display`, `laundry.t3.ready_scan_in`, `laundry.t4.pickup_scan_out` | Docs: several instances allowed (Store Hub spec :394; POS spec :248). Code: no cap in cloud or Hub. | Docs: T1+T2 (front counter), T3+T4 (ready/pickup), or one dedicated profile per device. Code: any 1–8 keys on one seat; no combination rule. | **PARTIAL.** Cloud seats/roles and Partner Portal: IMPLEMENTED. Hub pairing/eligibility and POS runtime: T1 only. Multi-profile seats: defective (D1). | KLV4-DEC-005; KLD-2026-07-26-002 G2; Terminal Profile Contract §1–2; `verticals/phase1-laundry/src/terminal-profiles.ts` |
| **Café / Restaurant** (`CAFE_RESTAURANT`, ROADMAP / REGISTERED_INACTIVE)           | **No approved identifiers.** Superseded only: T1 Cashier, T2 CDS, T3 KDS, T4 Dispatch/expediter, T5 QDS.             | Superseded only: T3 multi-instance, one per station.                                                | Superseded only: T2 on T1's second HDMI, no separate Pi.                                                                                     | **NOT IMPLEMENTED.** Store creation refuses the vertical; POS module has no terminals; KDS flag off.                                                   | None current. RB v4 lists a separate Phase 2 `kitluy-restaurant-kds-client` ("not Laundry T2").                          |
| Ecommerce, Convenience, Pharmacy, Department store, Grocery, Supermarket (ROADMAP) | undefined                                                                                                            | —                                                                                                   | —                                                                                                                                            | unsupported                                                                                                                                            | RB v4 §2.1 lists capabilities only                                                                                       |

## 4. Architecture conflicts and defects (D)

### D1 — DEFECT, reproduced: a multi-profile seat cannot operate unless T1 is its first role

**Chain.** The cloud keeps a seat's roles in click order → the terminal pairs
into `profileCodes[0]` → the Hub pairing receipt binds that one profile → runtime
eligibility requires the grant to be T1 AND equal to the receipt → otherwise
`403 PROFILE_NOT_T1`.

**Reproduced** with a temporary case in
`services/kitluy-hub-agent/test/t1-bootstrap-routes.integration.test.ts` over
the real mTLS routes, the real four-step pairing and the local Hub database
(`kitluy-hub-local`); the case was removed and the file restored byte-identical
to HEAD:

| Seat role order (as the cloud delivers it) | Terminal pairs into | `GET` runtime eligibility |
| ------------------------------------------ | ------------------- | ------------------------- |
| T2, T1, T3, T4                             | T2                  | **403 `PROFILE_NOT_T1`**  |
| T1, T2, T3, T4 (four grants, same version) | T1                  | 200 on 5 of 5 calls       |

The second row passed, but only because Postgres happened to return the T1 row
among equal `assignment_version` values; nothing in the query guarantees it.

**Real data, `kitluy-fresh`, read-only:**

| Seat                    | Device                                         | Live roles, in order |
| ----------------------- | ---------------------------------------------- | -------------------- |
| `T1` (2026-09-12)       | `KL-C2B02C760E41`                              | T1, T2, T3, T4       |
| `Pi HEllo` (2026-09-14) | `KL-1CB3577C26A7` (the U1 acceptance terminal) | **T2**, T1, T3, T4   |

**Phase 0 impact:** once re-flashed and re-paired, `KL-1CB3577C26A7` will be
refused runtime eligibility as it stands. It will not reach `SERVING`, even
though the image and the Hub are correct. Not observed on hardware — derived
from the reproduction and the live seat row.

**No-code workaround, owner-confirmed, NOT performed:** during the re-flash, after
its assignment is revoked (the seat's roles are frozen until then,
`KLUY-PHYSTERM-BOUND`), change the seat's roles so T1 is first. Re-submitting
the same four keys does not reorder them (kept keys keep their ordinal). Set
`[laundry.t1.intake_cashier]` first, then re-add the others if they are wanted,
through `POST /management/v1/partner/terminals/{id}/roles` — the Partner Portal
has no roles-edit screen. Worked out by reading the code; not executed.

Why this was **not** repaired in the audit: the right fix decides what pairing
means for a seat with several roles, which is an owner decision
(`KLREC-2026-09-15-MULTI-PROFILE-SEAT-PAIRING-001`). Any Hub or terminal change
would also make the images built in handoff 40 stale in the middle of Phase 0.

### D2 — Device-profile combinations are specified but enforced nowhere

The Terminal Profile Contract §2 allows T1+T2, T3+T4, or a single dedicated
profile on one device. The cloud, the API and the portal accept any 1–8
combination. Both real seats carry all four profiles, a combination no device
profile permits. The device-profile codes themselves are not modelled in the
cloud schema, and their names drift between documents: `laundry_t1_dedicated`
(Terminal Profile Contract) versus `laundry_t1` (pairing protocol, config
snapshot contract). The Store Hub spec §7.6 lists only four of them.
**OWNER DECISION REQUIRED** — enforcing the contract as written would make both
current development seats invalid.

### D3 — Neutral Core types terminal profiles as Laundry's four

`packages/edge-contracts` (`TerminalProfileId`, `LOGICAL_TERMINAL_PROFILES`,
`allowedTerminalProfiles`) makes the Laundry vocabulary the type of every edge
route, generic ones included. Its own coupling note justifies the duplication by
CLAUDE.md hard rule 2, but the result is the global assumption the owner rule
forbids.

### D4 — The backend has no vocabulary authority; the portal does

API and DB accept `laundry.t9.anything` for a Laundry store. The Partner Portal
refuses it and caps at the four checkboxes, while the API allows 8. The browser
is today the only place the Laundry vocabulary is enforced, which is UI hiding
acting as validation. There is also a small grammar drift: the API and DB accept
a leading digit or underscore in each segment, while `TERMINAL_PROFILE_PATTERN`
requires a letter first.

### D5 — The Store Hub is Laundry-only by construction

The Laundry vocabulary is compiled in, a CHECK in hub migration 0031 lists
`laundry.t[1-4]`, and there is no vertical in the Hub's assignment or snapshot.
A foreign-vertical key surfaces as `INTERNAL_ERROR`, not a governed refusal. The
"single-vertical appliance" position (hub 0005) is a design statement to
confirm, not a defect.

### D6 — Pairing and local state are single-profile; the cloud seat is a role set

The cloud supports 1–8 roles per seat. The Hub pairing receipt, the terminal
local store (`singleton`, `PAIR_ASSIGNMENT_MISMATCH` on change) and the Hub
eligibility response each carry exactly one profile. D1 is the visible symptom.

### D7 — The runtime is T1-only; the vertical host is unwired

The POS bootstrap refuses non-T1, and the Hub eligibility refuses non-T1. T2, T3
and T4 have no runtime experience even for Laundry. That is expected at this
stage, but the refusal names T1 instead of "no experience for this profile", and
`VerticalRegistry` is dead code today.

### D8 — Releases and configuration are not profile-aware

There is no vertical or profile dimension on artifacts, assignments or the
device-side check (`RELEASE_WRONG_PRODUCT/ARCHITECTURE/HARDWARE_PROFILE`), and
only `device-shell` is updatable. "Café T3 KDS" and "Laundry T3 scan-in" could
be told apart only by per-device manual assignment. Acceptable until more than
one application exists; must be designed with desired state, not before.

### D9 — Café is undefined, and its old identifiers conflict with the registry

The only T1–T5 Café model is in superseded documents, which also disagree with
each other (T4 "Dispatch" vs "Digital Display System / Expediter"). They used a
`cafe.*` prefix, while the registry code is `CAFE_RESTAURANT`, whose 0213 prefix
rule yields `cafe_restaurant.`. **CONFLICT / OWNER DECISION REQUIRED** before any
Café profile exists. No identifiers were invented.

### D10 — Three different things are called "profile"

1. Logical terminal profile — `laundry.t1.intake_cashier`.
2. Laundry physical device profile — `laundry_front_counter`, documents only.
3. Hardware profile — cloud `hardware_profiles.profile_key` `KL-PI5-TERMINAL-DEV`,
   Hub `hardware_profile` `hw.compute.terminal`, and `release_artifacts.hardware_profile`.

The code keeps them apart correctly. The shared word is a standing risk for
every future contract and prompt.

### D11 — Stale statements

- 0121's comment claims T1–T4 enforcement it does not perform.
- `PROJECT_HOME.md` still lists terminal-profile identifiers as pending owner
  confirmation, although they were resolved on 2026-07-27.
- Comments say "T1–T4 terminals" in the Hub agent (`index.ts`, `lan-api.ts`,
  `release-agent.ts`) and in `terminal-local-store`.
- The generic image layer (`infra/kitluy-os-image/rpi-image-gen/layer/kitluy-pi-terminal.yaml:14`)
  says "One image serves T1, T2, T3 and T4", which is Laundry framing. The same
  comment then says "No Laundry concept may appear in this layer". The behaviour
  is correct: nothing is baked.

None changes behaviour; each invites the wrong mental model.

## 5. Recommended canonical model (E) — PROPOSED

The smallest change that makes the system properly vertical-driven. It reuses
what exists and adds no new layer where one already fits.

1. **Each vertical package owns its topology as data.** `verticals/phase1-laundry`
   already owns the profile keys and capabilities. Add, from existing authority
   only:
   - the allowed device-profile combinations (Terminal Profile Contract §2);
   - per-profile multiplicity ("unbounded" unless a decision says otherwise);
   - the runtime experience each profile needs.

   A neutral descriptor type lives in `packages/`. It holds no vertical strings.

2. **The cloud holds the governed copy.** A server-side vocabulary per vertical
   gives the Fleet doors membership and combination checks in addition to the
   current shape and prefix checks. It can reuse the `kitluy_core.reference_values`
   registry or a small table; that choice belongs to the slice. The Management API
   serves the vocabulary for a Store. Portals render it and stop being the
   authority.
3. **Neutral Core stops naming Laundry.** `edge-contracts` types a profile as the
   structural key. Each vertical route catalogue supplies its own allowed-profile
   lists.
4. **A seat pairs as a seat.** The Hub receives the vertical and the seat's full
   grant set in the signed snapshot. The pairing receipt and eligibility carry the
   role set, and each command is authorised against that set. This depends on the
   D1 decision.
5. **The terminal runtime selects an experience by (vertical, profile)** through
   the existing `VerticalRegistry`, and refuses a profile with no experience in
   those terms.
6. **Releases gain a compatibility dimension only with desired state**, keyed by
   application family, with vertical and profile as inputs.
7. **The image stays generic.** Nothing in this model touches the Pi image.

Properties A–F:

| Property                       | Today                                                              | After the model                                        |
| ------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------ |
| A. Vertical-driven             | cloud prefix check only                                            | vocabulary owned by the vertical, enforced server-side |
| B. Generic image               | met                                                                | unchanged                                              |
| C. profile ≠ seat ≠ device     | met in the cloud; collapsed to one profile at the Hub and terminal | role set end to end                                    |
| D. Multiplicity                | not capped (met)                                                   | stated per vertical                                    |
| E. Namespaced identity         | met in keys; generic contract typed to Laundry                     | structural type everywhere                             |
| F. Laundry backward compatible | —                                                                  | every slice additive; existing keys stay valid         |

## 6. Implementation plan (F) — bounded slices, PROPOSED

| Slice                                                | Scope                                                                                                                                                                                                                                                                                             | Needs                                    | Touches hardware?                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------- |
| **TOPOLOGY-001** Multi-profile seat pairing          | Owner decision on seat pairing semantics. Then: Hub eligibility selects deterministically (grant matching the receipt, tie-breaker); a Hub integration test for a T2-first seat; Partner Portal submits roles in vocabulary order, not click order. Full fix per the decision (role-set receipt). | `KLREC-…-MULTI-PROFILE-SEAT-PAIRING-001` | yes: Hub and terminal re-package and image rebuild |
| **TOPOLOGY-002** Laundry topology contract           | Neutral descriptor type in `packages/`; Laundry descriptor in `verticals/phase1-laundry` (combinations, multiplicity); tests lock values. Reconcile device-profile code names.                                                                                                                    | D2 decision on names                     | no                                                 |
| **TOPOLOGY-003** Server-side vocabulary              | Additive cloud migration: per-vertical profile vocabulary plus membership (and, if decided, combination) checks in `validate_physical_terminal_roles_v1`; Management API `GET` vocabulary for a Store; OpenAPI. Check existing seat data first.                                                   | TOPOLOGY-002; D2 decision                | no                                                 |
| **TOPOLOGY-004** Portals on the API vocabulary       | Partner Portal reads the vocabulary from the API and keeps its labels; backend refusal codes surfaced; a roles-edit path. Admin Portal shows seat, role keys and device separately.                                                                                                               | TOPOLOGY-003                             | no                                                 |
| **TOPOLOGY-005** Neutral edge contract               | `edge-contracts` structural profile type; Laundry route lists move to the Laundry catalogue; hub-agent and pos-desktop-app compile against it.                                                                                                                                                    | TOPOLOGY-002                             | no (until images next rebuild)                     |
| **TOPOLOGY-006** Hub vertical awareness              | Vertical and role vocabulary in the signed snapshot; a NEW hub migration replacing the 0031 Laundry CHECK with structural plus snapshot membership; governed refusal instead of `INTERNAL_ERROR`; authorization against the grant set.                                                            | TOPOLOGY-001, 005                        | yes                                                |
| **TOPOLOGY-007** Terminal runtime role set           | `terminal-local-store` keeps the role set; POS app wires `VerticalRegistry`; refusal names the missing experience. T1 stays the only Laundry experience built.                                                                                                                                    | TOPOLOGY-006                             | yes                                                |
| **TOPOLOGY-008** Profile-aware release compatibility | Application family and profile inputs to release assignment and device verification. With the desired-state work, not before.                                                                                                                                                                     | desired-state plan                       | yes                                                |
| **TOPOLOGY-009** Café                                | BLOCKED on owner decisions: activation, identifiers, prefix, T4 name, T2 placement.                                                                                                                                                                                                               | owner                                    | later                                              |
| **TOPOLOGY-010** Hardware verification               | Front-counter T1+T2 seat, ready/pickup T3+T4 seat, device replacement keeping the seat.                                                                                                                                                                                                           | 001, 006, 007                            | yes                                                |

**Recommended next bounded task:** the TOPOLOGY-001 owner decision. Until it is
taken, apply the D1 workaround to `Pi HEllo` during Phase 0.

## 7. Regression risks (G)

- **Laundry hardware flow.**
  - Any change to Hub eligibility, pairing receipts (append-only), the terminal
    local store (singleton rows) or the POS bootstrap needs re-packaging, an image
    rebuild and a hardware re-run. Sequence it after Phase 0, or as the deliberate
    Phase 0 fix.
  - Changing the portal's role order changes which profile a NEW seat pairs into.
    Existing seats keep their ordinals.
- **Existing data.** A membership or combination check added to
  `validate_physical_terminal_roles_v1` runs only on define and set, but would
  refuse editing today's all-four seats if combinations are enforced. Audit seat
  data (development and hosted) before enabling it.
- **Hub migrations are checksum-pinned and forward-only.** Replace the 0031 CHECK
  in a new migration; never edit 0031.
- **Contract ripple.** Changing `TerminalProfileId` breaks compilation in
  hub-agent and pos-desktop-app until both move; ship them in one slice.
- **Laundry custody CHECK (0100) is correct as it is** — a vertical schema naming
  its own vocabulary. Do not "generalise" it.
- **Release and recovery.** Release verification (`RELEASE_WRONG_*`), release
  sequence semantics, 0223 newest-assignment semantics and 0224 recovery
  (device-class agnostic) are untouched by slices 001–007 and must stay so.

## 8. Cross-surface impact matrix

| Layer          | Assessment                                                                                                                             | Impact                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Cloud Supabase | Seat, role, device and assignment are separate; shape and prefix checks only; no vocabulary, combinations or caps; ordered roles       | **Affected** — server-side vocabulary (003); nothing destructive                                            |
| Management API | Structural validation only; no vocabulary endpoint                                                                                     | **Affected** — vocabulary endpoint and refusal passthrough (003)                                            |
| Admin Portal   | No Laundry assumption; shows no seat or role keys                                                                                      | **Affected, low** — visibility only (004)                                                                   |
| Partner Portal | Laundry-only vocabulary from the vertical package; click-order roles; no roles edit                                                    | **Affected** — reads the API vocabulary, stable order, roles edit (001, 004)                                |
| Chain Portal   | Lists active verticals only                                                                                                            | **Not affected now.** Cross-store topology reporting would read the same vocabulary later.                  |
| Store Hub      | Laundry compiled in; 0031 CHECK; single-profile pairing; T1-only eligibility                                                           | **Affected** — D1 fix (001), vertical-aware snapshot and authorization (006)                                |
| Terminal       | Pairs into the first role; one stored profile; T1-only POS; unwired vertical host                                                      | **Affected** — role set and experience selection (007)                                                      |
| Image          | Generic — no vertical, no profile                                                                                                      | **Not affected.** Must stay generic; carries changed code only after re-packaging.                          |
| Sync           | Hub snapshot carries grants and no vertical; cloud-to-Hub delivery is not yet a network transport                                      | **Affected later** — the vertical and role set must travel in the signed snapshot (006)                     |
| Release system | Product, architecture, hardware profile; `device-shell` only                                                                           | **Affected later** — compatibility dimension with desired state (008)                                       |
| Security       | Seat and role changes gated by `fleet.terminal_pairing_code.issue`; the browser is the only vocabulary check; discovery grants nothing | **Affected** — move vocabulary authority server-side (003); D1 is availability, not an authorization bypass |
| Tests          | No test for a multi-profile seat at the Hub, a non-Laundry key at Hub pairing, or API membership                                       | **Affected** — regression tests per slice, starting with a T2-first seat                                    |
| Hardware       | Both development seats carry all four roles; the acceptance seat is T2-first                                                           | **Affected now** — D1 workaround for Phase 0; TOPOLOGY-010 later                                            |

## 9. Decisions still unresolved (owner)

1. **Seat pairing semantics.** Does a terminal with several roles pair into its
   whole role set, or into one profile? If one, which — chosen by a rule, or by
   what the installed runtime can serve?
2. **Combinations.** Must the cloud enforce Terminal Profile Contract §2? And are
   the two current all-four development seats to be redefined?
3. **Device-profile codes.** Canonical names (`laundry_t1_dedicated` or
   `laundry_t1`), and whether the cloud models them at all.
4. **Café.** Activation, profile identifiers, the vertical prefix (`cafe_restaurant.`
   per the registry, or `cafe.`), T4 naming, T2 placement.
5. **Instance caps.** Any per-store maximum for a profile? None exists today and
   none is documented.
6. **Hub scope.** Confirm the Store Hub stays a single-vertical appliance per
   Digital Store.

## 10. Verification

| Check                                                                                       | Result                                                                                                             |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Source and schema changes                                                                   | **none**                                                                                                           |
| Temporary Hub probe (`TOPOLOGY-PROBE`, 1 case over real mTLS routes and `kitluy-hub-local`) | ran; T2-first → 403 `PROFILE_NOT_T1`; T1-first → 200 ×5; removed, file byte-identical to HEAD (`git diff --quiet`) |
| `kitluy-fresh` seat and role data                                                           | read-only query, `default_transaction_read_only=on`                                                                |
| Five read-only searches (cloud, API and portals, Hub, runtime/image/release, docs)          | every cited file and line re-read directly before being written here                                               |
| `prettier --check` on the changed documents                                                 | pass                                                                                                               |
| `pnpm secret:scan`                                                                          | pass (2269 tracked files)                                                                                          |
| `pnpm docs:links`                                                                           | 4 broken links, all pre-existing in the 2026-07-30 WS-11 handoff; none added                                       |
| Unit, integration and `pnpm verify`                                                         | not re-run: no source, schema or test file changed (last full run: handoff 40 §5)                                  |

Files changed by this task: this handoff, `00_AI_HANDOFF/000_INDEX.md`, and
`docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md` (one
owner clarification and two reconciliation entries). No evidence register row
changed status: nothing was implemented.
