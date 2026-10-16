# Statistics: exact definitions

Every number in the admin revenue screen and panel header comes from
`src/services/stats.js`. Money sources are never mixed.

| Metric | Definition |
|---|---|
| Stars received (`starsGross`) | Telegram Stars payments in status `credited`, `refunding` or `refunded`, counted on the payment date. Rejected and not-yet-credited payments are not counted. |
| Stars refunded (`starsRefunded`) | Completed `stars` refunds in the refund ledger, counted on the refund date. |
| Net Stars (`starsNet`) | Stars received minus Stars refunded **within the selected period** (cash-flow view; a refund can fall into a later period than its payment). |
| UPI credited | Wallet credit from approved UPI payments. It is **not** Stars revenue and is shown separately. |
| Bonus / referral | Wallet credits given away. Not revenue. |
| Plan sales (`planSales`) | Wallet value spent on plans and channel unlocks (new purchases + renewals). |
| Wallet refunds | Wallet value credited back (failed delivery, link-misuse refunds). |
| Net plan sales | Plan sales minus wallet refunds. |
| New purchases / renewals | Count of purchases vs. `plan_renew` / `plan_auto_renew` charges. |
| By channel | Each purchase is split **equally** across the channels the plan contained at purchase time (to the cent, remainder to the first channels). A 3-channel bundle is therefore counted once in the total, never once per channel. Old purchases without stored channel IDs use the plan's current channels, otherwise "Unknown". |
| Top sellers | Per plan title: number of purchases and Stars spent. |
| New users | Users whose first visit falls in the period. |

Days are calendar days in the shop timezone (`BOT_TIMEZONE`). "All time" uses every record.
Payments saved by older versions have no status and are treated as `credited`.

Stars received and plan sales are different things: customers first buy Stars
credit (wallet), then spend the wallet on plans. Use "Stars received / net" for
what actually arrived from Telegram and "Plan sales" for what customers bought.
