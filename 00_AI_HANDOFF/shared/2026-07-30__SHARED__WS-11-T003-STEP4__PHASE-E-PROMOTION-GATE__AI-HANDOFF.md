# WS-11-T003 Step 4 — Phase E: independent review and promotion gate

| Field           | Value                                              |
| --------------- | -------------------------------------------------- |
| Task ID         | WS-11-T003 Step 4 — Phase E                        |
| Date / timezone | 2026-07-30 · Asia/Phnom_Penh                       |
| Repository root | C:/Users/Hello-Evo-PC/Desktop/HET-KITLUY-PROJECT   |
| Reviewed SHA    | 6eda48fb4e732795ff366eb98d04ff02a9864f13           |
| Status          | Phase E COMPLETE — Step 4 gate decided (see §Gate) |

## Independent reviewers (3/3)

| #   | Lens                                      | Agent                                                                                                                  | Verdict                    | Review file                                                                                         |
| --- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | Database / RBAC / re-authentication       | [DB/RBAC](f888624e-90b5-49d0-9354-70dae070e80f)                                                                        | `APPROVED-WITH-CONDITIONS` | `00_AI_HANDOFF/reviews/2026-07-30__WS-11-T003-STEP4-PHASE-E__DB-RBAC-REAUTH__REVIEW.md`             |
| 2   | Gateway / worker / production composition | [Gateway](fa48f3f0-153b-4fd7-8055-b040f1eda97a)                                                                        | `APPROVED-WITH-CONDITIONS` | `00_AI_HANDOFF/reviews/2026-07-30__WS-11-T003-STEP4-PHASE-E__GATEWAY-WORKER-COMPOSITION__REVIEW.md` |
| 3   | Concurrency / evidence / test integrity   | [Concurrency](c4d7d83a-1ab2-48ef-8291-3d7ba1f107e1) (+ confirming re-run [a8ae](a8ae7da1-4319-4063-9c62-c13da0237f1e)) | `APPROVED-WITH-CONDITIONS` | `00_AI_HANDOFF/reviews/2026-07-30__WS-11-T003-STEP4-PHASE-E__CONCURRENCY-EVIDENCE__REVIEW.md`       |

No CRITICAL code-blocking findings. No self-approval by the Phase A–D primary writer.

### Cross-lens summary

- **DB/RBAC:** RC-021 exploit refused for every runtime role; governed door requires `auth.uid()` + permission; 300s re-auth is DATA; evidence single-use / class-bound; approval-reader SELECT-only; worker can reach lapse sweeper (0154); PUBLIC EXECUTE in `kitluy_devices` = 0.
- **Gateway/composition:** adapters sound; gateway calls only `revoke_device_credential_bound_v1`; lookup fail-closed. **`RevocationGateway` is NOT production-wired** — library-available-but-uncalled (RV-GW-001). No TS production worker calls the lapse RPC (RV-GW-002). Offline snapshot serials still caller-supplied (RV-GW-003). KLREQ-034 OPEN.
- **Concurrency/evidence:** 9 true Lock races + 2 SKIP LOCKED concurrent; scenarios 11–12 are sequential/single-backend (real properties, not Lock races); 13 proves `42501` not `42883`. Containment BEFORE→revoke→AFTER real. Handoff packaging overclaims corrected under RV-CE-001/002.

### Conditions closed this session by the primary writer

| Condition                   | Source                   | Action                                                                                                                                                                          |
| --------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean `db:test` §§41c / 47b | R1 C1, R3 RV-CE-003      | `db:reset` → `db:seed` → `db:test` **PASS**; notices `PASS ws11-emergency-post-approval-never-reverses`, `PASS ws11-phase-d-containment`, `PASS ws11-rc022-spendability-census` |
| Handoff race packaging      | R3 RV-CE-001 / RV-CE-002 | Phase D handoff table rewritten: scenario 2 = REVOKED mid-park (not clock expiry); 11/12/13 classified honestly                                                                 |

### Conditions that remain open (do not close by silence)

| Condition             | Source              | Meaning                                                                      |
| --------------------- | ------------------- | ---------------------------------------------------------------------------- |
| RV-GW-001             | R2                  | No production caller of gateway / lookup                                     |
| RV-GW-002             | R2                  | No production TS worker invokes the lapse sweeper                            |
| RV-GW-003             | R2                  | Offline Hub snapshot path still unjoined                                     |
| RV-GW-004 / KLREQ-034 | R2                  | Device-level revoke set = `retired` only                                     |
| R1 C2                 | R1                  | Tenancy RLS if emergency-auth reads widen beyond `service_role`              |
| Node baseline         | R3 CE-003 / handoff | Re-run on `.nvmrc` Node 22 before treating aggregate verify as authoritative |

## Gate decision

```text
IMPLEMENTED-IN-DEV WITH RECORDED ENVIRONMENT CONDITION
```

**What that means (and what it does not):**

- **Promoted to IMPLEMENTED-IN-DEV (component):** the governed emergency path in the database (0148–0154), post-approval / lapse, recorded-set spend, RC-019/021/022/023 closures, concurrency and containment evidence, and the `@kitluy/device-identity` library adapters (`createPgRevocationGateway`, `loadRevocations`) as **proven library + local-DB** capability.
- **Explicitly NOT claimed:** production-wired `RevocationGateway`; production TypeScript lapse worker; offline Store Hub snapshot containment; WS-11 overall; T004–T008; pilot/production.
- **BLOCKED** as a separate statement for any wording that would answer “Is RevocationGateway production-wired?” with yes. The honest answer remains: **NO — library-available-but-uncalled.**

Promotion criteria from the Step 4 continuation prompt mapped:

| Criterion                                      | Result                                   |
| ---------------------------------------------- | ---------------------------------------- |
| RC-019 closed                                  | PASS (prior)                             |
| RC-021..024 closed                             | PASS (021–023 Phase A–C; 024 owner 300s) |
| RC-025/026 reconciled                          | PASS (recorded)                          |
| Approved emergency reasons / legacy impossible | PASS (R1)                                |
| Post-approval and lapse work                   | PASS (R1 + clean db:test 41c)            |
| Real RevocationGateway **production-wired**    | **FAIL** (RV-GW-001) — library only      |
| Concurrency / lifecycle / containment          | PASS (R3 + clean 47b)                    |
| Reviewers no code blocker                      | PASS (all AWC)                           |
| Evidence / handoffs complete                   | PASS (this note + packaging fix)         |
| Working tree clean at gate record              | see commit that lands this note          |

## Intentionally NOT done

- Wire gateway/lookup into a production Hub / Edge / Admin caller (needs its own task).
- Populate signed snapshot `revokedCertificateSerials` from `loadRevocations`.
- Deploy a production TS lapse worker.
- Close KLREQ-034.
- Push. T004–T008.

## Recommended next

A dedicated composition task: production caller for `createPgRevocationGateway` + `loadRevocations`, and Hub snapshot population from the lookup — then a fresh independent re-review of the wiring only. Until then, cite Step 4 as **IMPLEMENTED-IN-DEV WITH RECORDED ENVIRONMENT CONDITION (library + local DB; not production-wired)**.
