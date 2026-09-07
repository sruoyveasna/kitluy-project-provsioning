# KitLuy Pi Terminal Provisioning and Device PIN — Owner Goal & Decision v2.0.0

**Filename:** `kitluy-terminal-transport-and-pairing-completion-owner-decision-v2.0.0.md`
**Decision ID:** KLD-2026-09-03-TERMINAL-PROVISIONING-001
**Date:** 2026-09-03
**Owner:** HET / KitLuy Suite Project Owner
**Status:** OWNER-LOCKED
**Supersedes:** `kitluy-terminal-transport-and-pairing-completion-owner-decision-v1.0.0.md`
**Purpose:** Define the owner-approved end-user goal for Digital Store creation, Store Hub assignment, Raspberry Pi Terminal provisioning, graphical first-boot experience, automatic application installation, and the device-level 4-digit Terminal PIN.

> This document is a product and architecture goal. It does not by itself prove that any capability is implemented, tested, deployed, pilot-proven, or production-ready.

> Repository note (recorded, not part of the owner text): the owner supplied this document in a session on 2026-09-03. Its arrows, check marks and box-drawing glyphs arrived as transfer-encoding damage and were restored here from context, following the precedent of KLREC-2026-08-11-EDGE-003. No wording, ordering, numbering or technical content was altered. Companion clarification of the same date: `kitluy-factory-enrollment-lifecycle-owner-decision-v1.0.0.md`.

---

## 1. Locked Product Goal

KitLuy physical Store setup must behave like setting up a modern consumer device:

```text
Admin creates the Digital Store
        ↓
Store Hub is approved and assigned
        ↓
Partner selects terminal assignments
        ↓
Partner opens a pairing session
        ↓
Pi Terminal boots into a graphical setup screen
        ↓
User enters the pairing code
        ↓
KitLuy automatically determines:
- Digital Store
- Location
- Store Hub
- physical terminal identity
- assigned terminal profile(s)
- Store business vertical
- required KitLuy application
        ↓
Terminal securely connects to its Store Hub
        ↓
Required signed application is installed
        ↓
User creates and confirms a 4-digit Terminal PIN
        ↓
Terminal becomes ACTIVE and operational
```

Normal installation must not require Linux knowledge, shell access, manual database configuration, manual role selection, manual Hub IP trust, or manually choosing which business application to install.

## 2. Digital Store Creation Authority — LOCKED

The **Admin Platform / Admin Portal creates the Digital Store**.

The Partner does not create a new Digital Store.

Admin is responsible for the privileged creation/activation layer, including the authoritative association of the Digital Store to the appropriate Partner/Tenant and the Store's business vertical.

```text
ADMIN PORTAL
    ↓
Create Digital Store
    ↓
Assign Partner/Tenant
    ↓
Set Store business vertical
    ↓
Create/approve applicable Location context
    ↓
Store becomes available to Partner
```

After the Store exists, the Partner manages the permitted Store configuration and Store technology workflows through Partner Portal.

This owner decision overrides older wording that implied that a Partner creates the Digital Store.

## 3. Store Hub Comes Before Pi Terminal Provisioning — LOCKED

A Store's Pi Terminals must be provisioned against an already-approved and operational Store Hub.

Canonical sequence:

```text
1. Admin creates the Digital Store.
2. Store Hub boots from the generic Store Hub image.
3. Store Hub registers with KitLuy.
4. Admin approves the Store Hub hardware/trust relationship.
5. Store Hub is paired/assigned to the Digital Store and Location.
6. Store Hub obtains its operational identity and becomes ACTIVE.
7. Store Hub local database and LAN service become ready.
8. Partner may then provision Pi Terminals for that Store.
```

An `ACTIVE` device identity alone is not enough to treat the Store Hub as operational. Terminal provisioning should require the Hub services needed for provisioning to be available.

The Store Hub remains the Store's local operational authority after provisioning.

## 4. Generic Pi Terminal Image — LOCKED

KitLuy uses **one generic Raspberry Pi Terminal OS image**, not separate images for every Store, terminal role, or business vertical.

Do not create separate images such as:

```text
t1.img
t2.img
t3.img
t4.img
laundry-terminal.img
cafe-terminal.img
grocery-terminal.img
```

The generic Pi Terminal image must carry the common device platform required before pairing, including the approved equivalents of:

- Linux ARM64 base;
- graphical KitLuy device shell / first-boot setup;
- network setup;
- unique device identity generation and protection;
- registration/provisioning client;
- LAN discovery client;
- Store Hub trust/TLS client;
- local credential/configuration storage;
- signed application installer;
- application launcher;
- health/diagnostics;
- update/recovery runtime.

The golden image must not contain Store-specific assignment truth, reusable private credentials, a fixed Hub IP, or a preselected terminal role.

## 5. Pi Terminal First Boot Is Graphical — LOCKED

Normal Pi Terminal first boot must enter a **KitLuy graphical setup experience**.

It must not expose a Linux CLI as the normal installation experience.

```text
┌──────────────────────────────────────┐
│               KITLUY                 │
│                                      │
│        Set Up This Terminal          │
│                                      │
│  Network                             │
│  ● Ethernet Connected                │
│                                      │
│  Enter Pairing Code                  │
│                                      │
│       [ _ _ _ _ _ _ _ _ ]            │
│                                      │
│         [ Pair Terminal ]            │
│                                      │
│  Device: KL-TM-XXXXXXXX              │
└──────────────────────────────────────┘
```

A recovery/service console may exist for authorized support, but it is not the normal Store installer experience.

## 6. Partner Portal Terminal Provisioning — LOCKED

The Partner provisions a physical Pi Terminal from the Digital Store's **Provisioning → Terminals** workflow.

The Partner:

1. opens the Digital Store;
2. opens `Provisioning`;
3. opens `Terminals`;
4. selects the logical terminal/profile assignment(s) that this physical Pi will operate;
5. optionally gives the physical terminal a friendly name;
6. opens a pairing session;
7. receives a one-time, short-lived pairing code and/or QR code.

```text
PARTNER PORTAL
    ↓
Digital Store
    ↓
Provisioning
    ↓
Terminals
    ↓
Select:
Front Counter 01
T1 + T2
    ↓
OPEN PAIRING SESSION
    ↓
Pairing Code
482913
```

The installer does not select the terminal role directly on the Pi.

The pairing session is authoritative for the intended assignment.

## 7. Pairing Session Determines What the Pi Becomes — LOCKED

After the pairing code is entered, the Pi Terminal must automatically learn the authoritative context attached to that pairing session.

At minimum:

- Partner/Tenant;
- Digital Store;
- Store Location;
- assigned Store Hub identity;
- physical terminal assignment;
- terminal profile(s), such as T1/T2/T3/T4 where applicable;
- Store business vertical;
- required KitLuy application family;
- approved release/update channel;
- configuration/version information needed to finish activation.

```text
PAIRING SESSION
    ↓
Store        = HET Laundry BKK1
Location     = BKK1
Store Hub    = KL-HUB-ABC123
Terminal     = Front Counter 01
Profiles     = T1 + T2
Vertical     = Laundry
Application  = KitLuy Laundry POS
```

The Pi must not ask the installer to decide which Store, Hub, terminal role, business vertical, or KitLuy business application applies. Those values come from governed KitLuy assignment truth.

## 8. Store Hub Discovery and Trust — LOCKED

The assigned Hub identity is authoritative. Its IP address is only a reachability detail.

```text
Terminal receives assigned Hub identity
        ↓
Find Hub on Store LAN
        ↓
Verify Hub cryptographic identity
        ↓
Verify Tenant / Store / Location relationship
        ↓
Verify terminal assignment
        ↓
Establish secure LAN connection
```

A device found at an IP address is not trusted merely because it responds.

No terminal may receive direct PostgreSQL credentials.

Normal Store operations go through governed Store Hub APIs/services.

## 9. Automatic Application Selection and Installation — LOCKED

The Pi Terminal OS is generic.

The **business application is selected automatically from the Digital Store's business vertical and the terminal assignment**.

```text
Generic KitLuy Terminal OS
        ↓
Laundry Store + T1/T2
        ↓
KitLuy Laundry POS application
```

Future verticals use the same generic OS but receive their own governed application family.

Where practical, the Store Hub should cache/distribute approved signed terminal application releases over LAN so normal terminal installation and later recovery are not unnecessarily dependent on downloading large application packages directly from the internet.

The Terminal must verify application/release authenticity before installation.

The provisioning system must never silently install an application belonging to a different Store vertical.

## 10. Terminal PIN Setup After Successful Provisioning — LOCKED

After pairing, Store/Hub assignment, secure connection, and required application installation succeed, the user must create a **4-digit Terminal PIN**.

The setup is a two-entry confirmation flow similar to modern smartphone setup:

```text
CREATE TERMINAL PIN
Enter 4 digits
        ↓
CONFIRM TERMINAL PIN
Enter the same 4 digits again
        ↓
Match?
  YES → PIN established
  NO  → ask again
```

The Terminal must not become fully operational until this required PIN setup succeeds, unless an explicit future owner-approved exception applies to a specific terminal class.

## 11. Terminal PIN Purpose — LOCKED

The Terminal PIN is **physical terminal access control**.

It answers:

> May this person unlock and enter this physical KitLuy Terminal?

It is not a substitute for staff identity.

```text
TERMINAL PIN
"May this physical terminal be unlocked?"

                ≠

STAFF AUTHENTICATION
"Which employee is performing the business action?"
```

A normal operational flow may therefore be:

```text
Pi boots / Terminal locks
        ↓
Enter Terminal PIN
        ↓
Device unlocked
        ↓
Assigned KitLuy application
        ↓
Staff login / staff authentication
        ↓
Authorized Store operation
```

Financial, custody, refund, override, and other sensitive business actions must still be attributable to the authorized human actor according to KitLuy's normal RBAC/audit rules.

## 12. Terminal PIN Storage and Authority — LOCKED

The raw 4-digit Terminal PIN must never be stored.

It must not be stored in:

- the generic Pi Terminal OS image;
- plaintext configuration;
- environment variables;
- source code;
- logs;
- cloud logs;
- browser storage as plaintext;
- a directly readable database field.

The **Store Hub is the authoritative offline verifier for the Terminal PIN** for a provisioned Store Terminal.

The Hub stores only a strong salted PIN/password verifier using the approved password-hashing mechanism (for example Argon2id or its approved successor), along with the minimum security state required for verification.

```text
User PIN
  4826
    ↓
strong salted password/PIN KDF
    ↓
non-reversible verifier
    ↓
Store Hub local authority
```

The raw `4826` is never persisted.

Cloud may hold approved non-secret management/projection state when required, but normal PIN verification must not depend on WAN connectivity.

```text
Internet unavailable
        ↓
Pi Terminal → Store Hub over LAN
        ↓
Terminal PIN can still be verified
        ↓
Approved Store operation can continue
```

## 13. PIN Brute-Force Protection — LOCKED

A 4-digit PIN has only 10,000 possible combinations, so the Hub must enforce attempt controls.

Minimum behavioral goal:

- failed attempts are counted on the authoritative Hub side;
- repeated failures introduce increasing delay/backoff;
- excessive failures can lock the Terminal;
- rebooting or restarting the GUI must not reset the authoritative attempt state;
- the client GUI must not be able to bypass Hub enforcement;
- failures must not reveal the correct PIN;
- security-relevant lock/reset events are auditable.

Exact thresholds and timing values may be governed by an approved security contract, but protection against unrestricted `0000 → 9999` guessing is mandatory.

## 14. Forgotten PIN and Reset — LOCKED

The Partner must never be able to view the existing Terminal PIN.

Partner Portal may show:

```text
Front Counter 01
Terminal PIN: Configured ✓

[ Reset Terminal PIN ]
```

It must never reveal the actual PIN.

An authorized reset invalidates the existing verifier and moves the Terminal into a `PIN setup/reset required` posture.

The Terminal then requires the user to create and confirm a new 4-digit PIN.

Reset is a sensitive governed action and must require appropriate authorization and audit evidence.

## 15. Normal Terminal Boot After Provisioning — LOCKED

After the Terminal has been fully provisioned, normal startup should conceptually be:

```text
Power on
    ↓
KitLuy graphical device shell
    ↓
Load provisioned device identity
    ↓
Find and verify assigned Store Hub
    ↓
Confirm assignment/configuration
    ↓
Show Terminal PIN screen
    ↓
Hub verifies PIN
    ↓
Unlock Terminal
    ↓
Launch assigned KitLuy application
```

The exact degraded/offline UX when the Hub itself is unavailable remains a separate recovery/security contract and must fail safely.

## 16. Admin Portal Responsibilities — LOCKED

Admin Portal / HET control plane owns the privileged platform/device layer, including the approved equivalents of:

- Digital Store creation;
- Partner/Tenant association;
- Store vertical authority;
- hardware inventory;
- hardware approval/trust;
- device certificates and revocation;
- provisioning eligibility;
- release/channel governance;
- fleet/security posture;
- replacement/decommission;
- security incident/support controls.

Partner users must not gain these HET-level capabilities merely because they can provision a terminal.

## 17. Partner Portal Responsibilities — LOCKED

Partner Portal owns the merchant-facing Store technology workflow after the Digital Store exists, including the approved equivalents of:

- selecting the Digital Store/Location;
- Store Hub assignment/readiness visibility;
- `Provisioning → Terminals`;
- selecting logical terminal assignment/profile(s);
- naming the physical terminal;
- opening a pairing session;
- displaying the one-time pairing code/QR;
- viewing terminal readiness/health;
- viewing application/version status;
- guided peripheral validation;
- requesting terminal PIN reset;
- requesting device replacement/support where authorized.

The Partner Portal does not reveal device private keys, raw PINs, database credentials, or HET root-security controls.

## 18. Example Phase 1 Laundry Installation — LOCKED TARGET

```text
ADMIN
creates Laundry Digital Store
        ↓
assigns Partner + Location
        ↓

STORE HUB
boots
registers
gets HET approval
pairs to Store/Location
becomes ACTIVE + SERVING
        ↓

PARTNER PORTAL
Provisioning → Terminals
        ↓
select Front Counter 01
T1 + T2
        ↓
Open Pairing Session
        ↓
generate one-time CODE
        ↓

NEW PI TERMINAL
boots graphical setup
        ↓
user enters CODE
        ↓
Terminal learns:
Store
Location
Hub
T1 + T2
Laundry vertical
Laundry application
        ↓
securely verifies/connects to Hub
        ↓
installs approved Laundry application
        ↓
user creates 4-digit Terminal PIN
        ↓
user confirms PIN
        ↓
Terminal ACTIVE
        ↓
PIN unlock screen
        ↓
KitLuy Laundry POS launches
```

A second physical Terminal can follow the same generic-image process with a different Partner-created assignment, for example T3 + T4.

## 19. Offline Principle — LOCKED

After successful provisioning, normal Pi Terminal operation uses the Store Hub over LAN regardless of WAN state.

```text
WAN ONLINE

Pi Terminal
    ↓ LAN
Store Hub
    ↓ sync
KitLuy Cloud
```

```text
WAN OFFLINE

Pi Terminal
    ↓ LAN
Store Hub
    ↓
Local Store operation continues
```

WAN loss must not force the Terminal to switch its normal operational backend from Hub to cloud.

Terminal PIN verification must also remain available while WAN is unavailable, provided the Store Hub itself is reachable and allowed to operate.

## 20. Security Boundaries — LOCKED

Provisioning and Terminal PIN implementation must preserve these boundaries:

1. Pairing code is authorization for a pairing attempt, not permanent device identity.
2. Device identity and cryptographic trust remain separate from the human-readable pairing code.
3. No fixed Hub IP establishes trust.
4. Terminal never receives direct PostgreSQL credentials.
5. Raw Terminal PIN is never stored or logged.
6. Terminal PIN verifier must use a strong salted one-way password/PIN KDF.
7. Hub-side throttling/lockout is mandatory.
8. App packages/releases must be authenticated before installation.
9. Development shortcuts must not silently become Pilot/Stable/production behavior.
10. Sensitive resets/replacements must be authorized and auditable.
11. Terminal PIN does not replace staff authentication or business RBAC.
12. Final offline certificate-revocation behavior remains subject to its dedicated security decision and must not be silently invented by this document.

## 21. Success Definition

The provisioning goal is proven only when a real physical scenario succeeds:

```text
Admin-created Digital Store
        ↓
real active Store Hub
        ↓
Partner opens terminal pairing session
        ↓
fresh generic Pi Terminal image boots GUI
        ↓
pairing code entered
        ↓
correct Store/Location/Hub/profile/vertical returned
        ↓
assigned Hub discovered and cryptographically verified
        ↓
secure LAN connection established
        ↓
correct signed business application installed
        ↓
4-digit Terminal PIN created twice and stored only as verifier
        ↓
Terminal becomes ACTIVE
        ↓
reboot
        ↓
PIN required
        ↓
correct PIN unlocks locally through Store Hub
        ↓
wrong PIN is throttled
        ↓
WAN disconnected
        ↓
PIN verification + approved local operation still works
```

Source code, schemas, test plans, or screenshots alone do not prove this success state. Physical image/hardware and integration evidence are required.

## 22. Implementation Impact

This owner decision must be reflected, as applicable, in:

- Admin Portal Digital Store creation workflow;
- Partner Portal Store technology/provisioning workflow;
- Pi Terminal OS image;
- Pi Terminal graphical setup shell;
- device registration/provisioning APIs;
- terminal assignment schema/contracts;
- Store Hub pairing/provisioning endpoints;
- Store Hub terminal authorization;
- application/release registry;
- Store Hub application cache/distribution;
- terminal signed application installer;
- terminal launcher;
- Terminal PIN verifier storage;
- PIN attempt/lockout state;
- PIN reset workflow;
- audit/event contracts;
- offline/recovery tests;
- hardware provisioning test plans;
- current product/architecture documentation.

This decision does not by itself authorize scope unrelated to active Phase 1 or pull later vertical business functionality into Phase 1. The generic app-assignment architecture may be built only to the degree required by the active phase and near-term reuse.

## 23. Relationship to v1.0.0

This v2.0.0 supersedes the earlier terminal transport/pairing owner decision as the current decision-family document.

The earlier locked transport principles remain preserved unless explicitly changed here, including:

- TLS-protected bootstrap transport;
- manufacturing-enrollment identity / proof-of-possession model;
- pairing/provisioning code is not identity;
- no browser cookie/shared terminal secret/Supabase credential as bootstrap identity;
- no database credentials delivered to the Terminal;
- governed versioned provisioning routes and idempotency;
- development-only provisional trust posture while Pilot/production trust blockers remain unresolved.

The major version increment is intentional because this decision expands the family from transport completion into the authoritative end-to-end provisioning UX, role authority, app-install behavior, and offline Terminal PIN architecture.

## 24. Final Owner Lock

The following are now owner-locked:

- **Admin creates the Digital Store.**
- **Partner does not create the Digital Store.**
- **Pi Terminal normal first boot is GUI, not CLI.**
- **Partner provisions terminals from Provisioning → Terminals.**
- **Partner selects the logical terminal assignment/profile(s) before opening pairing.**
- **Partner opens a short-lived one-time pairing session/code.**
- **The Pi user enters only the pairing code during normal assignment.**
- **Pairing determines Store, Location, Store Hub, terminal profile(s), vertical, and required app.**
- **One generic Pi Terminal OS image serves all supported terminal roles/verticals.**
- **The correct business app is selected and installed automatically from governed assignment truth.**
- **After successful provisioning/app installation, the user creates and confirms a 4-digit Terminal PIN.**
- **The raw Terminal PIN is never stored.**
- **Store Hub is the authoritative offline PIN verifier.**
- **PIN brute-force protection and governed reset are mandatory.**
- **Terminal PIN and staff authentication are separate security layers.**
- **Normal provisioned terminal operation remains Hub-first over LAN whether WAN is online or offline.**

Any future change to these locked product/architecture decisions requires an explicit later owner decision and valid version supersession.
