# Device investigation and containment — operational runbook v1.0.0

Status: **development only**. Written by WS-11-T005 to discharge the runbook
condition of KLRISK-DEVICE-002 (KLD-2026-07-28-002 §10: "remains OPEN until
the restricted-investigation state, station containment and runbook are
implemented and independently tested"). Independent testing belongs to
WS-11-T007/T008; this document does not close the risk by itself.

Scope: duplicate-evidence and clone-signal response for enrolled devices
(migration groups 0120/0121/0122 machinery, extended by group 0177), the
restricted-investigation state, enrollment-station containment, and the
governed recovery path. Authority: KLD-2026-07-28-002 §10 (controlled
containment — the four escalation conditions and ten requirements),
device certificate and trust policy v1.0.0 §8 (clone defense) and §10
(revocation), sensitive-action and four-eyes policy v1.0.0 §3.

## The automatic response (no operator choice)

When an enrollment submits hardware evidence colliding with an ACTIVE device
(`record_station_duplicate_submission_v1`, group 0122):

    new identity:        quarantined            (unconditionally)
    incumbent identity:  restricted_investigation (NOT full quarantine)
    trust incident:      created atomically, CRITICAL, append-only
    station + operator:  recorded on the incident
    station counter:     incremented; at the threshold the STATION is
                         quarantined (station_duplicate_quarantine_threshold,
                         [REQUIRED: owner confirmation of this threshold] — 2
                         in development)

While in `restricted_investigation` the incumbent's trust-changing operations
are blocked; existing Store operations continue under the
restricted-investigation policy (owner ruling §10.5). Its prior lifecycle
state is preserved (`devices.restricted_from_state`) so a false-positive
disposition RESTORES it rather than inventing a state.

## Escalation to full quarantine of the incumbent

Permitted ONLY under one of the four owner conditions (§10):

1. cryptographic evidence indicates private-key compromise;
2. the active device presents the duplicate identity;
3. the enrollment station is already revoked or compromised;
4. an A3/A4 authorized operator approves containment.

Conditions 1–3 are machine-detected (group 0122
`escalate_incumbent_containment_v1`). Condition 4 is the governed operator
door added by group 0177 (`approve_incumbent_quarantine_v1`): it VERIFIES
the four-eyes split — requester and approver distinct, both recorded — and
emits an immutable containment event. There is no fifth condition; an
operator who cannot cite one of the four does not escalate.

## Triage classification (required by the owner ruling)

Every duplicate-evidence incident is dispositioned into exactly one of the
seven owner classes. The database cannot tell these apart; the INVESTIGATOR
must, using the discriminators below.

| #   | Classification                | Key discriminators                                                                                                             | Disposition                                                                                                                                                              |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Device cloning                | Same evidence live at two endpoints; sequence/heartbeat anomalies; certificate presented from two addresses; no repair record  | CONFIRMED CLONE: revoke cloned credentials (governed revocation, T003 doors), trigger key rotation/replacement, keep both identities quarantined, security escalation    |
| 2   | Refurbished hardware          | Legitimate resale/refurbish paper trail; incumbent long inactive; no concurrent use                                            | Retire the STALE identity through governed retirement; enroll the refurbished unit as a NEW identity (never merged — §10.10)                                             |
| 3   | Approved board replacement    | Open repair/RMA case naming the device; operator + physical inspection record; storage identity matches                        | Follow the owner replacement policy (§11): new identity for a new board unless the §11 retention conditions hold; close the incident citing the repair case              |
| 4   | Approved NVMe replacement     | Open repair case; board + TPM identity match; NVMe evidence differs                                                            | §11 NVMe path: same `device_record_id` retained only under the §11 conditions; old certificate revoked, old generation invalidated, new key pair — keys are NEVER copied |
| 5   | Data-entry / enrollment error | Station operator error evident (transposed serial, wrong unit scanned); single submission; physical unit demonstrably distinct | FALSE POSITIVE: disposition restores the incumbent's preserved prior state; the incident is NEVER deleted (§10.8); station operator coaching recorded                    |
| 6   | Malicious enrollment          | No paper trail; station operator cannot account; pattern across devices; targeting of high-value identities                    | Security incident: station quarantined, operator access suspended pending review, all affected identities held, owner security escalation                                |
| 7   | Enrollment-station compromise | Multiple incidents from one station; station credentials abused; station software integrity failure                            | Station revoked (condition 3 then applies to its incidents); every enrollment from the station since last known-good is re-verified                                      |

## Required inputs before ANY disposition

- physical evidence inspection (owner ruling §10.6) — the unit(s) in hand or
  photographic/serial evidence captured by a named operator;
- the trust incident record and its station/operator attribution;
- the repair/RMA case when classes 3–4 are claimed;
- for clearance: an authorized disposition through the governed recovery
  door (group 0177) — reason, classification, actor, four-eyes approval.

A signed disposition (§10.7) requires signing infrastructure that is
BLK-005-blocked; until then the disposition is recorded with full audit
attribution and the signature field stays `[REQUIRED: BLK-005 signing
infrastructure]`. This is recorded, not waived.

## What clearance does and does not do

- Restores the incumbent to its preserved prior state (class 5) or applies
  the classified disposition (classes 1–4, 6–7).
- NEVER deletes the incident, the containment events or any audit row —
  recovery is an explicit audited action, not disappearance of the record.
- NEVER merges one identity into another (§10.10).
- NEVER revokes or rewrites finalized financial, custody or audit records.

## Escalation contacts

[REQUIRED: security owner contact] · [REQUIRED: fleet owner contact] —
owner values, never guessed (repository rule 9).
