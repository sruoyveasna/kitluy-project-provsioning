# KitLuy Dependency and Software Supply Chain Policy

> **Status:** Canonical target engineering standard; not implementation evidence.  
> **Owner:** HET / KitLuy Suite Project Owner  
> **Version:** v1.0.0  
> **Date:** 2026-07-26  
> **Applies to:** KitLuy Suite monorepo, all applications, shared services, packages, Supabase assets, infrastructure, Store Hub and AI handoff work.  
> **Authority:** Current owner decisions and Project Instructions override this document. Applied migrations, verified code/tests and production evidence remain implementation truth.


## 1. Goals

Protect KitLuy from malicious, abandoned, vulnerable, unverifiable or incompatible dependencies and build artifacts while keeping security updates practical.

## 2. Dependency admission

A new runtime dependency requires:

- Clear need and comparison with existing capabilities.
- Active maintenance and documented security process.
- Compatible license.
- Acceptable transitive dependency and install-script risk.
- Browser/mobile/ARM64 compatibility where relevant.
- Named owner and removal path.
- Review for data collection, network access and native code.

Avoid dependencies for trivial functions. Provider-specific SDKs stay in adapters.

## 3. Version pinning

- Direct dependencies in apps/services use exact versions.
- Internal packages use `workspace:*`.
- `pnpm-lock.yaml` is committed and immutable in frozen installs.
- Root `packageManager` pins pnpm `11.4.0`; Node is pinned to `24.18.0`.
- Production container base images and GitHub Actions are pinned by immutable digest/commit SHA, not floating tags.
- Terraform providers and modules are locked with checksums.
- Raspberry Pi OS images, Hub/terminal images and release artifacts have SHA-256 and signatures.

## 4. pnpm controls

- CI uses `pnpm install --frozen-lockfile`.
- Registry is the approved npm registry or approved proxy.
- Lifecycle scripts are deny-by-default through pnpm build-script controls; allowed native/build packages are explicitly listed and reviewed.
- Package provenance/signatures are verified where available.
- Lockfile changes are reviewed as code.

## 5. Automated scanning

Required on pull requests and scheduled runs:

- Secret scanning.
- Dependency/SCA vulnerability scan.
- License policy scan.
- Malware/package reputation checks for new dependencies.
- Source and container image scan.
- Infrastructure-as-code policy/security scan.
- SBOM generation in CycloneDX or SPDX.

Critical/high findings block release unless Security approves a documented, time-bounded exception with compensating controls.

## 6. Updates

Automated update PRs are grouped by ecosystem and risk. Patch updates still run tests; major/minor updates require release-note and compatibility review. Security patches are prioritized by exploitability and KitLuy exposure, not score alone.

Toolchain upgrades change the version ledger, CI images and reproducibility evidence. Expo/React Native are upgraded as a compatibility unit. Electron updates include Linux ARM64 packaging and hardware regression tests.

## 7. Artifact integrity

- CI builds from protected source and clean runners.
- Artifacts include source commit, build workflow, dependency lock hash, SBOM and digest.
- Release artifacts are signed with protected keys.
- Store Hub verifies signatures and compatibility before distribution.
- Promotion uses the same artifact digest across environments.
- Production rejects unsigned or mutable `latest` artifacts.

## 8. CI/CD hardening

- Third-party actions are pinned to commit SHA.
- Workflow permissions are least privilege.
- Fork PRs cannot access deployment secrets.
- Production credentials require protected environments and human approval.
- OIDC/short-lived credentials are preferred over long-lived tokens.
- Build and signing credentials are separated.

## 9. Containers

Docker Engine baseline is `29.6.2`. Images use minimal supported bases, non-root users, read-only filesystems where practical, health checks, explicit resource limits and no embedded secrets. Multi-architecture images must include required `linux/amd64` and `linux/arm64` targets. Base images are pinned by digest and rebuilt for security patches.

## 10. Infrastructure dependencies

Terraform `1.15.5` is the selected IaC CLI. Do not maintain simultaneous Terraform/OpenTofu execution paths in v1.0.0. A switch requires an ADR, state/plan compatibility proof and operator migration plan. Provider constraints are conservative and lock files are committed.

## 11. Incident response

A suspected compromise freezes affected versions, blocks release, identifies consumers/artifacts, rotates exposed credentials, rebuilds from clean inputs, verifies data/infrastructure impact and records the incident. Do not merely update a version and assume compromise is resolved.

## 12. Exceptions and end-of-life

Exceptions include owner, reason, exact package/version, affected paths, risk, controls and expiry. Unsupported/EOL runtimes are prohibited in production. An abandoned critical dependency triggers replacement planning before it becomes an emergency.
