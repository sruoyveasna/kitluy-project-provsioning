# KitLuy Store Hub — first physical activation runbook v1.0.0

**Status: PREPARED, NOT EXECUTED.** No Raspberry Pi has run this procedure.

**Authority:** owner instruction 2026-08-29; `00_AI_HANDOFF/KITLUY_STOREHUB_DEV_HANDOFF.md`;
the four independent credential-path reviews (2026-08-26 → 2026-08-28).

---

## 0. STOP CONDITION — read this before flashing anything

The firstboot operational TLS client requires the governed credential stack that
exists locally through migration **0212**. Hosted development is believed to be
at **0197**.

> **Until hosted development has been upgraded and independently verified, this
> Pi CANNOT reach ACTIVE, and no amount of reflashing will change that.** The
> device will register, wait for approval, pair, establish trusted time, and then
> stop at the certificate stage with a governed refusal — which is correct
> behaviour, not a fault.

Steps **A–D** are safe to run today and produce useful evidence.
Steps **E onward require the hosted upgrade first.**

---

## 1. Target

| Fact                              | Value                                                    |
| --------------------------------- | -------------------------------------------------------- |
| Board asset tag                   | `KL-6CBB3BC0D49B`                                        |
| Last known hosted lifecycle state | `awaiting_trust` — **re-verify; this is stale**          |
| Image                             | the artifact named in §4 of the final report             |
| Environment                       | `development` only (BLK-005 blocks pilot and production) |

**Do not assume the lifecycle state above is current.** Re-read it from hosted
development after the upgrade, before touching the hardware.

---

## A. Preserve evidence from the existing card

Only if the current card holds a device identity worth keeping.

```bash
# Read-only image of the existing card, kept OUTSIDE the repository.
sudo dd if=/dev/sdX of="$HOME/kitluy-evidence/KL-6CBB3BC0D49B-$(date +%Y%m%d).img" bs=4M status=progress
sha256sum "$HOME/kitluy-evidence/KL-6CBB3BC0D49B-$(date +%Y%m%d).img"
```

The identity directory (`/var/lib/kitluy/identity`) holds a PRIVATE key. Keep
the copy off the repository, off the cloud folder, and off any shared drive.

---

## A2. CONFIRM THE IMAGE CARRIES THE DEVELOPMENT ROOT PIN

Before flashing, confirm the artifact was built with `$KITLUY_DEV_PKI_DIR` set.
The build log must contain:

```text
development root pinned into the image: <first 16 hex>...
```

A build that instead warned `no $KITLUY_DEV_PKI_DIR` produced a **PINLESS**
image. Such an image is SAFE — the Hub logs `blocked: no development root pin`
and refuses to adopt anything rather than adopting unverified — but it **cannot
complete this runbook**. Rebuild with the environment set.

The pin must also be the SAME development CA that hosted development pins as its
trust anchors. If they differ, every certificate is issued successfully and then
REFUSED by the device on verification check 6, which is a confusing failure to
diagnose from the device side.

---

## B. Flash the new image

```bash
# Verify the artifact BEFORE writing it. A mis-flashed card is a lost afternoon.
sha256sum <artifact>          # must equal the value recorded in §4
sudo dd if=<artifact> of=/dev/sdX bs=4M conv=fsync status=progress
sync
```

Confirm `/dev/sdX` with `lsblk` immediately beforehand. Writing to the wrong
device destroys the host.

---

## C. First clean boot

Connect a monitor and keyboard, or SSH using the recovery key baked into this
development image. Both are available deliberately: a Pi whose bootstrap fails
must be inspectable rather than only reflashable.

---

## D. Verify the image did its job — no cloud required

| Check                             | Command                                   | Expected                                     |
| --------------------------------- | ----------------------------------------- | -------------------------------------------- |
| machine-id generated on device    | `cat /etc/machine-id`                     | 32 hex, and **different** from any other Hub |
| SSH host keys generated on device | `ls -l /etc/ssh/ssh_host_*`               | present, generated at first boot             |
| Network                           | `ip addr` / `ping -c1 1.1.1.1`            | a link, wired preferred                      |
| Timezone                          | `timedatectl`                             | `Asia/Phnom_Penh`                            |
| Firstboot ran                     | `systemctl status kitluy-firstboot`       | active (exited), success                     |
| Operational credential directory  | `ls -la /var/lib/kitluy/operational`      | exists, `0700`, **EMPTY**                    |
| No credential yet                 | `systemctl status kitluy-operational-tls` | running, logging `waiting: not paired yet`   |

**An empty `/var/lib/kitluy/operational` on a fresh card is the correct result.**
A key or certificate here on first boot would mean the golden image carried a
device identity, which would give every Hub flashed from it the same identity.

---

## E. Registration continuity _(needs hosted upgrade)_

The same physical board must resolve to the SAME device identity. Board
resolution uses MAC, board serial and SoC serial — **not** storage — precisely so
a reflashed card stays the same board.

```bash
journalctl -u kitluy-cloud-registration -n 50 --no-pager
```

Expected: `KNOWN_DEVICE_INSTALLATION_REGISTERED` for `KL-6CBB3BC0D49B`, with a
NEW installation generation and the SAME device record.

> If it reports `TRUST_REVIEW_REQUIRED`, **stop**. That is the fail-closed
> ambiguous-board-evidence path. It means the board evidence is ambiguous
> against the fleet and a human at HET must look — it is not something to retry
> past.

---

## F. HET approval _(needs hosted upgrade)_

If the device is `pending_approval`, an authorised HET operator approves it
through the admin surface. A generic image reaching "awaiting approval" and
stopping is the DESIGNED resting state.

---

## G. Store pairing _(needs hosted upgrade)_

Target Store, **only if these remain authoritative in hosted development —
re-verify before use**:

| Field          | Value              |
| -------------- | ------------------ |
| Digital Store  | `DEMO-LAUNDRY-001` |
| Store Location | `DEMO-PP-01`       |

An operator opens a pairing session and reads the code to the installer, who
types it on the Hub console. The installer chooses nothing else: the session
already carries tenant, Digital Store and Store Location.

---

## H. Trusted time _(needs hosted upgrade)_

Established by the control plane, never by the device. A Pi 5 has no
battery-backed RTC, so the only source is the governed
`cloud_authoritative` path.

Expected: `device_trusted_time.status = 'trusted'`.

---

## I. Operational TLS _(needs hosted upgrade — THE NEW MILESTONE)_

```bash
journalctl -u kitluy-operational-tls -f
```

Expected sequence:

1. an RSA-2048 key is generated **on the Pi**;
2. `/var/lib/kitluy/operational/operational-tls.key.pem` appears, mode `0600`;
3. `issuance-request.json` appears **before** any network call;
4. `kitluy.csr.v1` is signed locally;
5. the certificate returns;
6. all seventeen local checks pass;
7. certificate and chain are written, then the manifest **last**;
8. the log reads `ADOPTED: credential <id> generation 1 serial DEV-…`.

Verify on the device:

```bash
ls -la /var/lib/kitluy/operational          # key 0600, dir 0700
openssl x509 -in /var/lib/kitluy/operational/operational-tls.crt.pem -noout -subject -serial -dates -ext subjectAltName
```

The SAN must name **this** device, generation 1, and
`kitluy-environment://development`.

> **The private key must never leave the Pi.** Do not copy it, do not paste it,
> do not attach it to an evidence record. Record its FINGERPRINT only.

---

## J. Activation _(needs hosted upgrade)_

`awaiting_trust` → `active`, through the governed activation authority. Nothing
else can perform this transition: group 0207 refuses any move into `active` that
is not made by `kitluy_activation_governor`.

---

## K. Verify hosted authority _(needs hosted upgrade)_

Read-only, against hosted development:

| Check                                          | Expected                                      |
| ---------------------------------------------- | --------------------------------------------- |
| governed credentials for this device           | exactly **1**                                 |
| live generation keys (not abandoned/destroyed) | exactly **1**                                 |
| active operational certificates                | exactly **1**, with `certificate_pem` present |
| Store assignment                               | the intended Digital Store and Store Location |
| trusted-time evidence                          | `trusted`, source `cloud_authoritative`       |
| lifecycle                                      | `active`                                      |

More than one credential or generation key means a replay consumed a second
identity, and the run has failed even if the Hub looks healthy.

---

## L. Reboot with WAN available

```bash
sudo reboot
```

Expected: the Hub returns `active`, reuses the same key and certificate, and
`kitluy-operational-tls` logs `already adopted` and exits.

---

## M. WAN-OFFLINE REBOOT — the property that matters in a shop

```bash
# Physically unplug the WAN (or disable the uplink on the switch).
sudo reboot
```

Expected, with **no cloud reachable**:

- the Hub boots;
- the operational identity loads from disk;
- `journalctl -u kitluy-operational-tls` shows `already adopted` and **no network
  call at all**;
- no second generation is created;
- no certificate request is issued.

Confirm from the cloud side afterwards that nothing changed:

| Check                                           | Expected        |
| ----------------------------------------------- | --------------- |
| credentials for this device                     | still exactly 1 |
| generation keys                                 | still exactly 1 |
| new issuance requests during the offline window | **none**        |

> **Do not test LAN mTLS.** It is blocked by two owner decisions and by findings
> N-1 and N-2.

---

## Failure handling

| Symptom                            | Meaning                                    | Action                                                                          |
| ---------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------- |
| `waiting: not paired yet`          | designed resting state                     | pair the Hub                                                                    |
| `blocked: no development root pin` | image built without `$KITLUY_DEV_PKI_DIR`  | rebuild the image                                                               |
| `REFUSED TO ADOPT: <check>`        | the certificate failed a local check       | **do not retry blindly** — capture the log and investigate; nothing was written |
| `KLUY-KEY-NO-ASSIGNMENT`           | asked before pairing                       | pair first                                                                      |
| `KLUY-KEY-GENERATION-TAKEN`        | generation 1 already holds a different key | governed recovery: `abandon_generation_key_v1`, then retry                      |
| `TRUST_REVIEW_REQUIRED`            | ambiguous board evidence                   | stop; HET must review                                                           |

Never resolve a refusal by deleting `/var/lib/kitluy/operational` and starting
again. That spends a second generation and can leave the board permanently
unissuable. The governed recovery path exists for exactly this.
