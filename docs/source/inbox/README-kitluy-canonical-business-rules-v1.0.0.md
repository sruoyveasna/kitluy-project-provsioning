# KitLuy Canonical Business Rules and State Machines Package

**Version:** v1.0.0  
**Date:** 2026-07-26  
**Status:** Canonical target contracts; not implementation evidence

This package contains ten governed Markdown contracts and a machine-readable validation manifest. Each rule includes all fourteen required fields requested by the project owner.

## Package contents

| Document                                                   | Rules | Bytes |
| ---------------------------------------------------------- | ----: | ----: |
| `kitluy-core-business-rules-v1.0.0.md`                     |    10 | 23051 |
| `kitluy-laundry-state-machines-v1.0.0.md`                  |     8 | 19636 |
| `kitluy-transaction-and-booking-lifecycle-v1.0.0.md`       |     8 | 18463 |
| `kitluy-payment-refund-and-void-rules-v1.0.0.md`           |     9 | 19289 |
| `kitluy-inventory-movement-and-cost-rules-v1.0.0.md`       |     9 | 19342 |
| `kitluy-finance-subledger-and-reconciliation-v1.0.0.md`    |     9 | 19096 |
| `kitluy-customer-identity-consent-and-privacy-v1.0.0.md`   |     8 | 18739 |
| `kitluy-pricing-discount-tax-and-rounding-rules-v1.0.0.md` |     8 | 17968 |
| `kitluy-business-date-shift-and-close-rules-v1.0.0.md`     |     8 | 16818 |
| `kitluy-configuration-publication-and-rollback-v1.0.0.md`  |     9 | 19186 |

**Total canonical rules:** 86

## Governing safeguards

- Digital Store is the control plane; physical Locations are offline-capable edge environments.
- Store Hub remains the local operational authority after provisioning.
- Finalized transaction, payment, inventory, finance and audit records are append-only.
- Corrections use linked compensating records.
- Unknown tax, legal, commercial, provider and threshold values are not guessed.
- Planning documents do not constitute implementation evidence.
