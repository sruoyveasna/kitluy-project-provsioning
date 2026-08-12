# End-to-end provisioning evidence

**Date:** 2026-08-07

**None of the three end-to-end acceptance scenarios was achieved.** All three
require a cloud target that does not exist. What was proven in simulation is
stated below, separately and without inflation.

---

## 1. Scenario status

| Mission scenario                                                                                      | Status           | Blocked by                                                         |
| ----------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------ |
| §32 fresh Pi → enrolls → ONLINE in Admin → `ENROLLED_UNASSIGNED` → no Store data                      | **NOT ACHIEVED** | no cloud target; no device executable; no Admin UI; no Pi hardware |
| §33 Digital Store → Location → Hub enrolled → claimed/assigned → activates → online                   | **NOT ACHIEVED** | no cloud target; activation is BLK-005-gated                       |
| §34 terminal enrolled → assigned to Location + Hub + profile → config → discovers Hub → mTLS → ACTIVE | **NOT ACHIEVED** | as above                                                           |

No scenario is claimed as partially achieved. Each needs all of its links.

## 2. What WAS proven — simulated, in development

### 2.1 The enrollment slice, in simulation

`services/kitluy-device-firstboot-agent` — 31 tests, all passing, typecheck
clean. The mission's §31 OS/agent test list is covered:

| §31 requirement                 | Covered                                              |
| ------------------------------- | ---------------------------------------------------- |
| firstboot rerun safety          | yes — 10-boot rerun, torn write, unusable key        |
| enrollment retry                | yes — retryable vs non-retryable                     |
| offline / reconnect             | yes — 3-step flaky client completes                  |
| invalid server identity         | yes — refuses and **transmits nothing**              |
| revoked identity                | yes — 5 terminal states + mid-session revocation     |
| assignment polling              | yes — unassigned, assigned, no re-poll once assigned |
| configuration version behaviour | yes — newer/equal/older/malformed                    |

Plus the isolation property the first scenario turns on: an enrolled unassigned
device receives **no** Tenant, Digital Store or Location value.

**This is simulation.** Test doubles stand in for the cloud, the key provider
and the server identity verifier — which is the correct approach where hardware
is unavailable (§31), and is not the same as an end-to-end run.

### 2.2 The image build, executed

`bash infra/kitluy-os-image/test/build-gates.test.sh` → **34 passed, 0 failed**.

Both profiles stage a real root filesystem with correct unit ordering, correct
profile separation, no secrets and no baked assignment truth. No flashable image
is produced and none is claimed.

### 2.3 The database, executed from zero

86 migrations → seed → assertions → RLS, all exit 0, plus idempotency and type
generation (`05_CLOUD_SUPABASE_PLAN.md` §1).

## 3. What stands between simulation and scenario 1

In dependency order:

1. **An empty canonical-lineage Supabase project** — the hard blocker.
2. **Device executables.** The systemd units reference
   `/usr/lib/kitluy/firstboot-identity` and `/usr/lib/kitluy/enrollment-agent`;
   the agent's logic exists and is tested, but is not packaged into a binary.
3. **A real `EnrollmentClient`** against `/v1/terminal-provisioning`, and a real
   `ServerIdentityVerifier` doing certificate pinning.
4. **A real `KeyProvider`.** Development crypto exists (`dev-crypto.ts`);
   hardware-backed key custody is BLK-005 §4-gated.
5. **A minimum Admin fleet view** to satisfy "appears ONLINE in Admin".
6. **Raspberry Pi hardware.** Until then, no hardware certification may be
   claimed under any circumstances.

## 4. Honest status line

    kitluy-os-image build system          SCAFFOLDED-EXECUTABLE (34 tests)
    firstboot/enrollment agent logic      IMPLEMENTED-IN-DEV (31 tests)
    device executables                    NOT BUILT
    cloud deployment                      BLOCKED — no valid target
    Admin/Partner provisioning UI         NOT STARTED
    end-to-end scenarios 1, 2, 3          NOT ACHIEVED
    hardware certification                NOT CLAIMED — no Pi has run this
