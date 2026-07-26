# KitLuy Coding Standards — TypeScript, React, React Native and Electron

> **Status:** Canonical target engineering standard; not implementation evidence.  
> **Owner:** HET / KitLuy Suite Project Owner  
> **Version:** v1.0.0  
> **Date:** 2026-07-26  
> **Applies to:** KitLuy Suite monorepo, all applications, shared services, packages, Supabase assets, infrastructure, Store Hub and AI handoff work.  
> **Authority:** Current owner decisions and Project Instructions override this document. Applied migrations, verified code/tests and production evidence remain implementation truth.


## 1. Language baseline

TypeScript is mandatory for production JavaScript work. The root compiler is TypeScript `6.0.3`. New JavaScript files require an explicit exception for configuration/tool compatibility.

Minimum base options:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "useUnknownInCatchVariables": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "moduleResolution": "Bundler",
    "target": "ES2023",
    "skipLibCheck": false
  }
}
```

## 2. Type rules

- `any` is forbidden except in a documented compatibility boundary and must be narrowed immediately.
- Use `unknown` for untrusted input and validate with the canonical schema package.
- Domain identifiers use opaque/branded types to prevent cross-entity assignment.
- Money, quantity, business date, UTC timestamp, locale and currency are explicit types, not raw numbers/strings passed casually.
- Public functions have explicit return types.
- Exhaustive switches use a `never` assertion.
- Do not use TypeScript enums for network/database contracts; use string literal unions generated from canonical schemas.
- Do not use non-null assertions to suppress missing-state design problems.
- Optional means semantically optional; do not use optional fields as a substitute for state variants.

## 3. Naming and files

| Item | Convention | Example |
|---|---|---|
| Components | PascalCase | `BookingSummaryCard.tsx` |
| Hooks | `use` + camelCase | `useBookingFreshness.ts` |
| Functions/variables | camelCase | `calculateBalanceDue` |
| Types/interfaces | PascalCase | `PaymentAttempt` |
| Constants | camelCase; uppercase only for true environment constants | `defaultPageSize`, `MAX_UPLOAD_BYTES` |
| Packages | kebab-case under `@kitluy/` | `@kitluy/sync-protocol` |
| Tests | adjacent or `tests/`, `.test.ts(x)` | `money.test.ts` |
| Schemas | `.schema.ts` | `booking.schema.ts` |

One file should have one primary responsibility. Avoid generic `utils.ts`; use domain-specific modules.

## 4. Functions and domain logic

- Prefer small pure functions for calculations and transitions.
- Commands mutate; queries read. Names reveal which.
- Validation occurs at every trust boundary, not deep inside random components.
- Side effects are injected and awaitable.
- Time, randomness, IDs and environment access are dependencies in testable code.
- Sensitive actions accept an authorization context and reason/approval data; UI visibility is never authorization.
- Finalized records are corrected through explicit commands and compensating events, not in-place edits.

## 5. Error handling

Do not throw raw strings. Expected business failures return typed results; unexpected programmer/infrastructure failures throw typed errors and are mapped at the boundary.

```ts
type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

Errors include a stable code, safe message key, retry classification and correlation ID. Never expose stack traces, SQL, secrets or provider credentials to clients.

## 6. React web standards

- React web version is `19.2.7`.
- Components render UI; use cases and calculations live outside components.
- Prefer composition over boolean-prop explosions.
- Server state uses the approved query layer. Do not mirror server data into global client state without a reason.
- Forms use schema-backed validation and accessible error summaries.
- Effects synchronize with external systems; they are not a default place for derived state.
- Hook dependencies are complete; lint suppression needs a comment and review.
- Every asynchronous screen defines loading, empty, error, stale, partial and offline behavior where relevant.
- Lists use stable domain keys, never array indexes for mutable lists.
- All user-visible text uses localization keys. Khmer and English layouts are tested.
- Money and date/time formatting use shared packages, KHR/USD and `Asia/Phnom_Penh`; no ad-hoc formatting.
- Accessibility: semantic controls, keyboard operation, visible focus, labels, error association, reduced-motion support and WCAG AA contrast.

## 7. React Native and Expo standards

- Expo `57.0.8`, React Native `0.86.0`, React `19.2.3` are one compatibility unit.
- Use Expo-supported libraries unless a native-module exception is approved.
- Permissions are requested just in time with a clear purpose.
- Secure tokens use platform secure storage; never AsyncStorage.
- Offline caches are scoped, versioned and clearly marked as last-known/stale.
- Deep links validate route, actor scope and object access after authentication.
- Background tasks are idempotent and resilient to OS termination.
- Mobile screens support font scaling, screen readers, touch target size and low-end device performance.

## 8. Electron standards

- Electron `43.2.0`.
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` in renderer windows.
- Use a typed preload bridge with an allowlist; no raw `ipcRenderer` exposure.
- Validate every IPC request and response.
- Navigation, new windows, file URLs and external links are deny-by-default.
- Content Security Policy is explicit; remote arbitrary code is prohibited.
- Auto-updates accept only signed release manifests and artifacts.
- Printer, scanner, scale and cash-drawer access is in the main process or approved local adapter, not React components.

## 9. Security and privacy

- Secrets never enter source, logs, analytics, browser bundles or crash metadata.
- Treat customer phone, addresses, garment evidence and finance data as sensitive.
- Authorization checks occur in API/service/RLS/Hub layers even when the UI already hides a control.
- HTML is escaped by default. `dangerouslySetInnerHTML` requires sanitization and security review.
- URLs, filenames, MIME types and uploaded content are untrusted.

## 10. Performance

- Measure before optimization.
- Avoid N+1 API/database patterns.
- Paginate large datasets.
- Keep expensive reporting/AI work off transaction paths.
- Bundle budgets and route-level performance budgets are defined per app.
- Store operations prioritize low latency and offline continuity over decorative effects.

## 11. Comments and documentation

Comments explain why, invariants, risk and non-obvious tradeoffs—not what syntax does. Public package exports and complex domain rules require TSDoc. TODOs include an issue ID and owner; untracked TODO/FIXME comments fail CI.

## 12. Formatting and linting

Formatting is automated. Do not debate style in reviews. Lint suppressions are scoped to one line/block and explain the reason. Generated code is excluded only through declared generated paths.
