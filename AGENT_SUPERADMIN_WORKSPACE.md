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

## Testing

Static tests: `npm run test:static` (pure unit checks; no production DB). Integration tests require `TEST_DATABASE_URL` and are not runnable in this environment.

Deployment steps:
1. Apply migration 004 to a reviewed staging database.
2. Deploy code; existing `server.js` mounts all new routes automatically.
3. Create the first Super Admin via existing bootstrap/seed process; create agents through Super Admin > Agent Management.
4. Agents share promo links; customers registering with a promo code receive exactly one 2,000-credit promotional balance, separate from withdrawable funds.
