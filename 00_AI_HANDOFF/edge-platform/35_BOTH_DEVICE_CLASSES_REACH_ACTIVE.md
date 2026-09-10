# Both device classes reach ACTIVE, and the six gates that stood in the way

**Date:** 2026-09-09
**Status:** **PROVEN ON HARDWARE.** A Store Hub and a Pi Terminal both reached
`active` / `ACTIVE` with adopted certificates, on real boards.
**No cloud write was performed.**

---

## 1. What now works

```text
KL-AD3D11C9E189 | store_hub | active | ACTIVE | certificate active
KL-EDD139CCC2C8 | terminal  | active | ACTIVE | certificate active | 4 profiles
```

The whole provisioning spine, end to end, for both classes: register → approve →
pair → certificate → activate. Neither had ever happened before today.

---

## 2. The defect that dominated the day

**A device keeps its pairing on the SD card. Re-flashing destroys it. The cloud
does not know, and refuses to let the board recover.**

| Where | What is lost | What refuses |
| --- | --- | --- |
| Store Hub | `pairing-state.json` | `KLUY-DEVICE-ALREADY-CLAIMED` |
| Pi Terminal | `terminal/assignment.json` | `KLUY-TERMSESSION-TERMINAL-BOUND` |
| Store Hub | the storage key | volume unopenable (fixed, group 33) |
| Both | approval bound to the superseded enrolment | `not an approved, eligible terminal` |

In development this costs an evening. **In a shop it is the SD-card-failure
path**, and it strands the Store.

---

## 3. SIX gates, and the order they were found

This is the part worth remembering. Re-pairing a re-flashed terminal passes
through six checks. They were discovered and fixed one at a time, in roughly the
REVERSE of the order they execute, so each fix was correct and unreachable:

| # | Gate | Outcome |
| --- | --- | --- |
| 1 | Management API refuses a session for a bound seat | **STILL OPEN** — no revoke route |
| 2 | `evaluate_terminal_pairing_session_v1` demanded `enrolled` | 0220 |
| 3 | `evaluate_provisioning_eligibility_v1` — approval vs enrolment | 0219 |
| 4 | `evaluate_provisioning_eligibility_v1` — "already assigned" | 0219 |
| 5 | `create_device_claim_v1` / `redeem_device_claim_v1` | 0218 |
| 6 | `consume_terminal_pairing_session_v1` | 0218 |

**The lesson, recorded because it cost the most:** each fix was verified in
isolation and the owner was told to try again. Gate 1 or 2 then refused first,
the board burned its five attempts, and the session locked — against a code the
server had already confirmed was RIGHT. The path must be traced whole before
anyone is asked to act on it.

---

## 4. THE OPEN GAP — a promise the product does not keep

Issuing a pairing session for a seat that already holds a device is refused with:

> `a device already holds this terminal's assignment; revoke it before pairing
> another`

**There is no revoke route.** The Management API exposes only
`POST /partner/terminals` and `POST /terminal-pairing-sessions`. The error names
an action the product does not provide, and the seat had to be freed by direct
database write:

```sql
update kitluy_devices.device_terminal_assignments
   set state='revoked', revoked_at=now() where assignment_id=… ;
update kitluy_devices.device_assignments
   set state='superseded', superseded_at=now() where id=… ;
```

**RECOMMENDED NEXT WORK:** a governed *Release this terminal* action — route,
permission, audit, and a Partner Portal control. It serves both a re-flash and a
genuine seat move, and it is the honest fix. A fourth migration punching through
gate 1 was deliberately NOT written: the system says "revoke first" in six
places, and the answer is to make revoking possible, not to stop saying it.

---

## 5. Other defects found and fixed today

| Defect | Fix |
| --- | --- |
| Every device read `NEVER_SEEN` — liveness read enrolment evidence, not the 60s beat | group 0216 |
| The dev-unbound storage key lived on the partition a re-flash wipes | group 33 |
| `KITLUY_DEV_SSH_PUBKEY` granted SSH but `pi` had a locked password and no sudo | group 33 |
| The Terminal image carried no root CA pin | this group |
| The pairing screen discarded the transport's answer and always said "not available in this build" | group 34 |
| `readDeviceRecordId` read a RETIRED bootstrap file, so pairing refused before the network | group 34 |
| An Admin approval recorded `environment: local`, which the eligibility predicate did not accept | group 0217 |

Every one was latent and only surfaced when a real board was flashed and used.

---

## 6. Known gaps, recorded rather than discovered later

1. **No revoke action** (§4). The one that stranded the terminal tonight.
2. **`hubPaired` is hardcoded `false`** in
   `apps/kitluy-partner-pwa-portal/src/terminal-presentation.ts`, so the
   "Connected to the Store Hub" rung can never turn green. The API sends no
   hub-connection field and nothing on the device would report one. Now that a
   terminal genuinely activates, the ladder shows rung 5 complete while rung 4
   is permanently pending. The ladder's own footnote — "a step that is not yet
   reported has not failed" — is untrue for this rung alone.
3. **`terminal-client` is absent from the image.** The Terminal cannot talk to
   the Store Hub at all; the POS application is the next real feature.
4. **The Management API dies instead of reconnecting** when the database
   restarts: `Connection terminated unexpectedly` reaches an unhandled `error`
   event. A `pool.on("error")` handler would make a failover survivable.
5. **The reset script did not restore PKI trust anchors** (now fixed in the
   script), which silently broke certificate issuance after every reset.

---

## 7. What is NOT claimed

- The Terminal has never talked to the Store Hub. Activation is a fleet fact.
- Nothing was deployed to hosted development or cloud.
- Rungs 6–8 (`appInstalled`, `pinSet`, `active`) remain unbuilt; the 4-digit PIN
  still sits behind the governed application install.
