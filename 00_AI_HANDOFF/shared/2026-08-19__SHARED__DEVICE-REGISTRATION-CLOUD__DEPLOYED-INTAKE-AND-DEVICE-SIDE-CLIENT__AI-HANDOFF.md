# KitLuy Task Handoff — the cloud intake is deployed and a device can now reach it

## 0. Identity

| Field              | Value                                                         |
| ------------------ | ------------------------------------------------------------- |
| Task ID            | `KL-DEV-REG-0197-B`                                           |
| Task title         | Deploy the intake; device-side client; Admin approval surface |
| Product/build      | KitLuy Suite — Store Hub / Pi fleet, Phase 1                  |
| Primary agent      | Claude Opus 5 (1M context)                                    |
| Status             | `PARTIAL`                                                     |
| Branch             | `claude/fix-firstboot-esm-and-ssh-hostkeys`                   |
| Worktree           | `repos/het-kitluy-project` (canonical, no worktree)           |
| Base commit        | `866a2b4`                                                     |
| Final commit       | `UNCOMMITTED`                                                 |
| Handoff date       | 2026-08-19                                                    |
| Predecessor        | `2026-08-17__SHARED__DEVICE-REGISTRATION-APPROVAL__…`         |
| Requested reviewer | Owner (Veasna), then independent review                       |

## 1. Outcome

The predecessor handoff ended with a database layer and an Edge Function that
were **local only**, and this sentence: _"No device-side client exists, so no Pi
can register yet."_ Both halves are now closed.

Observable, each proven below:

- `kitluy-project-pos` is at **96/96**. Migration `0197` is deployed and the
  `device-registration` Edge Function answers on the public internet.
- The **12-check contract probe passes against the deployed function**, not a
  local one.
- The firstboot agent has a registration client, and driving it against the live
  cloud produced the plan's core requirement: the same board with a **new key, a
  new card and a new hostname** kept ONE `deviceId` and gained a new
  `installationId`.
- A Store Hub image was built with the cloud route baked in, so a flashed card
  registers itself with no workstation involved.
- **An Admin can now approve a pending board from the Portal**, with a typed
  reason and a verification-evidence reference. Proven against the live cloud:
  a blank reason, a blank evidence reference, a pilot approval without a second
  approver, and a re-approval of an already-enrolled device are each refused;
  a complete approval moved a real device `manufactured -> enrolled`.

Owner authorization for the deploy was given in-session; it went through
`pnpm db:deploy:hosted-dev`, the allowlisted forward-only path, and nothing else.

## 2. Source-of-truth checked

| Source                                                  | Version             | Section/path                       | Result                                              |
| ------------------------------------------------------- | ------------------- | ---------------------------------- | --------------------------------------------------- |
| Owner plan, "Direct-to-Cloud Hybrid Trust Plan"         | v1.0.0 (2026-08-17) | §1.4, §2.1, §3.1–§3.4, §5.1, §5.2  | followed; one recorded deviation (§3, below)        |
| Owner plan, "Make the KitLuy Pi image … reachable"      | 2026-08-11          | steps 1–5                          | re-checked; 3 of 5 implemented, step 4 still absent |
| `docs/api/device-registration-edge-function-v1.md`      | v1                  | §3, §4, §5, §9, §10                | client built FROM the contract, not from the server |
| `kitluy-decision-and-reconciliation-register-v1.0.0.md` | v1.0.0              | KLD-2026-08-17-DEVICE-REGISTRATION-APPROVAL-001 | unchanged; one new KLREC added         |
| `CLAUDE.md` cloud environment section                   | —                   | project ref, pooler rules          | ref read from local-config, not assumed             |
| Live cloud (`gjgbnkhuwlwhngbtrgts`)                     | 96 migrations       | `kitluy_devices.hardware_profiles` | `CLOUD-HUB-PI5` / `CLOUD-TERM-PI5` are the real keys |

## 3. Files changed

| Path                                                                     | Change                                            | Why                       |
| ------------------------------------------------------------------------ | ------------------------------------------------- | ------------------------- |
| `supabase/config.toml`                                                   | `[functions.device-registration] verify_jwt=false` | contract §3, durably      |
| `services/…/src/device-registration-bytes.ts`                            | NEW — device copy of the canonical signing form   | zero-dependency rule      |
| `services/…/src/installation.ts`                                         | NEW — installation identity, one per root install | plan §3.2                 |
| `services/…/src/registration-state.ts`                                   | NEW — console-facing registration phases          | plan §3.3                 |
| `services/…/src/adapters/http-registration-client.ts`                    | NEW — the registration transport                  | plan §3.1                 |
| `services/…/src/bin/cloud-registration.ts`                               | NEW — the boot-time agent                         | plan §3                   |
| `services/…/src/bin/hub-pairing-ui.ts`                                   | renders a KitLuy row + device id + headline       | plan §3.3                 |
| `services/…/test/device-registration-bytes-drift.test.ts`                | NEW — 11 tests                                    | keeps the third copy safe |
| `services/…/test/http-registration-client.test.ts`                       | NEW — 18 tests                                    | wire compatibility        |
| `services/…/test/cloud-registration-pass.test.ts`                        | NEW — 9 tests                                     | the wiring, not the wire  |
| `infra/kitluy-store-hub-image/scripts/build-rpi-image.sh`                | `--registration-url`, `--hardware-profile-key`    | plan §5.1                 |
| `infra/…/rpi-image-gen/layer/kitluy-hub-base.yaml`                       | two new `image.env` keys + their injection        | plan §5.1                 |
| `infra/…/kitluy-hub-base.rootfs-overlay/…/kitluy-cloud-registration.service` | NEW unit + enablement symlink                 | the agent must run        |
| `infra/…/kitluy-hub-base.rootfs-overlay/usr/lib/kitluy/cloud-registration`   | NEW shim                                      | unit entrypoint           |
| `infra/kitluy-store-hub-image/scripts/package-bootstrap-runtime.sh`      | 5 modules + 1 entrypoint added to the closure     | ship what the unit runs   |
| `docs/authority/kitluy-decision-…-register-v1.0.0.md`                    | NEW `KLREC-2026-08-19-DEVICE-IDENTITY-PER-SLOT-001` | recorded, not fixed     |
| `infra/IMAGE-CLEANUP-2026-08-19.txt`                                    | record of the deleted build trees                 | see §6                    |
| `services/kitluy-management-api/src/device-approval.ts`                 | NEW — pending read model + the approval call      | plan §4.1, §4.3           |
| `services/kitluy-management-api/src/http.ts`                            | 2 routes, approval dep, **CORS methods fix**      | plan §4.1                 |
| `services/kitluy-management-api/src/authorization.ts`                   | `FLEET_ENROLLMENT_APPROVE` permission key         | plan §4.1                 |
| `services/kitluy-management-api/src/composition.ts`                     | wires the approval pool                           | plan §4.1                 |
| `services/kitluy-management-api/openapi.yaml`                           | both routes + `PendingRegistration` schema        | contract-first            |
| `services/kitluy-management-api/test/device-approval-routes.test.ts`    | NEW — 17 tests                                    | authority, not shapes     |
| `apps/kitluy-admin-pwa-portal/src/management-client.ts`                 | approval call + `refused` outcome                 | plan §4.2                 |
| `apps/kitluy-admin-pwa-portal/src/views.tsx`                            | `PendingApprovalsView` + `ApprovalForm` + nav     | plan §4.3, §4.4           |
| `apps/kitluy-admin-pwa-portal/src/{App.tsx,routing.ts,access.ts,messages.ts}` | route, state, permission gate, bilingual text | plan §4.3            |
| `apps/kitluy-admin-pwa-portal/test/device-approval.test.tsx`            | NEW — 17 tests                                    | what the screen refuses   |

### Recorded deviation from the plan

Plan §3.1 says to update `http-enrollment-client.ts`. A **sibling module** was
created instead. The two speak different contracts to different services under
different authorities — factory enrolment answers a server-minted challenge at
`/v1/device-enrollment/*` and can produce `enrolled`; registration signs its own
content at `/functions/v1/device-registration` and cannot produce `enrolled`
under any input. Folding both into one module would put two authorities behind
one exported name and the file header could no longer state which contract it
implements. The reasoning is repeated in the new file's header.

A second, smaller one: the plan says to keep using the existing
`--enrollment-url` plumbing. A **separate** `--registration-url` was added
because Supabase does not serve `/v1/device-enrollment` and the fleet service
does not serve the registration route; overloading one variable would send
requests to a host that answers 404, which a device cannot tell apart from a
genuine refusal. `--enrollment-url` is untouched.

### Allowlist verification

`PASS`. One out-of-scope edit was made and then **reverted**:
`infra/kitluy-os-image/scripts/package-bootstrap-runtime.sh` (the TERMINAL image)
briefly gained the same modules. The task was Store-Hub-only, so it was restored
with `git checkout --`. Terminals therefore do not yet ship the registration
client; that is deliberate and listed in §12.

## 4. Implementation details

### Deployment

- `pnpm db:deploy:hosted-dev` — dry run first (96 files on disk, 95 applied,
  "would apply 1"), then the real run. Ledger after deploy: **96/96**.
- `supabase functions deploy device-registration --project-ref gjgbnkhuwlwhngbtrgts`
  (script size 52.62 kB).
- `KITLUY_REGISTRATION_DSN` set as a **function secret** via `supabase secrets
  set`. The function refuses to guess a DSN by design, so without this it would
  have answered 500 on every call. Pooler port **6543** (transaction mode) is
  safe here because the function creates its client with `prepare: false`.
- Every command's output was piped through a redaction filter; no connection
  string or key was printed at any point.

### The device client

Board evidence and installation evidence are **separated at the client**, which
is the identity model's central rule: `board_serial`, `soc_serial` and
`mac_address` travel as `signals`; `storageSerial` and `storageModel` travel as
`installationEvidence`. Plan §1.4 excludes storage from board resolution because
a card moved to another board must produce a NEW device — if storage ever
appeared as a board signal, a cloned card would start resolving to the board it
was copied from. A test asserts the absence, not just the presence.

Values are normalised (`lower(btrim(…))`) **before** signing, so the bytes signed
and the bytes stored are one form.

`PENDING_APPROVAL`, `KNOWN_DEVICE_INSTALLATION_REGISTERED` and
`TRUST_REVIEW_REQUIRED` are all treated as successful outcomes. Containment
reasons (`KLUY-DEVICE-CONTAINED-*`) are split from trust review into a separate
console phase, because waiting resolves one and never resolves the other.

### The canonical form now has three copies

Authoritative (`packages/device-identity`), Deno (the Edge Function), and now the
device (the agent ships with zero runtime dependencies and
`package-bootstrap-runtime.sh` refuses the build if that changes). The device
copy carries **no verification path** — a device signs and never verifies — and
`test/device-registration-bytes-drift.test.ts` compares its bytes to the
authoritative implementation.

### Image

`KITLUY_REGISTRATION_URL` and `KITLUY_HARDWARE_PROFILE_KEY` are new `image.env`
keys. The build **refuses** a `--registration-url` given without a
`--hardware-profile-key`: that pairing produces a device refused
`KLUY-REG-UNKNOWN-PROFILE` on every attempt, and the read-only rootfs means it
cannot be corrected on the card.

## 5. Validation performed

| Command/check                                                | Environment          | Result           |
| ------------------------------------------------------------ | -------------------- | ---------------- |
| `pnpm db:deploy:hosted-dev --dry-run`                        | cloud dev            | would apply 1    |
| `pnpm db:deploy:hosted-dev`                                  | cloud dev            | `PASS` 96/96     |
| `supabase functions deploy device-registration`              | cloud dev            | `PASS`           |
| `pnpm probe:device-registration` against the DEPLOYED route  | cloud dev            | `PASS` 12/12     |
| live client drive (register → replay → reflash)              | cloud dev            | `PASS` continuity |
| `vitest device-registration-bytes-drift`                     | node 22.23.0         | `PASS` 11/11     |
| `vitest http-registration-client`                            | node 22.23.0         | `PASS` 18/18     |
| `vitest cloud-registration-pass`                             | node 22.23.0         | `PASS` 9/9       |
| `vitest run` (whole agent package)                           | node + local PG      | 256 pass, **3 fail** — see §7 |
| `build-gates.test.sh`                                        | local                | `PASS` 32/32     |
| `systemd-runtime.test.sh`                                    | local                | `PASS` 103/103   |
| `package-bootstrap-runtime.sh`                               | local                | `PASS` 21 modules |
| `eslint` on all new/changed source                           | local                | `PASS` (clean)   |
| `prettier --write` on all new/changed files                  | local                | applied          |
| `pnpm secret:scan`                                           | local                | `PASS` (1845 files) |
| `doctor.sh` (Store Hub)                                      | local                | `PASS` 12/12     |
| Store Hub image build                                        | local cross-build    | `PASS` exit 0    |
| `scan-image-secrets.sh` on the BUILT rootfs                  | local                | `PASS` 17/17     |
| `listPendingRegistrations` against the LIVE cloud            | cloud dev            | `PASS` 2 rows, full evidence |
| approval refusal matrix against the LIVE cloud               | cloud dev            | `PASS` 5/5       |
| `vitest` @kitluy-services/kitluy-management-api              | node 22.23.0         | `PASS` 129/129   |
| `vitest` @kitluy-apps/kitluy-admin-pwa-portal                | node 22.23.0         | 75 pass, 1 pre-existing fail |
| `pnpm contracts:validate`                                    | local                | `PASS` 4/4 specs |
| 2026-08-11 plan bench verification (4 checks)                | built artifact       | `PASS` 4/4       |

### Live continuity evidence

```text
1. first registration : pending  deviceId=9e43a581…  installationCreated=true
2. replay (idempotent): pending  deviceId=9e43a581…  installationCreated=false
3. reflash, new key   : pending  deviceId=9e43a581…  NEW installationId
   CONTINUITY: same deviceId=true  new installationId=true   PASS
```

That is plan §8.4 Test A — "the core requirement" — against the real cloud rather
than a local stack.

## 6. Image build

Before rebuilding, **all existing OS images were deleted at owner request**: four
Store Hub work trees and seven terminal work trees, ~80 GB, taking free disk from
57 GB to 137 GB. The pinned `upstream/` checkouts were preserved in both trees.
An inventory was written to `infra/IMAGE-CLEANUP-2026-08-19.txt` before deletion.
102 files owned by container subuids needed `podman unshare` to remove; removing
them also cleared the `EACCES` that has been failing `prettier --check .` in
`pnpm verify`.

The rebuild finished with exit 0. Artifacts:

```text
17490268160  image-kitluy-storehub-os-arm64/kitluy-storehub-os-arm64.img
  648367119  deploy-v2.7.0/kitluy-storehub-os-arm64.img.zst
  979655645  deploy-v2.7.0/kitluy-storehub-os-arm64-v2.7.0.tar.zst
manifest:    build/work/kitluy-store-hub-dev-manifest.json
class:       DEVELOPMENT / UNSIGNED / NOT RELEASE-ELIGIBLE / NOT BOOT-TESTED
```

`/etc/kitluy/image.env` **read back out of the built filesystem**, not inferred
from the build log:

```text
KITLUY_DEVICE_CLASS=store_hub
KITLUY_REGISTRATION_URL=https://gjgbnkhuwlwhngbtrgts.supabase.co/functions/v1/device-registration
KITLUY_HARDWARE_PROFILE_KEY=CLOUD-HUB-PI5
KITLUY_ENROLLMENT_BASE_URL=          <- deliberately empty; the fleet path is being retired (plan §5.3)
```

`kitluy-cloud-registration.service` is symlinked into `multi-user.target.wants`,
the `/usr/lib/kitluy/cloud-registration` shim is present and executable, and all
five new modules are in the packaged closure.

### The 2026-08-11 plan's own bench verification, re-run on this artifact

| Check                                | Result                                       |
| ------------------------------------ | -------------------------------------------- |
| ESM marker `{"type":"module"}`       | `PASS` — the regression `209afc2` fixed       |
| `kitluy-ssh-hostkeys.service` enabled | `PASS`                                       |
| `slot-shared.d` conf for `/etc/ssh`  | `PASS` — `Path=/etc/ssh`                     |
| `authorized_keys` non-empty          | `PASS` — key present on `persistent.ext4`    |

The last one is worth stating precisely because it is easy to get wrong: `/home`
in the chroot is **empty by design** (it is moved into `persistent.ext4` during
assembly), so the correct check is
`debugfs -R "cat /home/pi/.ssh/authorized_keys" persistent.ext4`, exactly as the
build script's own comment instructs. Checking the chroot would have reported a
missing key on a perfectly good image.

## 7. Not run / not verified

- **NO HARDWARE HAS BOOTED THIS IMAGE.** Everything above is bench evidence. The
  encrypted-NVMe provisioning, the tty1 console, the tty2 maintenance login and
  the whole firstboot chain remain unproven on a real Pi — as they were before.
- **3 pre-existing test failures**, all in
  `test/trusted-time-activation.db.test.ts` (`expected 'restricted_forward_jump'
  to be 'trusted'`). That suite imports only `factory-gateway.js` and
  `factory.js`, neither of which this work touches; the sole edit to existing
  code is `hub-pairing-ui.ts`. Not investigated further — out of scope.
- **`pnpm verify` was not run end to end** this session. Component steps were run
  individually and are listed in §5.

- **The `format:check` blocker is NOT fixable by `.prettierignore`, and this
  session proved it.** Deleting the old build trees cleared the `EACCES` that has
  been failing `prettier --check .`; the new build re-created it at
  `build/work/chroot-v2.7.0/filesystem/persistent/home/pi` (mode `0700`, owned by
  container subuid). So it returns with **every** image build. `.prettierignore`
  already lists `build` on line 3 and the failure happens anyway, because
  prettier fails while EXPANDING the directory tree, before ignore rules are
  applied:

  ```text
  [error] Unable to expand directory: ".".
  [error] EACCES: permission denied, scandir '…/filesystem/persistent/home/pi'
  All matched files use Prettier code style!
  ```

  Note the third line: **no source file is unformatted**. The step fails purely on
  traversal. The fix is therefore to stop `format:check` from scanning `.` — give
  it explicit source paths, or have the image build leave no unreadable
  directories. Both touch shared tooling, so neither was done here. Recorded, out
  of scope.
- **The registration probe and the live client drive wrote real rows** into the
  hosted development fleet: several pending devices under `CLOUD-HUB-PI5`. They
  are pending, unapprovable without a HET decision, and grant nothing — but they
  are noise in the dev fleet and someone may want them cleaned up.
- **The approval surface is BENCH-VERIFIED, not operator-verified.** The route
  and its refusals are proven against the live cloud through the service layer,
  and the screen is proven by server-rendered assertions. Nobody has yet signed
  into the Portal as a real Admin and approved a device through a browser — which
  also means the CORS fix below is reasoned, not observed.
- **`fleet-service.mjs` open enrollment is untouched** — the old bypass that
  produces `enrolled` directly still exists beside the new gate (plan §5.3).
- **Terminals cannot register** — reverted for scope, see §3.
- **BLK-005 unchanged.** Approval still issues no certificate, so an approved Hub
  still cannot serve a terminal.

## 8. Risks and known limitations

| Severity | Risk                                                    | Impact                                                        |
| -------- | ------------------------------------------------------- | ------------------------------------------------------------- |
| **HIGH** | Device identity lives on a PER-SLOT path                | an A/B update orphans the key — `KLREC-2026-08-19-DEVICE-IDENTITY-PER-SLOT-001` |
| **HIGH** | Approval enters `service_role` for the governed call     | broader than the narrow-role pattern used elsewhere — see §11 |
| MEDIUM   | The route is unauthenticated and unrated                | anyone who reaches it can create pending rows (fleet noise)   |
| MEDIUM   | Hardware evidence is self-reported                      | inherent; approval is the control                             |
| MEDIUM   | The old `enrolled`-producing dev path still exists      | the new gate is optional until it is retired                  |
| LOW      | The canonical form now has THREE copies                 | drift breaks registration silently; two drift suites guard it |

## 9. Blockers and open decisions

- `BLK-005` — PKI/certificates. Bounds provisioning and terminal↔Hub traffic.
- **Open decision (new):** which device state is DEVICE-lifetime and which is
  INSTALLATION-lifetime — see `KLREC-2026-08-19-DEVICE-IDENTITY-PER-SLOT-001`.
- **Open decision (carried):** is `TRUST_REVIEW_REQUIRED` on MAC-only evidence
  acceptable operationally?

## 10. Rollback / recovery

Nothing is committed. Code rollback is `git checkout` of the listed files plus
deleting the new ones.

The **cloud is not rolled back by that**. `0197` is applied to
`kitluy-project-pos` and the Edge Function is deployed. Reversing either needs a
deliberate decision: `0197` is additive (one nullable column, one new table, one
new enum value, functions, a role and grants) and inert if unused; the function
can be deleted from the dashboard or by CLI. The `KITLUY_REGISTRATION_DSN` secret
would also need removing.

## 11. Review focus

- **`approveDeviceEnrollment` enters `service_role`.** Migration 0197 grants the
  approval door to `service_role` and to nothing else, so this is the authorized
  path rather than a chosen one — but `service_role` carries `BYPASSRLS`, and the
  rest of this service reaches governed doors through narrow roles
  (`kitluy_hub_issuance_service`). A dedicated `kitluy_device_approval_service`
  holding exactly this one EXECUTE would be better and needs a migration. The
  role is entered with `set local` inside the transaction, so it cannot leak to
  the next request on a pooled connection.
- **A pre-existing CORS defect was fixed in passing.** `resolveCorsHeaders`
  advertised `GET, OPTIONS` while the surface already had a POST route
  (`/hub-pairing-codes`), so a browser preflight for it was answered with a method
  list that excluded it and the browser refused the request — the route worked for
  `curl` and could never work from the Portal it exists for. Now `GET, POST,
  OPTIONS`. No test asserted the old value; one should.
- **`/devices-pending` requires the APPROVE permission, not `fleet.read`.** The
  evidence it carries is what an attacker would need to forge a convincing
  registration. Confirm that is the intended audience.
- The board/installation evidence split in `http-registration-client.ts`. If
  storage ever reaches `signals`, a cloned card resolves to the board it was
  copied from.
- `verify_jwt = false` in `supabase/config.toml`. It is what the contract
  requires and why is argued in the file, but it is an unauthenticated public
  route and deserves a second opinion.
- Whether the registration agent should keep polling after `APPROVED`. It does
  today, once a minute, for ever.
- The per-slot finding in §8 — the candidate fix is deliberately unapplied.

## 12. Next step

1. **Boot a real Pi.** Nothing above is hardware evidence.
2. Management API approval route + Admin "Verify & Approve" view (plan §4) —
   without it, approval is SQL.
3. Retire the `enrolled`-producing development path (plan §5.3).
4. Give the terminal image the same registration client.
5. Decide the per-slot persistence question and fix the identity path.
6. Close plan step 4 of the 2026-08-11 image plan (four missing test assertions:
   `authorized_keys` non-empty, host keys writable, hostkey unit ordering, ESM
   marker) — verified absent from all six test files in both trees.

## 13. Truth statement

- Production modified: `NO`.
- Hosted development project modified: **`YES`** — `kitluy-project-pos` is at
  96/96 and carries a deployed Edge Function and one function secret. Authorized
  by the owner in-session; deployed only via the allowlisted path.
- Secrets in code, docs, logs or this handoff: `NO`. `pnpm secret:scan` passed;
  all command output was redaction-filtered.
- Committed or pushed: `NO`.
- Capability claimed `IMPLEMENTED`: the **cloud intake** is `DEPLOYED-IN-DEV` and
  the **device-side registration client** is `IMPLEMENTED-IN-DEV`, with the
  evidence in §5. Everything in §7 remains unbuilt or unverified and is not
  claimed. **No hardware has run any of it.**
