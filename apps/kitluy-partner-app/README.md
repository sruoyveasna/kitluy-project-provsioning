# kitluy-partner-app

Partner App.

**Status:** SCAFFOLDED (typecheck-only React Native shell). The full Expo app
(Expo Router, EAS channels) is the next app milestone — see ADR-0002. **No
business functionality is implemented; the shell fails closed.**

## Boundary

Owner/manager mobile exception-first operations cockpit. NOT the back office, NOT staff POS, NOT T1-T4; cloud-read via Management API only; read-only finance; no direct Store Hub LAN access in Phase 1 (partner-app spec v2.0.0, Proposed).

Source specification: kitluy-partner-app-phase1-spec-v2.0.0.md (imported under `docs/source/imported/`).
