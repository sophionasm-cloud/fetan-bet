# Fetan Bet — Agent & Super Admin Workspace

Additive extension of the existing Express/PostgreSQL app. No game odds, RTP, payout, wallet or ledger logic was changed.

## Schema (apply before using the UI/API)

Migration `migrations/004_agent_dashboard_referral_notifications.sql` is additive only. Review and back up the target database first, then apply to a reviewed non-production database:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/004_agent_dashboard_referral_notifications.sql
```

Do NOT run migrations against the production `DATABASE_URL` from this environment. There is no local PostgreSQL/docker/psql available, so integration tests cannot be run locally without `TEST_DATABASE_URL`; static tests are run with `npm run test:static`.

Changes:
- `users.email`, `users.username`, `users.last_seen_at` + case-insensitive unique indexes
- `wallets.promo_balance` (2,000 credit referral bonus, separate from withdrawable balance)
- `referral_bonuses` (unique `referred_user_id`, exactly-once 200000 santim award)
- `deposits.internal_note`, `withdrawals.internal_note`
- `notifications`, `support_ticket_reads`
- `agent_payout_requests.approved_by / approved_at`
- Agent commission default 2500 bps (25%); existing `1000` profiles migrated to `2500`

## New backend routes

All new staff routes are under `/api/agent/...` or `/api/superadmin/...` and require the existing auth session.

Agent (role `agent`):
- `GET /api/agent/dashboard` — 4 stats, profit chart (Daily/Weekly/Monthly), 25% donut, recent users, live support summary
- `GET /api/agent/users` + `GET /api/agent/users/:id` — referred customers with wallets, deposits, games, tickets
- `GET /api/agent/transactions` — searchable/paginated referral activity
- `GET /api/agent/earnings` — estimated/accrued/approved/paid commission stages, payout requests
- `GET/PATCH /api/agent/profile` — identity, email/username, referral URL
- `POST /api/agent/payout-requests` — request weekly fee/commission (notifies Super Admin)

Super Admin (role `superadmin`; only role allowed to approve/reject deposits/withdrawals):
- `GET /api/superadmin/dashboard` — 5 stat cards, Agent P&L weekly bars, 25% weekly-cut donut, pending deposit/withdrawal preview, live notifications
- `GET /api/superadmin/agent-performance` — Agent Performance tabs/table
- `GET /api/superadmin/deposits` + `GET /api/superadmin/deposits/:id` — read-only approval-center list
- `GET /api/superadmin/withdrawals` + `GET /api/superadmin/withdrawals/:id`
- `POST /api/superadmin/deposits/:id/decide` and `/api/superadmin/withdrawals/:id/decide` — approve/reject with reauth, internal notes, customer notification
- `POST /api/superadmin/withdrawals/:id/complete` — confirm external payout reference
- `GET /api/superadmin/users` + `GET/PATCH /api/superadmin/users/:id` — user directory and suspend/reactivate
- `POST /api/superadmin/users/:id/reassign-agent` — Super Admin-only attribution change
- `GET /api/superadmin/agents` + `POST/PATCH` — create/edit agents, username/email/referral URL/status, notifies new agents
- `GET /api/superadmin/commissions` + `/:id/approve`, `/:id/pay` — commission review stages (estimated → accrued → approved → paid)
- `GET /api/superadmin/reports` — date-range financial/agent report with daily trend and CSV export
- `GET/PATCH /api/superadmin/settings` — platform/support/AI settings (reauth required)

Notifications/support:
- `GET /api/notifications`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`, `GET /api/notifications/unread-count`
- Support ticket replies mark reads, notify assigned agent/Super Admin or customer, include unread counts and online status
- `/api/support/ticket/:id/escalate` added

Frontend:
- `public/dashboard.css` — dark premium workspace styles
- `public/workspace.js` — Agent/Super Admin shell with sidebar order exactly:
  - Agent: Dashboard, My Users, Transactions, Support Chat, My Earnings, Profile, Logout
  - Super Admin: Dashboard, Users, Agents, Deposit Requests, Withdrawal Requests, Agent Management, Reports, Support, Settings, Logout
- Wired into `public/index.html`; staff roles mount `FetanWorkspace` instead of customer views.

## Commission rules (25%, Africa/Addis_Ababa)

Commission is calculated only from **settled rounds** (`game_rounds.status = 'done'`), never from open rounds, cancelled rounds, refunds, deposits or withdrawals:

```
net gaming revenue (NGR) = settled stakes − gross gaming payouts
commission              = max(NGR, 0) × 25%
```

- Weekly periods use the fixed **UTC+3 (Africa/Addis_Ababa)** boundary. Weeks start Monday 00:00 EAT and end Sunday 23:59:59.999 EAT; the same boundaries are used by agent earnings, Super Admin dashboards and reports.
- Per-round attribution uses the immutable settlement records, so a round is counted once even if a payout is retried or reviewed later.
- Stages: `estimated` (current open week), `accrued` (closed week not yet approved), `approved`, `paid`.
- Only **Super Admin** can approve or mark commission as paid. Agents can view stages and submit a weekly payout request; they cannot alter amounts or statuses.
- Commission default is `2500` bps (25%). Migration 004 upgrades existing `1000` bps profiles; Super Admin can set a different rate per agent in Agent Management.

## Permissions and reauthentication

- `money.decide` (deposit/withdrawal approve/reject, transfer completion) is **exclusive to Super Admin**. Agents receive `403` from these routes and have no UI action to change money status.
- Agents can see only their own referred users, transactions, earnings and assigned support tickets.
- Sensitive Super Admin actions require the acting admin's password again via the in-app reauth modal (`reauth_password`): deposit/withdrawal decisions, commission approve/pay, user suspend/reactivate, agent suspend/reactivate, support assignment changes, and settings updates.
- Support tickets from referred customers route to their agent. Unassigned or escalated customers route to Super Admin. Replies create notifications and unread badges for the correct audience.

## Promotional credits

- Registration accepts an optional promo code (`?promo=` links prefill it). A valid, active code permanently attributes the customer to that agent and awards **2,000 promotional credits exactly once**.
- Registering without a promo code creates no attribution and no bonus. Inactive codes are rejected rather than silently ignored.
- Promotional credits are stored in `wallets.promo_balance` and are **separate from the withdrawable `wallets.balance`**. They are displayed in the customer wallet as non-withdrawable promotional credits and are not written to the ledger.
- Current behavior: promo credits are display-only; they do **not** fund game stakes. The game wallet debit flow is unchanged. If promo credits should become playable, that requires a separate product decision and a scoped wallet change.

## Testing

```bash
# Fast static/unit checks (no database required)
npm run test:static

# Integration suite against an isolated, disposable database only
# Requires TEST_DATABASE_URL; never point this at production.
npm run test:integration:check   # validates DB safety and configuration
npm test                         # runs the isolated integration suite
```

Static tests currently cover payout/RTP invariants, responsive Road Dash UI, DB safety guards, permissions, 25% commission math, EAT week boundaries and migration invariants.

## Deployment steps

1. Back up the target database and apply migration `004` to a reviewed **staging** database first:
   ```bash
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/004_agent_dashboard_referral_notifications.sql
   ```
2. Deploy the code. Existing `server.js` mounts all new routes automatically; no separate service is required.
3. Create the first Super Admin through the existing bootstrap/seed process, then create agents via **Super Admin → Agent Management**.
4. Existing `admin` accounts continue to use the legacy admin view. `agent` and `superadmin` accounts use the new workspace.
5. Smoke test: agent login and referral link, promo registration (bonus appears once), deposit/withdrawal approval with reauth, weekly commission stages, support routing, and notification unread badges.

## Rollback notes

- Code rollback is safe: all new tables/columns are additive and unused by legacy paths.
- Do not drop the new tables/columns in production without a backup. If a full schema rollback is required, reverse migration 004 only after confirming no new data must be retained.
- Game odds, RTP, payout logic, wallet balances and ledger flows were not changed by this work.
