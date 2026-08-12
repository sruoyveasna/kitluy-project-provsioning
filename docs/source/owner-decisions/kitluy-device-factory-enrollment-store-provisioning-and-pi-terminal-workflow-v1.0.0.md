# KitLuy Device Factory Enrollment, Store Provisioning, and Pi Terminal Workflow

**Document type:** Team workflow / architecture clarification  
**Scope:** Store Hub + Raspberry Pi Terminals  
**Status:** Owner-aligned workflow  
**Date:** 2026-08-11  
**Project:** KitLuy Suite

---

# 1. Purpose

This document defines the intended KitLuy workflow for:

- Raspberry Pi Store Hub devices
- Raspberry Pi Terminal devices
- factory enrollment
- Admin fleet visibility
- Partner Portal provisioning
- Store pairing
- Store Hub assignment
- Pi Terminal assignment
- business-vertical loading
- terminal-access/profile loading
- local Store Hub connectivity

The most important distinction is:

> **Factory enrollment is NOT Store pairing.**

A physical KitLuy device first becomes known to the KitLuy Cloud fleet. Only later does a Shop owner assign that device to a specific Store through Partner Portal provisioning.

The lifecycle is:

```text
1. FACTORY ENROLLMENT
   Device becomes known to KitLuy Cloud/Admin.

2. STORE PAIRING / PROVISIONING
   Device becomes assigned to a specific Digital Store and Location.

3. STORE OPERATION
   Store Hub becomes the local Store authority and Pi Terminals operate through it.
```

---

# 2. Three Platforms Involved

Three major platforms participate in this workflow.

## 2.1 KitLuy Admin Portal

Admin is connected to the canonical KitLuy cloud platform and Supabase.

Admin owns the global device-fleet view.

Admin must be able to see every factory-enrolled KitLuy device, including devices that have not yet been assigned to any Partner, Digital Store, or Location.

Examples:

```text
Pi Terminal
Status: ONLINE
Fleet Enrollment: ENROLLED
Store Assignment: UNASSIGNED
```

```text
Store Hub
Status: ONLINE
Fleet Enrollment: ENROLLED
Store Assignment: UNASSIGNED
```

Admin visibility happens **before Store pairing**.

Admin is not responsible for deciding which Shop owns the device during normal provisioning. That ownership/assignment action belongs to the Partner Portal.

## 2.2 KitLuy Partner Portal

Partner Portal is where the Shop owner provisions devices into their Store.

The Partner already owns or manages:

```text
Partner Account
    ↓
Digital Store
    ↓
Location
```

Partner Portal provides the device-provisioning workflow.

The Shop owner opens a provisioning/pairing session and chooses what type of device is being registered to the Store:

```text
Provision Device

[ Store Hub ]
[ Pi Terminal ]
```

The same provisioning framework supports both Store Hubs and Pi Terminals, but the information required for each device type is different.

## 2.3 KitLuy Devices

There are two device-side experiences.

### Store Hub

Store Hub provisioning uses a **CLI-style setup experience**.

```text
KitLuy Store Hub

Device ............ KL-H-72C910
Fleet ............. Enrolled
Store ............. Unassigned

Enter pairing code:
> __________
```

### Pi Terminal

Pi Terminal provisioning uses a **GUI-style setup experience**.

```text
KitLuy Terminal

Device ............ KL-P-84A93C
Cloud ............. Connected
Fleet ............. Enrolled
Store ............. Unassigned

Pairing code:
[ __________ ]

[ Pair Device ]
```

---

# 3. Device Types

This workflow applies primarily to:

```text
device_class = store_hub
device_class = terminal
```

Both use the same high-level lifecycle:

```text
KitLuy OS
    ↓
Factory Enrollment
    ↓
Admin Fleet Visibility
    ↓
Unassigned Device
    ↓
Partner Provisioning
    ↓
Store Assignment
```

Their operational roles after pairing are different.

---

# 4. Stage 1 — Factory Enrollment

Factory enrollment happens automatically when a device boots KitLuy OS.

This stage does **not** assign the device to a Store.

It establishes:

> "This physical device is a legitimate KitLuy fleet device."

---

# 5. Factory Enrollment — Pi Terminal

```text
KitLuy Pi Terminal OS boots
        ↓
Firstboot executes
        ↓
Generate unique installation/device identity
        ↓
Generate device key material
        ↓
Connect to KitLuy Cloud factory-enrollment service
        ↓
Register/enroll device into global device fleet
        ↓
Start fleet heartbeat/liveness
        ↓
Admin can see device
```

Result:

```text
Device Type ........ Pi Terminal
Fleet Status ....... ENROLLED
Online ............. YES
Store .............. NONE
Location ........... NONE
Assignment ......... UNASSIGNED
```

The device does not need a Shop pairing code to reach this state.

---

# 6. Factory Enrollment — Store Hub

```text
KitLuy Store Hub OS boots
        ↓
Firstboot executes
        ↓
Generate unique Hub/device identity
        ↓
Connect to KitLuy Cloud factory-enrollment service
        ↓
Register/enroll Hub into global device fleet
        ↓
Start fleet heartbeat/liveness
        ↓
Admin can see Hub
```

Result:

```text
Device Type ........ Store Hub
Fleet Status ....... ENROLLED
Online ............. YES
Store .............. NONE
Location ........... NONE
Assignment ......... UNASSIGNED
```

This also happens before the Shop owner pairs the Hub to a Store.

---

# 7. Admin Fleet Visibility

After factory enrollment, Admin should be able to see devices such as:

```text
Device ID:       KL-P-84A93C
Device Class:    Terminal
Online:          Yes
Fleet:           Enrolled
Assignment:      Unassigned
Store:           —
Location:        —
Image Version:   0.2.0-dev
Agent Version:   ...
Last Seen:       ...
Health:          ...
```

and:

```text
Device ID:       KL-H-72C910
Device Class:    Store Hub
Online:          Yes
Fleet:           Enrolled
Assignment:      Unassigned
Store:           —
Location:        —
Image Version:   ...
Agent Version:   ...
Last Seen:       ...
Health:          ...
```

This global fleet visibility is an Admin responsibility.

---

# 8. Factory Enrollment Is Separate from Store Pairing

Factory enrollment answers:

```text
What physical device is this?
Is it a known KitLuy device?
Is it online?
What OS/image version is it running?
What device class is it?
Is it enrolled in the global fleet?
```

Factory enrollment does NOT answer:

```text
Which Shop owns it?
Which Digital Store is it assigned to?
Which Location is it assigned to?
Which Store Hub does it belong to?
Which business vertical should it run?
Which terminal role should it use?
```

Those are answered during Store provisioning.

---

# 9. Stage 2 — Store Provisioning / Pairing

After factory enrollment, the device remains:

```text
ENROLLED
+
UNASSIGNED
```

The Shop owner must explicitly register the device to their Store through Partner Portal.

---

# 10. Store Hub Must Be Paired First

For a physical Store Location, the Store Hub must be paired before Pi Terminals.

Required order:

```text
Digital Store
    ↓
Location
    ↓
Pair Store Hub
    ↓
Store Hub becomes assigned/active for Location
    ↓
Pair Pi Terminals
```

A Pi Terminal should not be fully activated for a Location that has no eligible Store Hub.

---

# 11. Partner Portal — Store Hub Provisioning

```text
Partner Portal
    ↓
Digital Store
    ↓
Location
    ↓
Devices / Provisioning
    ↓
Provision Device
    ↓
Store Hub
```

Example:

```text
Device Type:
Store Hub

Digital Store:
Sokha Laundry

Location:
BKK1

[ Open Pairing Session ]
```

The system generates a short-lived provisioning/pairing code.

Example:

```text
ABCD-8291
```

The code is an opaque credential. The code itself should not directly contain human-readable Store IDs, Location IDs, or database credentials.

---

# 12. Store Hub — Pairing Code Entry

The Store Hub is already factory-enrolled.

Its CLI shows:

```text
KitLuy Store Hub

Device ............ KL-H-72C910
Fleet ............. Enrolled
Store ............. Unassigned

Enter pairing code:
> ABCD-8291
```

The cloud validates:

```text
device exists
device is enrolled
device_class = store_hub
device is eligible
pairing session exists
pairing session is not expired
pairing code has not already been consumed
target Digital Store is valid
target Location is valid
```

If valid, the pairing code is consumed atomically.

---

# 13. Store Hub — Successful Assignment

Conceptually:

```text
Device
  ↓
Tenant
  ↓
Digital Store
  ↓
Location
  ↓
Role = STORE_HUB
```

The Hub moves from:

```text
ENROLLED
UNASSIGNED
```

to:

```text
ENROLLED
ASSIGNED
```

The Store Hub now knows which Store and Location it belongs to.

---

# 14. Store Hub Local Runtime Registration

After assignment, the Store Hub must start/validate its local Store runtime.

```text
Assigned Store Hub
        ↓
Start/verify local Store runtime
        ↓
Start local database/runtime services
        ↓
Expose approved LAN endpoint
        ↓
Register/publish Hub local connection information
        ↓
Cloud Store/Location configuration knows
which Store Hub serves this Location
```

The cloud does not become the local transaction authority during normal in-Store operation.

The Store Hub remains the local operational authority.

---

# 15. Store Hub Local Endpoint

The cloud assignment/configuration must allow Pi Terminals to determine the correct local Store Hub/runtime.

```text
Digital Store
    ↓
Location
    ↓
Store Hub
    ↓
Approved local Hub endpoint / local runtime information
```

A terminal must not guess which Store Hub belongs to its Store.

Manual IP should be fallback only.

---

# 16. Partner Portal — Pi Terminal Provisioning

Once the Store Hub is paired, the Shop owner can provision Pi Terminals.

```text
Partner Portal
    ↓
Digital Store
    ↓
Location
    ↓
Devices / Provisioning
    ↓
Provision Device
    ↓
Pi Terminal
```

For Phase 1 Laundry, the Shop owner selects terminal access/profile:

```text
T1 — POS Cashier / Intake
T2 — Customer Display
T3 — Clean & Ready Scan-In
T4 — Customer Pickup Scan-Out
```

The business vertical is not selected manually if the Digital Store already has an authoritative `primary_vertical`.

---

# 17. Pi Terminal Provisioning Session

Example:

```text
Device Type:
Pi Terminal

Digital Store:
Sokha Laundry

Location:
BKK1

Store Hub:
HUB-001

Terminal Access:
T1 — POS Cashier / Intake

[ Open Pairing Session ]
```

The server already knows:

```text
tenant_id
digital_store_id
primary_vertical
location_id
store_hub_id
terminal_profile_code
```

The Shop owner does not manually type those IDs into the Pi.

---

# 18. Pi Terminal Pairing Code

Example:

```text
KP7M-392Q
```

The code should be:

```text
opaque
short-lived
one-time
replay-protected
auditable
scope-bound
```

Server-side, the provisioning session represents the intended assignment.

---

# 19. Pi Terminal Before Store Pairing

The Pi has already completed factory enrollment.

```text
KitLuy Terminal

Device identity ... Ready
Cloud ............. Connected
Fleet ............. Enrolled
Store ............. Unassigned

Pair this terminal with your Store

Pairing code:
[ __________ ]

[ Pair Device ]
```

The only manual Store-provisioning input on the Pi should normally be:

```text
pairing_code
```

---

# 20. Pi Terminal Pairing Validation

```text
Pi Terminal
    ↓
Cloud Provisioning Service
    ↓
Validate device identity
    ↓
Validate provisioning session
    ↓
Validate Store/Location
    ↓
Validate Store Hub
    ↓
Validate business vertical
    ↓
Validate terminal profile
    ↓
Consume pairing code atomically
```

The cloud must reject:

```text
expired pairing code
already-used code
revoked device
wrong device class
wrong Store
wrong Location
missing/ineligible Store Hub
invalid terminal profile
profile incompatible with Store vertical
inactive/unsupported vertical
```

---

# 21. Pi Terminal — Assignment Payload

After successful pairing, the Pi Terminal needs enough authoritative assignment/configuration to know:

1. which Partner/Tenant it belongs to
2. which Digital Store it belongs to
3. which business vertical it must load
4. which Location it belongs to
5. which Store Hub it must use
6. which terminal access/profile it has
7. which configuration version it should use

Conceptually:

```text
tenant_id
digital_store_id
primary_vertical
location_id
store_hub_id
terminal_profile_code
configuration_version
```

The exact transport/contract should follow canonical KitLuy APIs and configuration contracts.

---

# 22. Business Vertical Is Mandatory

The Pi Terminal must know the Store's business type.

Authoritative source:

```text
Digital Store.primary_vertical
```

Phase 1:

```text
primary_vertical = laundry
```

Future examples:

```text
cafe_restaurant
ecommerce
convenience
pharmacy
department_store
grocery
supermarket
```

The user must not manually choose the vertical on the terminal.

---

# 23. Terminal Access/Profile Is Mandatory

The terminal profile determines which experience the terminal is allowed to load.

Phase 1 Laundry:

```text
T1 — POS Cashier / Intake
T2 — Customer Display
T3 — Clean & Ready Scan-In
T4 — Customer Pickup Scan-Out
```

The profile must be compatible with `primary_vertical`.

```text
Store vertical = laundry
Profile = laundry.t1.intake_cashier
✓ VALID
```

```text
Store vertical = laundry
Profile = cafe.cashier
✗ INVALID
```

---

# 24. One KitLuy POS Application

KitLuy should not create separate POS applications for every vertical.

```text
ONE KitLuy POS Desktop
        ↓
Shared Shell
        ↓
Vertical Resolver
        ↓
Vertical Registry
        ↓
Business Module
        ↓
Terminal Profile
        ↓
Correct Workflow/UI
```

Example:

```text
primary_vertical = laundry
        ↓
Load Laundry module

terminal_profile = T1
        ↓
Load Intake/Cashier workflow
```

Future:

```text
primary_vertical = cafe_restaurant
        ↓
Load Café/Restaurant module
```

---

# 25. Pi Terminal — Successful Store Assignment

After pairing:

```text
Device ............ KL-P-84A93C
Fleet ............. Enrolled
Store ............. Sokha Laundry
Location .......... BKK1
Business .......... Laundry
Store Hub ......... HUB-001
Terminal Access ... T1 Intake/Cashier
```

The Pi now knows which Shop owns it and which local Store Hub it must communicate with.

---

# 26. Stage 3 — Normal Store Operation

After successful provisioning:

```text
Pi Terminal
    ↓ LAN
Store Hub
    ↓ async cloud sync/control
KitLuy Cloud
```

Normal Store operation must NOT become:

```text
Pi Terminal
    ↓
direct Supabase business transactions
```

The Store Hub is the local operational authority.

---

# 27. Store Hub and Local Store Runtime

```text
                    KITLUY CLOUD
                         ↑
                         ↓
                  async sync/control
                         ↓
                 ┌───────┴───────┐
                 │   STORE HUB   │
                 │               │
                 │ local runtime │
                 │ local DB      │
                 │ LAN API       │
                 └───────┬───────┘
                         │
                  authenticated LAN
                         │
          ┌──────────────┼──────────────┐
          │              │              │
          ▼              ▼              ▼
         T1             T2            T3/T4
       Terminal       Terminal       Terminals
```

---

# 28. Internet Failure

After correct provisioning:

```text
Internet failure
≠
Store stops operating
```

Approved local operations should continue over LAN against the Store Hub.

Cloud synchronization resumes asynchronously when connectivity returns.

---

# 29. Complete End-to-End Lifecycle

```text
PHYSICAL DEVICE
     │
     ▼
KitLuy OS boots
     │
     ▼
Unique device identity
     │
     ▼
FACTORY ENROLLMENT
     │
     ▼
KITLUY CLOUD DEVICE FLEET
     │
     ▼
ADMIN sees:
ONLINE
ENROLLED
UNASSIGNED


==================================================


PARTNER PORTAL

Digital Store
     ↓
Location
     ↓
Provision Device
     ↓
STORE HUB
     ↓
Open pairing session
     ↓
Generate code


STORE HUB CLI

Enter pairing code
     ↓
Cloud validates
     ↓
Hub assigned to Store + Location
     ↓
Hub local runtime starts
     ↓
Hub/local endpoint becomes authoritative
for this Location


==================================================


PARTNER PORTAL

Provision Device
     ↓
PI TERMINAL
     ↓
Select T1 / T2 / T3 / T4
     ↓
Open pairing session
     ↓
Generate code


PI TERMINAL GUI

Enter pairing code
     ↓
Cloud validates
     ↓
Terminal assigned:
Tenant
Digital Store
Primary Vertical
Location
Store Hub
Terminal Profile
Configuration
     ↓
Terminal connects to assigned Hub
     ↓
POS resolves business vertical
     ↓
POS resolves terminal access/profile
     ↓
Correct Store workflow/UI loads


==================================================


NORMAL OPERATION

Pi Terminal
     ↓ LAN
Store Hub
     ↓ async
KitLuy Cloud
```

---

# 30. Device State Model

Conceptually:

```text
UNENROLLED
    ↓
ENROLLED
    ↓
UNASSIGNED
    ↓
PAIRING_PENDING
    ↓
ASSIGNED
    ↓
HUB_CONNECTION_PENDING
    ↓
ACTIVE
```

Exact canonical database state may be normalized differently.

`ENROLLED + no active assignment` may be displayed as `ENROLLED / UNASSIGNED` without requiring a dedicated database enum.

---

# 31. Store Hub Ordering Rule

```text
Location
    ↓
Eligible Store Hub?
    ↓
    ├── NO → block terminal activation/pairing
    ↓
    └── YES
          ↓
      Pi Terminal provisioning allowed
```

---

# 32. Pairing Session Types

Partner Portal can use a shared provisioning feature with device-specific session types.

```text
Provisioning Session

device_class:
- store_hub
- terminal
```

For Store Hub:

```text
Store
Location
Device class = store_hub
```

For Pi Terminal:

```text
Store
Location
Store Hub
Device class = terminal
Terminal profile
```

The Store's business vertical is derived from the Digital Store.

---

# 33. Pairing Code Security

The provisioning code must be:

```text
opaque
short-lived
single-use
replay-protected
atomic on redemption
auditable
Store/Location scoped
device-class scoped
```

It must never expose:

```text
Supabase service-role
local database password
private device key
release signing key
Partner credentials
```

---

# 34. Device Identity Security

The golden image must not contain unique identity.

Every physical device generates its own identity after boot.

Do not bake into a shared image:

```text
device private key
device certificate unique to one device
Tenant ID
Digital Store ID
Location ID
Store Hub assignment
terminal profile
Store Wi-Fi secret
Supabase service-role
database credentials
private release-signing key
```

---

# 35. Factory Enrollment Credential vs Store Pairing Code

If KitLuy uses an enrollment credential/ticket during factory enrollment, it is not the same credential used by a Shop owner during Store provisioning.

```text
Factory/fleet enrollment
    ↓
Device becomes known to Admin

Store pairing/provisioning
    ↓
Device becomes assigned to a Shop
```

These must remain separate security scopes.

---

# 36. Current Development Position

Current Pi Terminal OS work is focused on the device-side bootstrap image.

Expected bootstrap behavior:

```text
KitLuy Terminal

Device identity ... Ready
Network ........... Connected
Fleet enrolment ... Not enrolled
Store assignment .. Unassigned
Device ............ KL-XXXXXXXX
Image version ..... 0.2.0-dev
```

The next important device-management milestone is:

```text
Pi boots
    ↓
Factory enrollment succeeds
    ↓
Admin sees Pi
ONLINE
ENROLLED
UNASSIGNED
```

Only after this is proven should development move to Partner Portal Store pairing.

---

# 37. Implementation Sequence

## Milestone 1 — Pi Terminal Image

```text
Build image
Flash Pi
Boot
Firstboot identity
Identity persistence after reboot
Bootstrap GUI
```

## Milestone 2 — Automatic Factory Enrollment

```text
Pi/Hub boot
Cloud enrollment
Fleet device record
Heartbeat
Admin visibility
```

Acceptance:

```text
ONLINE
ENROLLED
UNASSIGNED
```

## Milestone 3 — Store Hub Pairing

```text
Partner opens Store Hub pairing session
Generate code
Hub CLI enters code
Hub assigned to Store/Location
Hub runtime/local endpoint registered
```

## Milestone 4 — Pi Terminal Pairing

```text
Partner opens Pi Terminal pairing session
Select T1/T2/T3/T4
Generate code
Pi GUI enters code
Assignment returned
```

## Milestone 5 — Terminal Runtime Activation

```text
Resolve:
Store
Location
Store Hub
primary_vertical
terminal_profile

Connect to Store Hub
Load correct vertical
Load correct terminal workflow
```

## Milestone 6 — Normal Offline-Capable Operation

```text
Pi Terminal → Store Hub over LAN
Store Hub → Cloud asynchronously
WAN outage does not stop approved local operation
```

---

# 38. Acceptance Criteria

## Factory Fleet

- fresh Hub/Pi generates unique identity
- device automatically becomes known to KitLuy Cloud
- Admin sees device before Store assignment
- Admin correctly shows unassigned state
- heartbeat/liveness works

## Store Hub Pairing

- Partner can create Store Hub pairing session
- pairing code is single-use and expiring
- Hub CLI accepts code
- Hub becomes assigned to correct Digital Store/Location
- Hub local runtime becomes available
- Store/Location knows its active Hub

## Pi Terminal Pairing

- Partner can create terminal pairing session
- Partner selects terminal access/profile
- terminal pairing requires/targets an eligible Store Hub
- Pi GUI accepts pairing code
- terminal becomes assigned to correct Store
- terminal receives/derives `primary_vertical`
- terminal receives terminal profile
- terminal knows assigned Store Hub
- terminal can establish the approved Hub connection

## POS Runtime

- one POS app resolves the business vertical
- Laundry loads in Phase 1
- T1/T2/T3/T4 load correct experiences
- terminal does not directly own cloud business truth
- approved Store operation continues over LAN during WAN outage

---

# 39. Source-of-Truth Rule

This document defines the owner-aligned workflow for this device lifecycle discussion.

Implementation must still use canonical KitLuy:

- device tables
- provisioning tables
- role/permission model
- Store/Location relationships
- terminal profile registry
- Digital Store vertical registry
- Store Hub configuration contracts
- API contracts
- RLS rules
- audit events
- offline/sync contracts

Do not create duplicate schemas or parallel provisioning systems merely because this document uses conceptual names.

Where existing canonical implementation differs in naming, preserve the canonical data model while implementing the workflow defined here.

---

# 40. One-Sentence Architecture Summary

> **KitLuy OS factory-enrolls every Store Hub and Pi Terminal into the global Admin-visible fleet first; Partner Portal later pairs the Store Hub to a Shop/Location and then pairs Pi Terminals to that Store Hub with a business vertical and terminal profile, after which the terminals operate through the assigned Store Hub over the local network.**
