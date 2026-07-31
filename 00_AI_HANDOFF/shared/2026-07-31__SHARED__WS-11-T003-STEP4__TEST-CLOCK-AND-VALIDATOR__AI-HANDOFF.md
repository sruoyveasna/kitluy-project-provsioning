# WS-11-T003 Step 4 — sanctioned test clock and the validator regression

| Field     | Value |
| --------- | ----- |
| Task ID   | WS-11-T003 Step 4 — §2 (test clock), §6 (validator regression) |
| Date      | 2026-07-31 · Asia/Phnom_Penh |
| Start SHA | `f0580a3` (50 ahead, clean) |
| End SHA   | `cb74593` + this note |
| Toolchain | Node **v22.23.0**, pnpm **9.15.9** (project-external; pin unchanged) |
| Migrations| cloud **0157** added; Hub 0027 unchanged |
| Status    | **PARTIAL — Step 4 NOT promoted.** §2 and §6 done; §3, §4, §5, §7, §8 NOT done |

## §6 — the db:validate regression is resolved, and so are the three that predated it

The report said three known false positives had become four because of my group
0156. I traced it rather than accepting it, and **one root cause produced all four**.

The schema cross-check flags `kitluy_something.` as a schema qualification. That is
right in code and wrong in PROSE — and a `COMMENT ON ... IS '...'` body is prose:

```sql
comment on function ... is
  '... SECURITY DEFINER owned by kitluy_activation_governor. EXECUTE only ...';
```

The role name ends a sentence, a full stop follows, and the lint reports an
undeclared schema. Groups 0127, 0131, 0152 and 0156 were all this — all documenting
ROLE names, none referencing a bad schema.

**Fix:** strip only `COMMENT ON ... IS '...'` bodies before the cross-check. Ordinary
string literals are deliberately NOT stripped, so a genuine reference inside dynamic
SQL is still caught.

**Regression test:** there is no script test harness in this repository, so the test
runs inside `db:validate` itself on every invocation and fails the command if the
detector stops detecting. Five cases: direct reference, dynamic SQL, whitespace
around the dot, role-in-prose that must NOT flag, and real code beside a COMMENT
that must still be scanned.

`db:validate` now **exits 0 with all static checks passing across 55 files**. The
"known false positives" condition carried since group 0127 is gone, not re-described.

## §2 — the sanctioned test clock (migration 0157)

| Requirement | How |
| ----------- | --- |
| Business RPCs take no clock parameter | Asserted by scanning `pg_get_function_arguments` across `kitluy_devices` and `kitluy_auth` |
| Normal time is database time | `authoritative_now_v1()` returns `clock_timestamp()` unless two stored conditions hold |
| Only the designated test database | `kitluy_ops.test_clock_policy` created EMPTY, never seeded by any migration — the group-0120 PKI-gate pattern |
| Only environment `test` | CHECK constraint refuses any other value |
| Only through a governed helper | `test_clock_set_v1`, SECURITY DEFINER |
| Owned by a NOLOGIN authority | `kitluy_test_clock_authority` |
| Executable only by the harness | `kitluy_test_harness`, and nothing else |
| Transaction-local | `set_config(..., is_local => true)` |
| Other environments ignore it | No policy row ⇒ the GUC is never consulted |
| Runtime/service/human roles refused | Proved by execution, `42501` |
| No login role may SET ROLE to the authority | Ownership borrow handed back; asserted |
| No persistent row survives | Suite asserts the policy table is empty afterwards |

**What it does not claim, and says so in the migration:** inside a database where the
policy row exists, a session that can already execute arbitrary SQL can set the GUC
directly. The boundary is **between databases**, not within one. Production is safe
because it has no policy row, and the reader does not consult the GUC without one.

11 hostile tests, all inside rolled-back transactions. `service_role` is refused
despite global BYPASSRLS — row security is not what protects the clock, a function
grant is.

## Verification (Node 22.23.0)

| Step | Result |
| ---- | ------ |
| `db:apply` 0157 | applies; both assertions fire, including "proved inert" |
| device-registry-service | **134 passed, 0 skipped (10 files)** |
| `migrations:validate` | exit 0 |
| `db:validate` | **exit 0 — all static checks pass (55 files)** |
| `secret:scan` | exit 0 |
| `lint` | exit 0 |

## NOT done

- **§3 real 300-second expiry race** — the clock this unblocks now exists, but the
  race is not written.
- **§4 incident-scope mutation race.**
- **§5 identical vs conflicting replay race.** Note the database already returns
  `KLUY-EMERGENCY-CONFLICTING-REPLAY`, so the behaviour exists; the separate-session
  proof does not.
- **§7 production lifecycle.**
- **§8 fresh independent re-review.**

All three concurrency scenarios need the same missing fixture: a **granted-permission
emergency SUCCESS** — a human holding `fleet.device_credential.emergency_revoke` with
live re-authentication evidence, executing a real emergency revocation. Every suite so
far has proved refusals, never a success. That fixture is the single largest remaining
piece of work and should be built once and shared by §3, §4, §5 and §7.

## FINAL STATUS

```text
WS-11-T003 Step 4 — NOT PROMOTED
```

Per §10, a missing concurrency scenario prevents promotion.

## Recommended next

1. Build the granted-permission emergency-success fixture ONCE (permission grant +
   `record_reauthentication_evidence_v1` + governed execution), then reuse it.
2. §3 using `test_clock_set_v1` inside the parked transaction.
3. §4 and §5 on separate sessions with recorded backend PIDs.
4. §7 lifecycle, then §8 two fresh reviewers.
