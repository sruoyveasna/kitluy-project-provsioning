# kitluy-pos-mobile-app

POS Mobile App.

**Status:** SCAFFOLDED (typecheck-only React Native shell). The full Expo app
(Expo Router, EAS channels) is the next app milestone — see ADR-0002. **No
business functionality is implemented; the shell fails closed.**

## Boundary

Secure, Hub-bound, scan-first roaming staff app extending (never replacing) T1-T4. Primary contract is the Edge Operations API through the Store Hub; never authoritative T1 payment, T3 Ready Scan-In or T4 Pickup Scan-Out (pos-mobile spec v2.2.0).

Source specification: kitluy-pos-mobile-app-phase1-spec-v2.2.0.md (imported under `docs/source/imported/`).
