# KitLuy Task Handoff — a Raspberry Pi went from box to paired Hub, on real hardware

## 0. Identity

| Field              | Value                                                          |
| ------------------ | -------------------------------------------------------------- |
| Task ID            | `KL-DEV-REG-0197-C`                                            |
| Task title         | Hardware proof of register → approve → pair; console and UI fixes |
| Product/build      | KitLuy Suite — Store Hub / Pi fleet, Phase 1                   |
| Primary agent      | Claude Opus 5 (1M context)                                     |
| Status             | `PARTIAL`                                                      |
| Branch             | `claude/fix-firstboot-esm-and-ssh-hostkeys`                    |
| Base commit        | `866a2b4`                                                      |
| Final commit       | `UNCOMMITTED` — 63 files                                       |
| Handoff date       | 2026-08-20 (covers 2026-08-19 and 2026-08-20)                  |
| Predecessor        | `2026-08-19__SHARED__DEVICE-REGISTRATION-CLOUD__…`             |
| Requested reviewer | Owner (Veasna), then independent review                        |

## 1. Outcome

**The whole chain ran on real hardware for the first time.** A Raspberry Pi 5 was
flashed, plugged into ethernet, and with no card preparation and nothing typed:

1. firstboot created a device identity;
2. the agent read the board's own serials and registered to the Supabase Edge
   Function over the internet;
3. it appeared in the Admin Portal as pending;
4. the owner approved it with a reason and verification reference;
5. the owner generated a pairing code in the Partner Portal and typed it on the
   Hub's console;
6. the Hub was assigned to `DEMO-LAUNDRY-001 / DEMO-PP-01`.

Board continuity was proven twice on hardware: a **new SD card in the same
board** returned the SAME `device_record_id`, kept its approval, and gained a new
installation generation.

Current fleet truth:

```text
KL-6CBB3BC0D49B   awaiting_trust   pi5-hyzmim   installation generation 2
assignments = 1     device_credentials = 0
```

`awaiting_trust` is the correct terminal state for today: activation is gated on a
certificate and nothing can issue one (BLK-005).

## 2. Three defects found by USING it, not by testing it

Each was invisible to the test suite and immediately obvious to an operator.
These are the most valuable output of the two days.

**The Hub refused its own pairing code.** The Partner Portal renders a code
grouped for readability (`4A5M MGSC`). The console validated with
`raw.trim()`, which strips surrounding whitespace but not the separator inside,
so it saw nine characters and reported a malformed code. Both halves were
individually reasonable; together they were broken. Fixed with
`normalisePairingCode()` — spaces, dashes and case are now tolerated, alphabet
and length checks unchanged.

**A successfully paired Hub displayed `Store … Unassigned`.** `render()` resolved
identity from `bootstrap?.deviceRecordId` — the ticket path — which a
cloud-registered device does not have. Pairing had genuinely succeeded
(`store-hub-paired`, a `device_assignments` row); the screen could not see it.
Fixed to use the same `resolvePairableDeviceId()` the prompt uses.

**The console restart-looped after success.** On pairing it called `return`; the
unit is `Restart=always`, so systemd restarted it every ~5 seconds — the restart
counter reached **50** within minutes. Pre-existing, and unreachable until
somebody actually paired. Fixed by staying alive.

## 3. Files changed

| Path                                                          | Change                                        |
| ------------------------------------------------------------- | --------------------------------------------- |
| `services/…/src/bin/hub-pairing-ui.ts`                        | code normalisation; identity resolution; no restart loop; conditional `Fleet` row |
| `services/…/test/hub-pairing-registration-gate.test.ts`       | NEW — 23 tests                                |
| `services/…/test/hub-pairing-ui.test.ts`                      | 2 assertions reversed deliberately (§6)       |
| `services/kitluy-management-api/src/hub-pairing-issuance.ts`  | NEW `readPairingSession()`                    |
| `services/kitluy-management-api/src/http.ts`                  | `GET /hub-pairing-codes/{id}`; approval route; **CORS methods fix** |
| `services/kitluy-management-api/src/device-approval.ts`       | NEW — pending read model + approval call      |
| `services/kitluy-management-api/openapi.yaml`                 | both new routes documented                    |
| `services/kitluy-device-registry-service/src/issuance-gateway.ts` | NEW — `GovernedIssuanceGateway` over the deployed SQL doors |
| `apps/kitluy-admin-pwa-portal/src/{views,device-presentation,messages,App,routing,access}` | approval queue, fleet summary, plain-language status |
| `apps/kitluy-partner-pwa-portal/src/{App,pairing-client,messages}` | live pairing status, better code panel     |
| `infra/kitluy-store-hub-image/…/multi-user.target.wants/`     | legacy enrolment agent symlink REMOVED        |
| `docs/authority/kitluy-decision-…-register-v1.0.0.md`         | `KLREC-2026-08-19-DEVICE-IDENTITY-PER-SLOT-001` |

63 files in total, nothing committed.

## 4. What was built

**Admin Portal.** A `Devices awaiting approval` queue with the §4.3 evidence, a
`Verify & approve` form requiring a typed reason and a verification reference
(plan §4.4 forbids one-click trust), a fleet summary bar, an action banner, and
plain-language lifecycle labels — `manufactured` now reads "Waiting for
approval" instead of a word that sounds like a factory step.

**Partner Portal.** The code panel polls `GET
/management/v1/hub-pairing-codes/{sessionId}` every 3 seconds and flips to
"Paired" by itself, naming the device. Polling, not Realtime: OD-ADMIN-FLEET-001
keeps `kitluy_devices` closed to browsers. Success beats the clock — a code used
at 14:59:58 shows Paired, not expired.

**Store Hub image.** Rebuilt three times. The final artifact
(`kitluy-storehub-os-arm64.img.zst`, 2026-08-20 11:38) carries the console
fixes and retires the legacy enrolment agent.

**Certificate gateway.** `issuance-gateway.ts` implements the four-method
`GovernedIssuanceGateway` against `prepare_` / `record_signature_` /
`finalize_device_credential_issuance_v1`. It allocates nothing — serials,
generations, credential ids and validity windows all come from the database.
Typechecks; **never executed**.

## 5. Validation

| Check                                            | Result                        |
| ------------------------------------------------ | ----------------------------- |
| Hardware: register → approve → pair               | `PASS` — twice, incl. reflash |
| Board continuity on hardware (new card, same board) | `PASS` — same id, gen 2     |
| `vitest` management API                          | `PASS` 129/129                |
| `vitest` firstboot agent (console suites)        | `PASS` 43/43                  |
| `vitest` admin portal                            | 87 pass, 1 pre-existing fail  |
| `vitest` partner portal                          | 18 pass, 2 pre-existing fail  |
| `build-gates.test.sh`                            | `PASS` 32/32                  |
| `systemd-runtime.test.sh`                        | `PASS` 102/0                  |
| `contracts:validate`                             | `PASS` 4/4                    |
| `secret:scan`                                    | `PASS` (1845 files)           |
| typecheck + eslint, all touched packages         | `PASS`                        |

The 3 remaining failures are pre-existing and were each proven so by reverting to
untouched HEAD sources and re-running. They share one cause: smoke tests that
assert the app fails closed when unconfigured, while `.env.local` files now make
it configured.

## 6. Two deliberate reversals of existing guarantees

Both are recorded in the tests rather than deleted, with the reasoning inline.

**`looksLikeCode` now accepts presentation forms.** It previously asserted
`ABCD-8291` must be rejected, on the rule that stripping is the caller's job. The
only caller stripped with `trim()` and missed the internal space. Validation and
normalisation now sit together so the pair cannot be misused that way.

**The `Fleet` row is now conditional.** It previously asserted `Fleet … Unknown`
and `Fleet … Not enrolled`. Both wordings described a ticket enrolment that will
never happen on a Hub, and printed a contradiction beneath `KitLuy … Approved`.

## 7. Not done / not verified

- **Certificates.** The gateway exists and has never run. Persistent dev CA,
  trusted-time establishment, the issuance route, the device client and terminal
  verification are all unstarted.
- **A gate that had not been surfaced before today: trusted time.**
  `evaluate_trusted_time_v1` wants a valid RTC reading, an authenticated network
  time and a signed token time. The Hub has **zero** trusted-time rows, and
  issuance sits behind it. The order is trusted time → certificate → activation.
- **Nobody has driven the Partner portal's polling loop in a browser.** The route
  is verified by direct call; the loop is not.
- **The new image has not been flashed.** All hardware evidence above comes from
  the 2026-08-19 image plus the first two console fixes.

## 8. Findings recorded, not fixed

**A reflash makes a paired Hub forget its shop.** `pairing-state.json` lives on
`/var/lib/kitluy/`, and `/var` is bind-mounted per-slot
(`/persistent/slots/<slot>/var`), so a reflash wipes it. The cloud still holds the
assignment; the console will show `Unassigned` and prompt for a code the device
does not need. **Nobody should type one until it is known whether the cloud
refuses a second pairing or silently creates a second assignment.** The fix is to
learn the assignment from the registration answer the agent already receives
every 60 seconds.

**The certificate policy is internally inconsistent.** 30-day lifetime, 10-day
renewal window, 720-hour (30-day) offline grace. A shop losing WAN just before
renewal has ~11 days of validity, not 30. Confirmed independently by an external
review. **Nothing consumes `offline_grace_hours`** — it is declared and validated
non-negative and read by no decision — so no shipped code misbehaves today, and
the numbers are free to change until issuance exists. The relationship to hold:
_remaining validity at earliest renewal > maximum offline duration + margin_.

**`manufacturing_enrollment_tickets` reached 2,843 rows.** The retired legacy
agent mints one per failed attempt every 30 seconds. `postgres` cannot delete
from that table (owned by `kitluy_fleet_governor`; the PG16 membership issue in
`KLREC-2026-08-17-PG16-ROLE-MEMBERSHIP-001`). Flashing the new image stops the
growth; clearing the backlog needs the owning role.

**A pre-existing CORS defect, fixed in passing.** `resolveCorsHeaders` advertised
`GET, OPTIONS` while the surface already had a POST route
(`/hub-pairing-codes`), so a browser preflight was answered with a method list
that excluded it. That route worked for `curl` and could never have worked from
the Portal it exists for. Now `GET, POST, OPTIONS`. No test asserted the old
value; one should.

**A route can exist in source and not in the running service.** The Partner
polling route returned 404 in a live check because the Management API had been
running since the previous morning from a `dist` predating it. Typechecking is
not deployment.

Carried forward: `KLREC-2026-08-19-DEVICE-IDENTITY-PER-SLOT-001` (device key on a
per-slot path), `sudo` shipping despite the config asking to purge it, and
`bootTested` hard-coded `false` in the manifest although this lineage has now
booted and paired.

## 9. Development database reset

At owner request, every non-fixture device and its dependent rows were deleted
from the hosted development project (~750 rows) so the flow could be rehearsed
from zero. Executed by the owner from a guarded script
(`scratchpad/reset-devices.mjs`): project-ref allowlist, protected-count
comparison for `auth.users`, admin profiles, role assignments, stores and
locations, and automatic rollback on any surprise. Protected data was unchanged.

The first attempt failed with `25P02` because the script caught a permission
error and continued — PostgreSQL aborts the whole transaction on any error.
Fixed with a savepoint per statement. Nothing was partially deleted.

## 10. Rollback

Nothing is committed. Code rollback is `git checkout` plus deleting new files;
the retired agent is one symlink to restore. The cloud is NOT rolled back by
that: `0197` and the Edge Function remain deployed, and the deleted device rows
are gone.

## 11. Next step

1. **Flash the current image.** It stops the ticket growth and makes the console
   honest. Maintenance, not a milestone.
2. **Fix the reflash-forgets-its-shop gap** so reflashing stops asking for codes.
3. **Settle the 30 / 10 / 30 policy numbers.** Free today; baked into every field
   certificate once issuance exists.
4. **Then certificates as their own run**, in order: persistent dev CA → trusted
   time → issuance route → device client → terminal verification.

## 12. Truth statement

- Production modified: `NO`.
- Hosted development project modified: **`YES`** — devices deleted at owner
  request; `0197` and the Edge Function remain deployed from 2026-08-19.
- Secrets in code, docs, logs or this handoff: `NO`. `secret:scan` passed; every
  command's output was redaction-filtered.
- Committed or pushed: `NO`.
- Capability claimed: **register → approve → pair is `PROVEN-ON-HARDWARE`.**
  Certificates, activation and terminal service are not claimed and are not
  built. The issuance gateway is written and has never run.
