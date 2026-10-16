# Changelog

## 1.2.0
* Payments: charge-ID idempotency, strict pre-checkout/payment validation, rejected-payment records, crash reconciliation, update-id dedup, `/paysupport`.
* Refund ledger, `/charges`, `/refund`, `/revoke`; refunds are idempotent and keyed.
* Multi-channel purchases are all-or-nothing and tied to one payment.
* Durable job queue (removal + link revocation) with backoff and dead-job alerts; `/jobs`.
* Invite links expire; expired links revoked; "Access links" button for subscribers.
* Channel permission checks; confirmations on destructive actions; audit coverage.
* Roles: Super Admin, Moderator, Support, Read-only.
* Member activity log (`/memberlog`) with explicit coverage notice.
* Precise statistics (Stars vs UPI vs wallet, per-channel split of bundles) - see docs/METRICS.md.
* Startup config validation, log redaction, jittered 429 handling, wizard timeouts, pagination, restore-test script, automated tests (`npm test`).
* Fix: channel buttons (edit price/duration/toggle/delete) were swallowed by the generic channel-detail handler; patterns are now anchored.
