# Recovery Artifact Register

**Filename:** `RECOVERY_ARTIFACT_REGISTER.md` · **Version:** v1.0.0 · **Date:** 2026-08-07
**Status:** CURRENT · **Authority:** IMPLEMENTATION-EVIDENCE (artifacts verified) · **Evidence status:** VERIFIED

## Location

```text
~/Development/HET_VEASNA_WORKSPACE/backups/kitluy-standalone-retirement-2026-08-07/
├── manifests/RECOVERY_MANIFEST.md
├── git-bundles/            6 × *__ALL-REFS.bundle
├── working-tree-patches/   kitluy-suite-pos-desk-app__{STAGED,UNSTAGED}.patch
└── untracked-preservation/ kitluy-suite-pos-desk-app__UNTRACKED_MANIFEST.txt
```

## Git bundles — all refs, all verified

Created with `git bundle create <file> --all`, so every branch, remote-tracking
ref, HEAD and worktree HEAD is included.

| Bundle                                         | Size   | Refs | `git bundle verify` |
| ---------------------------------------------- | ------ | ---- | ------------------- |
| `kitluy-admin-portal__ALL-REFS.bundle`         | 1.6 MB | 8    | **is okay**         |
| `kitluy-chain-portal__ALL-REFS.bundle`         | 1.7 MB | 8    | **is okay**         |
| `kitluy-laundry-pos-desk-app__ALL-REFS.bundle` | 3.2 MB | 19   | **is okay**         |
| `kitluy-partner-portal__ALL-REFS.bundle`       | 3.8 MB | 7    | **is okay**         |
| `kitluy-suite-pos-desk-app__ALL-REFS.bundle`   | 8.5 MB | 9    | **is okay**         |
| `kitluy-suite-supabase__ALL-REFS.bundle`       | 2.5 MB | 11   | **is okay**         |

## Restore test — performed, passed

A real `git clone` from the suite POS bundle into a scratch directory:

| Check                 | Result                                                                  |
| --------------------- | ----------------------------------------------------------------------- |
| Restored HEAD         | `3f66249a1f49a40b072a9521c44472305900da00` — **matches source exactly** |
| Refs restored         | 6                                                                       |
| `3f66249` recoverable | **YES** — _feat(ui): port laundry UI to Dashboard, Order Queue…_        |
| `5c308be` recoverable | **YES** — _feat(ui): port KitLuy Laundry POS UI to Suite POS launcher…_ |
| `2c83025` recoverable | **YES** — _feat: add design tokens, touch input pad styles…_            |
| Staged patch applies  | **CLEANLY**                                                             |

The bundle also carries `refs/heads/feat/port-laundry-ui` and
`worktrees/port-laundry-ui/HEAD`, so the locked internal worktree's branch is
preserved.

## Working-tree patches

| Artifact                                    | Size    | Content                                                                |
| ------------------------------------------- | ------- | ---------------------------------------------------------------------- |
| `kitluy-suite-pos-desk-app__STAGED.patch`   | 8,537 B | `A .claude/settings.json`, `A CLAUDE.md` — binary-capable (`--binary`) |
| `kitluy-suite-pos-desk-app__UNSTAGED.patch` | 0 B     | No unstaged changes (correct — all staged)                             |

The other five repositories have clean working trees; no patches required.

## Untracked preservation

`kitluy-suite-pos-desk-app` untracked (excluding gitignored):

```text
.claude/worktrees/port-laundry-ui/
```

This is the **locked worktree checkout**, not unique source — its branch
`feat/port-laundry-ui` at `3f66249` is inside the bundle. **No untracked source
files require separate preservation.** The other five repositories have no
untracked files outside gitignore.

## Exclusions — confirmed

Not copied: `node_modules`, `dist`, `build`, cache, coverage, temporary output,
`.env`, `.env.local`, credentials, private keys, tokens.

**No secret value was printed or copied.** `git bundle` carries only committed
Git objects; the patch contains only the two staged files listed above.

## Sufficiency

A remote alone would be insufficient — `kitluy-suite-pos-desk-app` is **ahead 3**
and `kitluy-partner-portal` is **behind 2**. These bundles capture local state
that no remote holds.

**Verdict: recovery artifacts are complete and verified for all six repositories.**
This satisfies mission §7 and §21. It does **not** authorize deletion — see
`REPOSITORY_RETIREMENT_MATRIX.md`.
