\

# KitLuy Documentation / Code Conflict Report

## 0. Identity

| Field        | Value               |
| ------------ | ------------------- |
| Conflict ID  | `KLCF-<YYYY>-<NNN>` |
| Related task | `[task ID]`         |
| Reporter     | `[name/agent]`      |
| Date         | `[YYYY-MM-DD]`      |
| Severity     | `LOW                | MEDIUM            | HIGH     | CRITICAL`   |
| Status       | `OPEN               | DECISION_REQUIRED | RESOLVED | SUPERSEDED` |

## 1. Conflict summary

`[One factual paragraph. Do not resolve by assumption.]`

## 2. Conflicting sources

| Source                     | Version/commit/environment | Exact location | Stated fact/behavior | Authority class |
| -------------------------- | -------------------------- | -------------- | -------------------- | --------------- |
| Owner decision/instruction | `[version/date]`           | `[section]`    | `[fact]`             | 1               |
| Live migration/code/test   | `[commit/env]`             | `[path]`       | `[fact]`             | 2               |
| Canonical document         | `[version]`                | `[section]`    | `[fact]`             | 3               |
| Handoff/review             | `[path]`                   | `[section]`    | `[fact]`             | 4               |
| Competitor/reference       | `[source]`                 | `[section]`    | `[fact]`             | 5/6             |

## 3. Scope of impact

- affected products/services: `[list]`
- affected data/environments: `[list]`
- migration/compatibility impact: `[summary]`
- security/authorization/audit impact: `[summary]`
- offline/Store Hub impact: `[summary]`
- customer/finance/inventory impact: `[summary]`

## 4. Immediate safety action

`[Stop, preserve behavior, add compatibility shim, disable feature, or other narrow containment. No destructive correction without approval.]`

## 5. Options

| Option | Description | Benefits | Risks | Migration/rollback | Recommendation status |
| ------ | ----------- | -------- | ----- | ------------------ | --------------------- |
| A      | `[option]`  |          |       |                    |                       |
| B      | `[option]`  |          |       |                    |                       |

## 6. Recommended resolution

`[Evidence-based recommendation, clearly labeled as recommendation rather than owner decision.]`

## 7. Required decision

- decision owner: `[REQUIRED]`
- deadline/blocked milestone: `[REQUIRED]`
- exact question: `[REQUIRED]`

## 8. Final resolution

Complete only after approval:

- decision reference/version: `[REQUIRED]`
- chosen option: `[REQUIRED]`
- effective date: `[REQUIRED]`
- files/contracts/migrations to update: `[REQUIRED]`
- compatibility and rollout plan: `[REQUIRED]`
- evidence: `[REQUIRED]`
