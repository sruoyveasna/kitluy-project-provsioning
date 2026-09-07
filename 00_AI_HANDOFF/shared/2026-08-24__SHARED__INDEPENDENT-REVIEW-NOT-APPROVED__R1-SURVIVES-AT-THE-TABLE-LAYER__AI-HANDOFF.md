# KitLuy Task Handoff — independent review says NOT APPROVED, and it was right three times over

## 0. Identity

| Field | Value |
| ----- | ----- |
| Task ID | `KL-DEV-HUB-CRED-0201-A` |
| Task title | Independent security review; stale test-environment disposition; credential-architecture trace |
| Status | **`BLOCKED` — review NOT APPROVED; Steps 5–13 not started** |
| Branch | `claude/fix-firstboot-esm-and-ssh-hostkeys` |
| Base commit | `0a30a74` · Final commit `UNCOMMITTED` |
| Handoff date | 2026-08-24 · Asia/Phnom_Penh |
| Authority | Owner decisions 2026-08-24 (second package) Steps 1–15 |
| Reviewers | Three independent agents, disjoint scopes, each instructed to REFUTE |

## 1. Verdict: **NOT APPROVED**

Ten verification points were assigned. Six hold. Four do not, and the owner's own
rule applies: *"If independent review finds a blocker, STOP and report it."*

| # | Claim | Verdict |
| - | ----- | ------- |
| 1 | bridge accepts no caller timestamp | **PROVEN** — one overload, no `timestamptz` in `proargtypes` |
| 2 | `service_role` cannot choose authoritative time | **REFUTED — BLOCKER** |
| 3 | `cloud_authoritative` only from server time | **REFUTED, now FIXED** (§3) |
| 4 | boolean cannot launder caller data | **PROVEN for the boolean; REFUTED for the model — BLOCKER** |
| 5 | rollback protection enforced | **PROVEN** for all four source classes |
| 6 | 3600 s rule still on device sources | **PROVEN** — each of the three, boundary exact at `+3599`/`+3600` |
| 7 | re-establishment after 2 h / 8 h / 24 h / 14 d | **PROVEN** — all four, landing within 7 ms of `now()` |
| 8 | no reset backdoor | **PROVEN in functions; REFUTED at table/role layer** |
| 9 | Defect A executes each door once | **PROVEN** — A/B control reproduced 7× and 6× on demand |
| 10 | privilege matrices correct | **PARTIALLY REFUTED — MAJOR** |

## 2. The two BLOCKERS — owner decisions, not mine to make

### BLOCKER 1 — R-1 survives one layer above the one I hardened

`0123:922-925` grants `service_role` `select, insert, update` on
`kitluy_devices.device_trusted_time`, and `service_role` has
**`rolbypassrls = true`**. I reproduced it myself:

```sql
set local role service_role;
update kitluy_devices.device_trusted_time
   set trusted_time_floor = now() + interval '3650 days', status = 'trusted'
 where device_id = …;
-- SUCCEEDED -> 2036-08-21T04:49:38Z
```

The monotonic trigger is `before update or delete` and rejects only BACKWARDS
movement, so it waves this through. No function call is involved, so neither
0198 nor 0200 touches it. **0200's guard block tests only
`has_function_privilege` and therefore proves a property narrower than the one it
claims.** Reviewers found two more routes to the same outcome: a self-forged
four-eyes approval into `emergency_time_correction_v1` (`service_role` can write
`kitluy_auth.approval_*`), and rewriting `trust_policy`
(`trusted_time_max_forward_jump_seconds = 315360000`, or `is_active=false` as a
fleet-wide fail-closed DoS, or inserting a forged `production` policy with
`signature_verified=true`).

Closing this means revoking table grants installed by a RELEASED migration across
`device_trusted_time`, `trust_policy`, `device_certificates` and the approval
tables — application-wide blast radius. **Owner decision.**

### BLOCKER 2 — the forward-jump guard does not exist on a NULL floor

`elsif v_floor is not null and v_best > v_floor + v_jump` — unchanged from 0123.
A device with no floor accepts **any** caller-supplied timestamp as its permanent
monotonic floor:

```
NULL floor + rtc = now()+3650 days  ->  trusted, floor := 2036-08-21
then the governed bridge            ->  restricted_clock_rollback, permanently
```

R-1's exact outcome, on the path the device-side gateway is written to call.
**17 devices in the development database are already bricked this way** — and
they were created by my own staleness suite, which offers `now() + 30 days` to a
fresh device to prove no reset exists. The test intent is right; it also
demonstrates the primitive. Not reachable from an application role today
(governor-only EXECUTE), but the invariant the previous handoff claimed is a
property of the BRIDGE, not of the model. **Owner decision.**

## 3. Three defects I introduced, found by review, now fixed and proven

**(a) `cloud_authoritative` was forgeable through `search_path`.**
`evaluate_trusted_time_core_v1` had `proconfig = null` and called bare `now()`.
With a shadowing `evil.now()` first on the path the core returned
`trusted / cloud_authoritative / 2036-01-01` — the caller naming authoritative
time, which is exactly what R-1 forbids. Fixed with `set search_path` **and**
`pg_catalog.now()`, plus an apply-time assertion that all three trusted-time
functions pin their path. Re-ran the reviewer's exploit: now returns the real
clock.

**(b) The exemption was silently forfeited whenever a device source was offered.**
Max-wins selection plus an exemption keyed on the WINNING source meant an RTC one
second fast denied the recovery entirely, and an exact tie resolved to `rtc`.
Fixed structurally rather than documented: mixing now raises
`KLUY-DEVICE-TIME-SOURCE-CONFLICT`. Asking the authority for the time and
offering it a time are different requests; the door takes one.

**(c) Cross-layer conformance went blind.** `trusted-time-conformance.test.ts`
parsed only the 0123 file, so after 0200's `alter type … add value` the database
had six source members, TypeScript listed five, and the suite passed green —
precisely the failure mode its header exists to prevent. `enumMembers` now
applies every later `add value` in filename order, and TypeScript carries
`cloud_authoritative`. Proven by reverting the TS list: 1 failed / 16 passed.

## 4. A BLOCKER in the Wi-Fi console, also mine

**The passphrase was echoed in cleartext.** `readSecret` attached a raw `data`
listener while `main`'s long-lived `readline` interface was still on the same
stdin. readline echoes in terminal mode, so a shop's Wi-Fi password appeared on
the wall-mounted console directly above the asterisks meant to hide it:

```
  Password: S3cretPass
  **********
```

The file's own header claimed the opposite. **No test caught it because the UI
suite injects a fake `secret()` and never runs the real function** — a mocked
boundary proving nothing about the thing it replaces.

Fixed: `main` now creates a readline interface **per prompt** and closes it, so
stdin is unowned between questions, and `assertStdinIsFree()` throws
synchronously if any reader is attached. New `test/read-secret.test.ts` (8 tests)
drives the real function against a real stream.

Four more in the same function, all fixed and tested: UTF-8 was decoded per byte
(`pässwörd1` became mojibake → wrong derived key → "your password may be
wrong"); arrow keys leaked `[` and `A` into the secret (the CSI state machine now
has three states, because `[` is itself in the final-byte range); EOF was
unhandled so the console hung for ever; asterisks counted bytes, not characters.

## 5. And the defect that would have hit Cambodia first

`wpa_cli scan_results` does not print raw SSIDs — it runs them through
`printf_encode()`. A Khmer shop name `កា` (6 bytes) arrives as the 24-character
text `\xe1\x9e\x80\xe1\x9e\xb6`. Hex-encoding **that** stored a wrong SSID and
used the same wrong text as the PBKDF2 salt, so association could never succeed
and the console blamed the installer. At three Khmer characters (9 bytes → 36
escaped) it exceeds `SSID_MAX_BYTES`, and wpa_supplicant answers an over-long
`ssid=` by refusing to parse the **entire file** — killing every other saved
network. The file is slot-shared, so an A/B update does not clear it, and the
console had no forget path. **A Cambodian deployment is the first place this
would have been hit.**

Fixed: `decodeScanSsid` recovers the real bytes, over-long SSIDs are dropped from
the list rather than offered as a trap, `displaySsid` replaces control characters
before anything reaches a console that interprets ANSI, and `AccessPoint` now
carries `ssidBytes` (stored) separately from `ssid` (shown).

Also fixed: open networks were unjoinable (the 8–63 rule was applied to an empty
passphrase, so every unsecured network the screen offered was impossible to
select); and the configuration accumulated one block per failed attempt while the
console said "Nothing was saved" — now composed in memory, written through a
temporary file and renamed, rolled back on refusal, and replacing rather than
stacking a block for the same SSID.

## 6. Stale test environments — disposition

| Target | Version | Port | Head | Applied | Verdict |
| ------ | ------- | ---- | ---- | ------- | ------- |
| `kitluy-repo17` | **17.6** | 54392 | `20260824140000` | 94 / 99 | **CANONICAL** — matches the cloud project's image tag (`30_CLEAN_PG17_CANONICAL_CHAIN_PROOF.md`) |
| `kitluy-repo15` | 15.8 | 54402 | `20260810120000` | 87 | **STALE** — superseded 2026-08-10; activation/issuer roles absent |
| unrelated project | 17.6 | 54322 | `20260718140000` | **394** | **NOT KITLUY** — a different project's database |

The 3 firstboot failures were **entirely environmental**: eleven migrations of
trusted-time and activation work were simply not present. Repointed to the
canonical target and fixed the construction that made the suite rot — the shared
fixture is re-anchored through the governed bridge, because a device-class source
may not close a >1 h gap by design. **No expectation was changed.**

The same class hit `packages/device-identity`: 12 integration files default to
**54322**. Against the canonical target: **85 failures → 0**, 899 passing. Their
default is left alone — repointing 12 files is a separate change, recorded here.
Two files then refuse to run at all, correctly: 8 governor roles are
pre-existing stale borrows on `postgres`, and the suites decline to hand back
somebody else's borrow. Not revoked by hand, as their own message instructs.

**Ledger gap on the canonical DB:** 94 recorded vs 99 files; objects for
0190/0195/0197 present but unrecorded; 0189 and 0196 genuinely absent. **0189 was
not touched.**

## 7. Credential architecture — traced, and the boundary named

Nothing was invented. What exists:

| Question | Answer |
| -------- | ------ |
| CLOUD | `device_certificates` = serial/fingerprint/issuer-ref/validity, **no material** (its own comment: "never certificates, never keys"). `device_credentials` (25 rows) = `canonical_tbs` + `detached_signature`, + 75 chain links |
| DEVICE | Hub reads no credential yet. `hub-agent` needs `HUB_TLS_KEY_PATH`, `HUB_TLS_CERT_PATH`, `HUB_DEVICE_CA_PATH` |
| TRANSPORT | `credential-package.ts` + `verifyCredentialPackage` + `activation-ack.v1` — built and proven **for terminals** |
| KEY | `/var/lib/kitluy/identity/device-identity.key.pem`, 0600, made at firstboot; `generateKeyPair` returns only `{publicKeyPem, privateKeyHandle}` |
| VALIDATION | `verifyCertificateChain`, `publicKeyFingerprint` binding, `assertNoPrivateKeyMaterial` |
| STARTUP | X.509 PEM for `node:https` mTLS, TLS 1.3, `requestCert` + `rejectUnauthorized` |

**Two contract boundaries block Step 5:**

1. **No persistent signing authority.** `DevelopmentCertificateAuthority` calls
   `generateKey()` for root and intermediate **in its constructor** — no load
   path. Every process mints a new CA, so the 25 existing credentials carry
   signatures nothing can verify. Its header: "IS NOT A PRODUCTION CA AND CANNOT
   BECOME ONE". Key custody is **BLK-005, OPEN**.
2. **The credential is deliberately not X.509** (`CREDENTIAL_IS_NOT_X509`) while
   the Hub LAN transport requires X.509. No approved bridge; BLK-005 §14 blocks
   real X.509.

**Also found:** `activate_device_v1` gates on `device_certificates` (metadata),
**not** on `device_credentials` (the signed material). A device reaches ACTIVE
holding no credential material at all — which is what happened in the chain test.
**ACTIVE does not imply the Hub can serve terminals.**

## 8. Verification — executed

| Check | Result |
| ----- | ------ |
| firstboot agent, full | **342 pass / 0 fail** / 9 skip (was 290/3) |
| `read-secret` (NEW) | **8 / 8** |
| `network` + `network-ui` | **31 / 31** (26 new) |
| conformance (widened) | 17 / 17 — and 1 fail when TS drifts |
| device-identity, canonical target | 899 pass / 0 fail; 2 files refuse on stale borrows |
| device-identity, default target | 85 fail — pre-existing, wrong database |
| registry service | 172 pass / 19 pre-existing fail |
| `systemd-runtime.test.sh` | **115 / 0** |
| `build-gates.test.sh` | 32 / 0 |
| `secret:scan` | PASS (1,882 files) |
| `migrations:validate` | PASS (99) |
| typecheck / eslint | PASS / **0 errors** |
| runtime packaging | 23 modules, zero-dependency closure holds |

Image rebuild: **IN PROGRESS at handoff**. The completed earlier build carries the
**defective** console and must not be used. Previous artifact preserved at
`build/preserved-2026-08-20/` with SHA-256
`c7c3d953f6d30c4b60c68880973eaeb2a1069f116e816ee3eed2fe8c367f3b8c`.

## 9. Findings recorded, not fixed

- `credential-projection.ts:250` calls a **21-column** definer as `(fn(...)).*` —
  up to 21 executions per projection on the Hub. Pre-existing; short-circuited by
  an idempotency guard, so no duplicate rows.
- `service_role` inherits **both** `kitluy_activation_service` and
  `kitluy_device_certificate_issuer` with `rolinherit`, so 0199's stated
  separation of duty is false as deployed; it also holds 0123's raw
  `issue_device_certificate_v1` with a caller-chosen fingerprint (reproduced:
  a certificate bound to a key the device does not hold).
- Migrations 0120–0125 contain blanket "grant all functions to service_role"
  loops; a future migration copying that idiom silently re-opens the 0200 revoke.
- The monotonic trigger is bypassable by the table owner via
  `session_replication_role='replica'`, and TRUNCATE has no trigger.
- `outcome.trusted_time` returns the attacker's value on a refusal.
- The edited 0198 has never executed anywhere — the local DB recorded its
  original vulnerable form and was converged by 0200.

## 10. Truth statement

- Production / staging / hosted development: **NO writes of any kind.**
- Local PG17: 0200 re-applied; fixtures created and retired; all destructive
  probes rolled back.
- Committed / pushed / deployed: **NO.** `0189`: untouched.
- Secrets: `secret:scan` PASS.
- Hardware evidence: **NONE.**
- Status claimed: **TRUSTED_TIME_SECURITY_REVIEW_NOT_APPROVED.** Not
  `CERTIFICATE_DELIVERY_TESTED_IN_DEV`, not `HUB_LOCAL_SERVER_TESTED_IN_DEV` —
  neither was started. Wi-Fi/timezone recipe assertions remain
  `IMAGE_CONTRACT_VERIFIED`; the artifact is pending rebuild.

## 11. Next step — three owner decisions

1. **BLOCKER 1** — revoke `service_role`'s table/policy write reach, or accept it.
2. **BLOCKER 2** — the NULL-floor first-boot primitive, and what to do with the
   17 already-bricked development devices.
3. **The signing authority** — a persistent development CA, and how a Hub gets
   X.509 for LAN mTLS when the canonical credential is deliberately not X.509.

Until (3), Steps 5–8 and 11 cannot be built at all.
