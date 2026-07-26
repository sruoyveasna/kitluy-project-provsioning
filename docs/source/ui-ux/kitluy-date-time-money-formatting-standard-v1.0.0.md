# KitLuy Date, Time and Money Formatting Standard

| Field          | Value                                                  |
| -------------- | ------------------------------------------------------ |
| Filename       | `kitluy-date-time-money-formatting-standard-v1.0.0.md` |
| Version        | `v1.0.0`                                               |
| Date           | 2026-07-26                                             |
| Owner          | HET / KitLuy Suite Project Owner                       |
| Status         | Canonical target standard; not implementation evidence |
| Primary market | Cambodia                                               |
| Languages      | Khmer (`km-KH`) and English (`en-KH`)                  |
| Currencies     | KHR and USD                                            |
| Timezone       | `Asia/Phnom_Penh`                                      |

> **Evidence rule:** This artifact defines a build contract. It is not evidence that Figma files, components, routes, code, migrations, tests or deployments exist. Every missing owner, brand, provider or production value is marked `[REQUIRED: ...]`.

## Authority and scope

Authority order:

1. Current owner decisions and KitLuy Project Instructions.
2. Applied migrations, verified code/tests and production evidence.
3. Current approved KitLuy Rebuild, Business and product specifications.
4. This UI/UX build-pack artifact after approval.
5. Approved handoffs and evidence-based analyses.
6. Competitor rebuild documents as design references only.

The shared design system is neutral. Laundry terminology belongs only in Laundry-specific compositions and must not be hardcoded into Core components.

## 1. General rules

- Authoritative timestamps are stored and exchanged as ISO 8601 timestamps with timezone; UI renders in the active Store Location timezone, default `Asia/Phnom_Penh`.
- Operational `business_date` is a separate governed value and must not be derived casually from the device calendar when a Store business day crosses midnight.
- UI formatting uses locale-aware libraries and the shared typed money/date contracts. Never use floating-point arithmetic for business totals.
- Every important timestamp may expose the absolute value and timezone through detail/tooltip, especially around sync, approval, payment and custody events.

## 2. Date and time

| Use           | English (`en-KH`)                       | Khmer (`km-KH`)               | Notes                                                          |
| ------------- | --------------------------------------- | ----------------------------- | -------------------------------------------------------------- |
| Compact date  | `26/07/2026`                            | Locale-formatted equivalent   | Default UI compact pattern                                     |
| Time          | `14:30`                                 | Locale-formatted equivalent   | 24-hour default unless owner approves user preference          |
| Date + time   | `26/07/2026 14:30`                      | Locale-formatted equivalent   | Include date when operational ambiguity is possible            |
| Long date     | `26 July 2026`                          | Approved Khmer long-date form | Public/legal/content surfaces                                  |
| Relative      | `5 minutes ago`                         | Approved Khmer relative form  | Never replace absolute time on financial/audit/custody records |
| API           | `2026-07-26T14:30:00+07:00` or UTC `Z`  | Same                          | ISO 8601                                                       |
| Business date | `26/07/2026` with label `Business date` | Localized label               | Comes from authoritative Store policy                          |

## 3. Freshness

Every freshness display includes at least one of:

- `As of {absolute time}`;
- `Last synchronized {absolute time}`;
- `Pending since {absolute time}`;
- `Unknown — freshness could not be established`.

Relative time may supplement but never replace absolute time on sensitive records.

## 4. Money

| Currency | Display                        | Example      | Rules                                                                                    |
| -------- | ------------------------------ | ------------ | ---------------------------------------------------------------------------------------- |
| KHR      | Riel symbol and integer amount | `៛1,250,000` | No decimal places; grouping separators; preserve authoritative sign                      |
| USD      | Dollar symbol and two decimals | `$12.50`     | Two decimals unless authoritative contract explicitly carries another approved precision |

- Preserve original currency. Do not silently convert KHR and USD.
- A dual-currency view shows separate labeled amounts and the authoritative exchange-rate source/time only when conversion is approved.
- `null`, unavailable and not-applicable are not zero.
- Negative values use a clear minus sign and semantic label where needed; accounting parentheses require an approved report standard.
- Refund, void, discount, deposit, paid, balance and net are separate concepts and labels.
- Cash rounding or currency conversion rules come from the shared pricing/payment contract, never UI code.

## 5. Quantity, weight and units

- Display the configured unit (`kg`, `g`, piece, bag, item) with localized label.
- Preserve authoritative precision; do not round weights before pricing calculations.
- Use non-breaking spacing or equivalent between number and unit.
- Estimated values include an explicit `Estimated` label; actual T1/T3/T4 values are not visually conflated with estimates.

## 6. Phone, identifiers and files

- Store phone in approved normalized form; render Cambodia-friendly local display when context allows.
- Customer lists mask phone according to permission and privacy policy.
- Booking, queue, device and audit references use monospaced or distinguishable formatting and are never localized.
- CSV exports are UTF-8 and preserve Khmer text, ISO timestamps and explicit currency columns.

## 7. Test vectors

| Input                            | Expected                                                        |
| -------------------------------- | --------------------------------------------------------------- |
| KHR `1250000`                    | `៛1,250,000`                                                    |
| USD `12.5` authoritative amount  | `$12.50`                                                        |
| Missing amount                   | `Unavailable` or `—` with accessible explanation; never `$0.00` |
| Timestamp `2026-07-26T07:30:00Z` | `26/07/2026 14:30` in `Asia/Phnom_Penh`                         |
| Stale timestamp                  | Absolute time + stale label + last-sync context                 |
| Estimated 3.5 kg                 | `Estimated 3.5 kg` using approved locale number formatting      |

Exact rounding, FX and cash-denomination test vectors remain in the pricing/payment business-rule artifacts and must be referenced rather than duplicated.
