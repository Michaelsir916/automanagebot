# Reliability, payment-safety and access-control features (v1.2.0)

This document describes what the code actually does, and its limits.

## 1. Payment safety (`src/services/payments.js`)

* **Pre-checkout** only answers yes/no (currency must be `XTR`, amount a whole
  number 1-10000, payload `recharge_<userId>_<timestamp>`, payer must equal the
  user in the payload, banned users refused). It never credits anything.
* **Successful payment** is keyed by Telegram's `telegram_payment_charge_id` in
  `data/payments.json`. Lifecycle: `received → credited`, or `rejected`,
  `refunding → refunded`. A re-delivered update, a restart or two concurrent
  deliveries credit the wallet once.
* A payment that arrives but fails validation is stored as `rejected`, is
  **not** credited, and all admins are alerted with the charge ID.
* If the process dies between "payment stored" and "wallet credited", the
  payment stays `received`; the reconciler (at boot and about once a minute)
  finishes it. The recharge and its bonus are each added once.
* **Update dedup** (`src/utils/updateDedup.js`): an update id is recorded only
  after its handlers finished successfully, so a crash mid-payment is
  processed again after restart.
* `/paysupport` explains the support flow and opens the existing ticket flow.

## 2. Refunds (`src/services/refunds.js`, ledger `data/refunds.json`)

* Refunds are separate records. The payment keeps its history and changes only
  its status.
* `/charges <userId>` lists payment IDs; `/refund <chargeId>` (permission
  `refund`, with confirmation) calls Telegram `refundStarPayment`.
* **Policy:** the wallet value that payment produced (recharge + bonus) is taken
  back first. If the user already spent it, the refund is refused. A delivered
  subscription is **not** revoked automatically; use `/revoke <userId>`.
* A permanent Telegram error restores the wallet. A timeout leaves the refund
  `pending` and retries it; Telegram answering `CHARGE_ALREADY_REFUNDED` is
  treated as success.
* Wallet-credit refunds (failed delivery, misuse refund button) are keyed
  (`purchase:<txn>` / `link:<id>`) so they can only be paid once.

## 3. Multi-channel purchases

One wallet charge creates one subscription record per channel, all sharing a
`groupId` and the paying transaction (`purchaseTxnId`, `pricePaid`). Delivery
is all-or-nothing: if any channel fails, links already created are revoked,
nothing is stored, and the user is refunded once. The bundle price is spread
over its links, so a per-link misuse refund cannot exceed the price.

## 4. Durable jobs (`src/db/jobs.js`, `src/jobs/jobRunner.js`)

Member removal and link revocation are queued in `data/jobs.json` and survive
restarts. Retries use exponential backoff with jitter (30 s up to 6 h) for
`JOB_MAX_ATTEMPTS` attempts, then the job is `dead` and admins are alerted once.
`/jobs` shows the queue; super admins can retry dead jobs.

Before removing someone the job checks the real state: not a member / left →
done; administrator or creator → never touched; renewed meanwhile → skipped;
banned by an admin → left banned. Removal is ban + unban (`only_if_banned`) so a
renewing user can join again. Expiry queues the jobs first and marks the
subscription expired second, so a crash cannot lose a removal.

## 5. Invite links

Links are join-request links owned by one user and now expire after
`LINK_EXPIRY_HOURS` (also enforced by Telegram). Expired pending links are
revoked automatically. Active subscribers can press **Access links** in My
Subscriptions to get fresh links. If a freshly created link cannot be stored,
it is revoked at once.

## 6. Channels

Adding a channel verifies the bot is an administrator with *invite users via
link* and *ban users*, and says exactly what is missing. Channel detail has a
**Check bot permissions** button. Deleting a channel/plan, banning a user,
removing an admin, `/refund` and `/revoke` all ask for confirmation.

## 7. Roles and audit

Roles: Super Admin (all), Moderator, Support, Read-only (stats and payments
only). Admins from `ADMIN_IDS` are always Super Admins. Sensitive actions are
written to the audit log (admin changes, refunds, revokes, bans, wallet
adjustments, channel/plan edits, manual links).

## 8. Membership history (`/memberlog`)

Joins, leaves, removals and bans seen through `chat_member` updates are stored
in `data/membership_events.json` (capped at 20,000). **Coverage limits:** the
Bot API cannot list existing members or replay history, so nothing before the
first recorded event is known, events are only seen while the bot runs and is
a channel admin, and the report always prints the "observed since" date. The
current member count is read live from Telegram.

## 9. Operations

* `src/configValidate.js`: startup refuses to run with a malformed token, bad
  admin IDs or invalid numbers/timezone, and prints every problem at once.
* Logs never contain bot tokens or invite links (`src/utils/redact.js`).
* Telegram 429 `retry_after` is honoured and never shortened; other retries use
  jittered backoff.
* Admin wizards expire after `STATE_TTL_MINUTES`.
* Long lists (bans, removed members, payments) are paginated.
* `npm run restore-test` unpacks the newest backup into a temp folder and
  verifies every file; live data is untouched.

## Known limitations

* Data is still JSON files on one server: no multi-process safety and no
  database transactions. Run exactly one bot process. Writes are atomic per
  file, not across files; the idempotency keys and reconcilers above exist
  because of this.
* Telegram Stars refund API (`refundStarPayment`) and `chat_member` behaviour
  were implemented from the Bot API as known at development time and **not
  tested against real Telegram** (no network was available). Test a small
  payment, refund and expiry on a test channel first.
* The bot's own Stars balance / transaction-history sync is not implemented.
* A user who already has an active single-channel subscription and buys a
  bundle containing the same channel has that channel's record replaced by the
  newer one (existing behaviour, unchanged).
* A failure while writing the subscription records of a bundle half-way (disk
  error) is rolled back for links but not for already-written subscription rows.
