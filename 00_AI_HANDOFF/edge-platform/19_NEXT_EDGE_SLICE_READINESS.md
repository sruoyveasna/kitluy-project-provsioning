# Next edge slice — readiness

**Date:** 2026-08-07

Per mission §29, Store assignment was **not** started. This records what the
next slice needs, so the decision is the owner's rather than an agent's default.

---

## 1. The one blocker that gates everything

**The canonical chain does not apply to PostgreSQL 16+.** Details and the
reproduction are in `14_CANONICAL_CLOUD_SUPABASE_DEPLOYMENT.md` §3.

Everything downstream — cloud enrollment, heartbeat in a real record, the Admin
read path, Hub provisioning, terminal provisioning — sits behind it. It is not a
large defect; it is a two-migration behavioural conflict introduced by a
PostgreSQL upgrade the chain has never been tested against. But it cannot be
fixed additively, because the failure occurs mid-chain.

## 2. Recommended next task — smallest useful slice

> **Make the canonical chain PostgreSQL 17-compatible, then deploy it to
> `het-kitluy-dev` and re-run the local gates against the remote.**

Scope, deliberately narrow:

1. Set `supabase/config.toml` to `major_version = 17` so local validation
   matches the deployment target. Validating on 15 and deploying to 17 is how
   this stayed invisible; leaving it at 15 guarantees a repeat.
2. Under an explicit owner authorisation to correct applied migrations, adjust
   the governed-role handling so it holds on both majors: after each governed
   role is created, explicitly `REVOKE` the PG16+ auto-granted membership where
   the role is not meant to be entered, and narrow `0151`'s assertion to permit
   exactly the creating role rather than "no non-superuser at all".
   The security property to preserve is _no unexpected member_, which is what
   the assertion was actually protecting.
3. Re-run reset-from-zero on PostgreSQL 17: 86 applied, seed, assertions, RLS.
4. `supabase link` + `db push` to `gkfcxxtryqmjnhujlkdr`; never `db reset`.
5. Verify remote parity against the counts in `15_…EVIDENCE.md` §1.
6. Promote to **DEPLOYED-STAGING** — nothing further.

This is a schema-correctness task, not a feature task, and it should not carry
any new capability with it.

## 3. Then, and only then — the enrollment slice

Still the correct first vertical slice, unchanged from
`13_FINAL_REPORT.md` §L:

1. Real `EnrollmentClient` against `/v1/terminal-provisioning`.
2. Real `ServerIdentityVerifier` with certificate pinning.
3. `KeyProvider` from `@kitluy/device-identity` development crypto.
4. A seeded manufacturing-enrollment record — enrollment is a governed
   manufacturing act, not a self-service call.
5. Package the agent into `/usr/lib/kitluy/firstboot-identity` and
   `/usr/lib/kitluy/enrollment-agent`.
6. Prove: simulated device → enrolled → **unassigned** → heartbeat recorded →
   no Store data reachable.

Steps 1–3 and 5 are independent of the database blocker and could proceed in
parallel if the owner wants throughput; step 6 cannot.

## 4. Then the Store Hub provisioning slice (NOT started, per §29)

When the owner authorises it, the smallest honest slice is:

    existing Digital Store  →  existing Location
        →  Hub enrolled (unassigned)
            →  Hub claimed/assigned to that Location
                →  governed configuration delivered
                    →  Hub reports ACTIVE

Constraints that carry in:

- The Hub does **not** become local Store authority on assignment alone —
  activation requires certificate issuance, which is BLK-005-gated.
- `awaiting_trust` is the state after assignment; `enrolled → active` does not
  exist.
- Partner Portal is not required for this slice. An unassigned device is
  platform-fleet inventory, not Partner-owned Store inventory.

## 5. Admin read path (§18) — deferred, correctly

Not built. It has nothing to display: no cloud database, no enrolled device.
Building a Device Fleet screen now would produce a view that has never rendered
a real row. It is a small task once §2 and §3 land, and the backing read models
(`device_fleet_status`, `fleet_health_read`) already exist.

## 6. Independent of the blocker

These can proceed at any time:

| Task                                                                    | Why it is unblocked                        |
| ----------------------------------------------------------------------- | ------------------------------------------ |
| Provision an arm64 Debian build host and run the first real image build | needs no database                          |
| Debian snapshot pin for reproducible apt state                          | owner decision only                        |
| Compose `rpi-idp-luks2` / dm-verity into the KitLuy layers              | upstream layer already available at v2.7.0 |
| Package the agent into device executables                               | pure packaging work                        |
