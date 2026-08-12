# Release model

**Date:** 2026-08-07
**Cloud side:** already IMPLEMENTED-IN-DEV (migration `0180`). **No change made.**
**Image side:** new — the build system now emits a manifest-v1-shaped record.

---

## 1. Cloud release authority (existing)

`kitluy_releases`: `release_channels`, `release_artifacts`, `rollout_campaigns`,
`device_installations`, `release_events` (append-only).

Migration `0180` installed signed release authority with three locked
properties: a manifest is **immutable after signing**; channels advance
`Internal → Pilot → Stable` **with no skips**; Pilot and Stable sit behind the
BLK-005 gate. Revocation is recorded as a **new fact**, never a mutation.

Manifest v1 · SHA-256 digests · Ed25519 signatures (WS-11-T006-P03).

A/B installation with the owner-locked development health gate — 5 minutes,
20-second probes, 3 probes, **one** automatic rollback — was delivered as Hub
`0039` plus the release agent (WS-11-T006-P04).

## 2. Image-side alignment (new)

`build-image.sh` emits `release-manifest.json` carrying `manifestVersion: 1`,
`digestAlgorithm: sha256`, `signatureAlgorithm: ed25519`, plus profile, device
class, release channel and a deterministic `stagedRootDigest`.

It is deliberately compatible with future signed artifacts and deliberately
honest about not being one:

    "signed": false,
    "flashableImage": false,
    "status": "STAGED-UNSIGNED"

The `signature` field is **absent, not empty**.

**Channel enforcement at build time.** `assert_channel_buildable` refuses
`pilot` and `stable` while `KITLUY_IMAGE_SIGNING_KEY_REF` and
`KITLUY_SECURE_ELEMENT_MODEL` are unresolved, naming BLK-005 in the refusal.
Only `internal` is buildable. Four tests pin this, including that a refused
build leaves **no output directory** behind.

## 3. Determinism

Release identity is meaningless without it: two images with the same version
must be the same image. `stagedRootDigest` is computed over a
locale-independent sorted file list and asserted stable across two runs.

The base OS is **not yet pinned**, so the staged root is reproducible but a
resulting image would not be. The build warns loudly and keeps flashable output
blocked rather than treating the warning as acceptable.

## 4. Storage split

Unchanged and respected: **Supabase owns release metadata and targeting**;
DigitalOcean Spaces may later store binaries. Nothing in the new build system
assumes otherwise, and no signing private key exists anywhere in git.
