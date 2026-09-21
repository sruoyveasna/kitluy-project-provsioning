# @kitluy/terminal-seat-contracts

Contracts for **Terminal Seat → application assignment → allowed surfaces**
(TERMINAL-APPLICATION-ASSIGNMENT-001). Neutral Core — no vertical vocabulary.

| Module | What it fixes |
|---|---|
| `application-identifier` | `<vertical>.<application>` identifiers, explicit registry, cross-vertical refusal |
| `allowed-surfaces` | `<area>.<surface>` identifiers, registry, fail-closed validation — vocabulary is an owner decision, none registered here |
| `terminal-seat` | Seat definition with an **explicit** primary vertical; server-side derivation of desired applications; profile prefix is a cross-check, never the source of truth |
| `desired-vs-actual` | Runtime report contract and comparison; absence of a report is `unreported`, never success |

Applications are derived, never chosen — not by the Partner, not by the
terminal, not by the pairing code. Concrete descriptors are declared by
vertical packages and registered explicitly by the composing app or service.
