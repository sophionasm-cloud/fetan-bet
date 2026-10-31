# Fetan Bet — Codex Handoff Report

**Date:** 2026-10-31  
**Repository:** `C:\Users\User\Desktop\fetan-bet`  
**Branch:** `main`  
**HEAD:** `3427849` (`GDK`) — matches `origin/main`  
**Local URL:** `http://localhost:3000` (Express server; do **not** use Live Server at `127.0.0.1:5500`)  
**Database:** Neon PostgreSQL, configured through `DATABASE_URL` in `.env`

---

## 1. Executive summary

The Agent + Super Admin workspace is implemented, and the local login blocker is fixed.

The configured database only had migrations `001` and `002`, so `users.username` did not exist. Every login attempt failed with PostgreSQL error `42703` and the API returned `503 SCHEMA_NOT_READY`.

A full JSON backup was taken, migrations `003` and `004` were applied successfully, and the database was verified. The only existing admin (`users.id = 1`) was promoted to `superadmin` by migration `003`; the existing agent (`users.id = 2`) received an agent profile with promo code `FB-0000002` and 25% commission. Login was then confirmed working by the user at `http://localhost:3000`.

`npm run test:static` passes. No wallet, ledger, deposit, withdrawal, or game rows were rewritten by the migrations. No code changes were required for the login fix itself.

After the login fix, the workspace was finished locally: Logout is visible in both the topbar and sidebar and returns directly to the login form, Agent and Super Admin pages fit phone/tablet/laptop/desktop widths without page overflow, and three Super Admin dashboard SQL binding/date-bound bugs were fixed. Those changes are currently uncommitted.

Production is **not fully ready yet**: the Render deployment previously crashed because `JWT_SECRET` was missing or shorter than 32 characters. Render still needs the correct `JWT_SECRET` and `DATABASE_URL`, followed by a redeploy. Nothing was deployed, pushed, or committed during the final fix.

---

## 2. Current verified state

### 2.1 Git state

- `HEAD` = `3427849` (`GDK`)
- `origin/main` = `3427849`
- Branch is `main`, tracking `origin/main`
- The workspace and final polish are present in the working tree but **not committed**.
- Uncommitted changes:
  - `public/workspace.js` - responsive report/chat/stage markup and workspace markup updates
  - `public/app.js` - staff Logout returns directly to `render('login')`
  - `public/dashboard.css` - responsive sidebar/topbar/logout, wrapping filters, chat actions, tables, modals, and stage grid
  - `server.js` - Super Admin dashboard SQL parameter and EAT trend-bound fixes
  - `public/index.html` - added `mobile-web-app-capable` meta tag
  - `locales/en.json` - added `err_SCHEMA_NOT_READY` and `err_SERVICE_UNAVAILABLE`
  - `locales/am.json` - same two keys in Amharic
  - `README.md` - staged change; Git reports it as a binary diff. Review it before committing.
- The login fix itself was database-side; the later workspace polish is application-side.

### 2.2 Database state

- `schema_migrations` now contains:
  - `001_initial_schema.sql`
  - `002_deposit_receipts_and_reviews.sql`
  - `003_agent_referrals_superadmin_settlements.sql`
  - `004_agent_dashboard_referral_notifications.sql`
- Role counts:
  - `user`: 20
  - `agent`: 1
  - `superadmin`: 1
- The only pre-existing admin was `users.id = 1` (phone ending `0000`). Migration `003` changed that account from `admin` to `superadmin` and recorded it in `superadmin_role_bootstrap` (`previous_role = 'admin'`).
- Existing agent `users.id = 2` has:
  - `agent_profiles.promo_code = 'FB-0000002'`
  - `commission_bps = 2500` (25%)
  - `weekly_fee_santim = 0`
  - `migration_backfill = true`
- Current data volume: 22 users, 22 wallets, 28 deposits, 17 withdrawals, 5 support tickets.
- New schema objects exist: `agent_profiles`, `referral_bonuses`, `notifications`, `support_ticket_reads`, `agent_weekly_settlements`, `withdrawal_reviews`, `staff_action_history`, `agent_payout_requests`, `agent_settlement_payments`, and the `agent_weekly_settlement_status` view.
- `users` now has `referred_by_agent_id`, `email`, `username`, and `last_seen_at`.
- `wallets` now has `promo_balance BIGINT NOT NULL DEFAULT 0`.
- No wallet balances, ledger rows, game rounds, deposits, or withdrawals were rewritten by the migrations.

### 2.3 Backup

Before applying migrations:

- Path: `C:\Users\User\AppData\Local\Temp\opencode\fetan-bet-backup-2026-10-31T04-33-40-844Z.json`
- Size: `589,958` bytes
- SHA-256: `6b4d55e37e9093b112b3bf0e5c8933b9f0d939a4fec7f544bb508db31d443c9c`
- Contents: all public table data plus schema metadata (tables, views, columns, indexes, constraints, triggers, functions).

The backup contains password hashes and PII. Keep it private; do not commit or share it.

### 2.4 Login verification

After migration:

- `POST /api/login` with an unknown identifier and any password now returns `400 {"error":"LOGIN"}` — no longer `503 SCHEMA_NOT_READY`.
- `POST /api/login` with `admin` or `superadmin` and a wrong password returns `400 {"error":"LOGIN"}`. This proves the admin/superadmin lookup path and the schema are working.
- `GET /api/me` returns `401` when logged out, which is expected.
- The user confirmed actual login is working after the migration.

Passwords were not changed. Existing users log in with the same credentials as before.

### 2.5 Tests

`npm run test:static` passes:

- `payout.test.js` — integer-santim settlement checks
- `payout-rules.test.js` — payout and RTP invariants
- `road-ui.test.js` — Road Dash result and responsive UI checks
- `scripts/test-db-safety.test.js` — fail-closed test database identity checks
- `operations.test.js` - permissions, 25% commission math, EAT week boundaries, migration invariants

Headless Edge verification completed against the local Express server:

- All Agent and Super Admin pages audited at `320x720`, `390x844`, `768x1024`, and `1024x768`: 60 page/viewport combinations, zero clipped elements, zero document-level horizontal overflow, zero console errors.
- Desktop, laptop, tablet, and phone screenshots checked for both roles.
- Drawer behavior verified: menu opens the sidebar, Escape and scrim close it, body scroll locks while open, and `aria-expanded` updates.
- Topbar Logout and sidebar Logout both clear the session and open the login form directly.
- Phone layout keeps the visible "Logout" label, hides the topbar avatar, and avoids horizontal overflow down to `320px`.
- `node --check` passes for `public/workspace.js`, `public/app.js`, and `server.js`.

Integration tests were **not** run because `TEST_DATABASE_URL` is not configured. Do not claim full integration coverage.

### 2.6 Environment

Local `.env` currently contains only `DATABASE_URL`. It does **not** contain `JWT_SECRET`, `DIRECT_DATABASE_URL`, or `TEST_DATABASE_URL`.

- Local development uses the fallback secret `dev-secret-change-me` from `server.js` because `NODE_ENV` is not `production`.
- The migration runner fell back to `DATABASE_URL` because `DIRECT_DATABASE_URL` was absent. It succeeded, but a direct/unpooled URL is preferable for future migrations.
- Never print, commit, or paste the values of `.env`.

---

## 3. What was implemented and changed

### 3.1 Database migrations

#### `migrations/003_agent_referrals_superadmin_settlements.sql`

This migration extends the existing schema without changing game or wallet logic:

- Expands `users.role` check to `user`, `agent`, `admin`, `superadmin`.
- Creates `superadmin_role_bootstrap` and promotes the earliest existing `admin` to `superadmin`, recording the previous role.
- Adds `users.referred_by_agent_id` and an index for referral lookups.
- Extends `withdrawals.status` to include `paid`.
- Creates `agent_profiles` with:
  - unique case-insensitive promo code
  - contact info
  - weekly fee in santim
  - commission in basis points
  - `migration_backfill` marker
- Backfills existing agents with promo code `FB-<id>` and their phone as contact info.
- Creates `staff_action_history` for sensitive staff actions.
- Adds audit fields to `audit_logs` and `deposit_reviews`.
- Creates `withdrawal_reviews`.
- Creates `agent_payout_requests` with pending/approved/rejected/paid states and a unique per-period guard.
- Creates `agent_weekly_settlements` for immutable weekly commission records.
- Creates `agent_settlement_payments` for append-only fee/commission payments.
- Creates the `agent_weekly_settlement_status` view.
- Extends support ticket statuses with `pending` and `in_progress`.
- Extends support message sender roles to include `superadmin`.
- Adds ledger and support indexes.
- Adds immutable triggers for staff actions, withdrawal reviews, weekly settlements, and settlement payments.

#### `migrations/004_agent_dashboard_referral_notifications.sql`

This migration is additive and supports the Agent/Super Admin workspace:

- Adds `users.email`, `users.username`, and `users.last_seen_at`.
- Adds case-insensitive unique indexes for username and email.
- Adds `wallets.promo_balance` for promotional credits.
- Creates `referral_bonuses` with a unique `referred_user_id` to guarantee the 2,000-credit award happens exactly once.
- Adds `internal_note` to deposits and withdrawals.
- Creates `notifications`.
- Creates `support_ticket_reads` for per-staff unread state.
- Adds `approved_by` and `approved_at` to `agent_payout_requests`.
- Changes the default commission to `2500` bps and upgrades existing `1000` bps profiles to `2500`.
- Adds dashboard/report indexes for deposits, withdrawals, rounds, ledger, and support tickets.

#### Migration runner and rollback

- `scripts/run-migrations.js`:
  - reads `DIRECT_DATABASE_URL` first, then `DATABASE_URL`
  - strips `channel_binding=require`
  - creates `schema_migrations`
  - applies each unapplied `.sql` file in a transaction
  - records the filename in `schema_migrations`
  - skips already-applied files
- `scripts/rollback-003-agent-ops.sql` exists for migration 003, but it is guarded and aborts if operational data would be lost.
- There is no dedicated rollback for 004. Restore from the backup or use Neon point-in-time recovery after review.

### 3.2 Roles, permissions, and reauthentication

`permissions.js` is the single source of truth:

| Role | Permissions |
|---|---|
| `user` | `customer`, `support.own`, `support.reply` |
| `agent` | `agent.workspace`, `support.assigned`, `support.reply` |
| `admin` | `admin.workspace`, `admin.manage`, `support.all`, `support.reply`, `audit.read` |
| `superadmin` | `admin.workspace`, `admin.manage`, `support.all`, `money.decide`, `agents.manage`, `referrals.reassign`, `settlements.manage`, `audit.read`, `support.reply` |

Important security behavior:

- `money.decide` is exclusive to `superadmin`. Deposit/withdrawal approval, rejection, and payout completion are blocked for `admin` and `agent`.
- The shared `/api/agent/deposits/:id/decide` and `/api/superadmin/deposits/:id/decide` routes still exist for compatibility, but both require `money.decide`, so only Super Admin can use them.
- Sensitive Super Admin actions require the acting user's password again through `reauth_password`:
  - deposit/withdrawal approve or reject
  - withdrawal completion
  - commission approve/pay
  - user suspend/reactivate
  - agent create/update/suspend
  - support assignment changes
  - settings/API/AI updates
  - referral reassignment
  - settlement close/pay
  - payout request decisions
- `requireRecentPassword` verifies the password against an active `superadmin` row using bcrypt.
- `auditSensitive` writes before/after values, actor, IP, action, target, reason, and timestamp into `staff_action_history`.
- History tables and settlement records are append-only through database triggers.

Login behavior:

- Login accepts phone, name, username, or email.
- Special aliases `admin` and `superadmin` resolve to staff accounts.
- No existing password was changed by the migrations.
- `GET /api/me` returns the current role and agent profile data where applicable.

### 3.3 Commission engine

`agent-finance.js` implements the business rule:

```text
NGR = settled stakes - gross gaming payouts
commission = max(NGR - carried_loss, 0) * 25%
next_carried_loss = max(carried_loss - NGR, 0)
```

Rules:

- Default rate is `2500` bps (25%).
- Only completed/settled rounds count: `game_rounds.status = 'done'`.
- Refunded rounds are excluded through the `SETTLED_ROUND_SOURCE` query.
- Open, cancelled, refunded, deposit, and withdrawal rows never count.
- Weekly periods use `Africa/Addis_Ababa` (UTC+3):
  - Monday 00:00 EAT through the following Monday 00:00 EAT.
- The same boundaries are used by agent earnings, Super Admin dashboards, reports, and settlement closing.
- Historical settlement rows keep their own stored `commission_bps`.
- Stages: `estimated`, `accrued`, `approved`, `paid`.
- Agents can view stages and submit payout requests; only Super Admin can approve or pay.
- Estimated commission now accounts for carried losses from the most recent closed settlement.
- Weekly donuts always use the current EAT week, regardless of the selected chart range, so their labels remain accurate.

### 3.4 Backend routes

All new staff routes require the existing authenticated session and permission checks.

#### Agent routes

- `GET /api/agent/dashboard` — stats, chart, current-week 25% donut, recent users, support summary
- `GET /api/agent/users` — referred customers with wallet, deposit, game, and ticket context
- `GET /api/agent/users/:id` — referred customer detail
- `GET /api/agent/transactions` — searchable/paginated referral activity with EAT date filtering
- `GET /api/agent/earnings` — current estimate, carried loss, settlement history, payout requests
- `GET /api/agent/referrals` — referral list and activity
- `GET /api/agent/profile` — identity, promo code, referral URL
- `PATCH /api/agent/profile` — update name/email/username/contact info
- `POST /api/agent/payout-requests` — request weekly fee or commission; notifies Super Admin
- `GET /api/agent/tickets` — referred or assigned support tickets
- `GET /api/agent/performance` — agent performance summary
- `GET /api/agent/deposits` — referred deposit requests
- `GET /api/agent/deposits/:id/reviews` — deposit review history

#### Super Admin routes

- `GET /api/superadmin/dashboard` — five stat cards, Agent P&L bars, current-week 25% donut, pending previews, notifications, support summary
- `GET /api/superadmin/agent-performance` — agent performance tabs/table
- `GET /api/superadmin/deposits` and `GET /api/superadmin/deposits/:id`
- `GET /api/superadmin/withdrawals` and `GET /api/superadmin/withdrawals/:id`
- `POST /api/superadmin/deposits/:id/decide` — approve/reject with reauth, internal note, customer notification
- `POST /api/superadmin/withdrawals/:id/decide` — approve/reject with reauth, internal note, customer notification
- `POST /api/superadmin/withdrawals/:id/complete` — confirm external payout reference
- `GET /api/superadmin/users` and `GET/PATCH /api/superadmin/users/:id`
- `POST /api/superadmin/users/:id/reassign-agent` — Super Admin-only attribution change
- `GET /api/superadmin/agents`, `POST /api/superadmin/agents`, `PATCH /api/superadmin/agents/:id`
- `GET /api/superadmin/commissions` — estimated and settled commission review
- `POST /api/superadmin/commissions/:id/approve`
- `POST /api/superadmin/commissions/:id/pay`
- `GET /api/superadmin/reports` — date-range financial/agent report
- `GET/PATCH /api/superadmin/settings`
- `GET /api/superadmin/agent-report`
- `GET /api/superadmin/agents/:id/transactions`
- `POST /api/superadmin/settlements/close-previous-week`
- `POST /api/superadmin/settlements/:id/pay`
- `GET /api/superadmin/settlements`
- `GET /api/superadmin/payout-requests`
- `POST /api/superadmin/payout-requests/:id/decide`

#### Notifications and support

- `GET /api/notifications`
- `POST /api/notifications/:id/read`
- `POST /api/notifications/read-all`
- `GET /api/notifications/unread-count`
- `GET /api/support`
- `POST /api/support`
- `GET /api/support/ticket/:id`
- `POST /api/support/ticket/:id/reply`
- `POST /api/support/ticket/:id/escalate`
- `POST /api/support/ticket/:id/status`
- `GET /api/agent/tickets`
- `GET /api/admin/tickets`

Support behavior:

- Tickets from referred customers route to their agent.
- Unassigned or escalated tickets route to Super Admin.
- Agents can see tickets for their referred customers **or** tickets assigned to them.
- Replies create notifications and unread badges.
- Support reads are tracked per staff user in `support_ticket_reads`.
- Agent escalation notifies Super Admin while preserving agent visibility.

#### Auth and customer routes (existing, extended)

- `POST /api/register` — accepts optional promo code, attributes the customer, awards 2,000 promotional credits exactly once, notifies the agent
- `POST /api/login` — phone/name/username/email plus admin aliases
- `POST /api/password-reset-request` — opens a support ticket for review
- `POST /api/logout`
- `GET /api/me`
- `POST /api/lang`
- Existing customer deposit, withdrawal, transaction, and game routes remain unchanged.
- Game odds, RTP, payouts, wallet debit/credit logic, and ledger behavior were not modified.

### 3.5 Promotional credits

- Registration with a valid, active promo code permanently attributes the customer to the agent.
- The referred customer receives exactly **2,000 promotional credits** (`200000` santim).
- The unique `referral_bonuses.referred_user_id` constraint is the exactly-once guard.
- Promotional credits live in `wallets.promo_balance`.
- They are **separate from withdrawable `wallets.balance`** and are not written to the ledger.
- Current behavior is display-only: promo credits do not fund game stakes. The game wallet flow is unchanged.
- Registering without a promo code creates no attribution and no bonus.
- Invalid or inactive promo codes are rejected rather than silently ignored.
- `?promo=` links prefill the registration field.

### 3.6 Frontend

- `public/workspace.js`
  - Dark premium Agent/Super Admin shell.
  - Agent nav: Dashboard, My Users, Transactions, Support Chat, My Earnings, Profile, Logout.
  - Super Admin nav: Dashboard, Users, Agents, Deposit Requests, Withdrawal Requests, Agent Management, Reports, Support, Settings, Logout.
  - Dashboard charts, current-week donuts, tables, filters, modals, reauth prompts, notification menu, support inbox, agent management, reports with client-side CSV export, settings.
  - Responsive report filters and chat action bars; commission stages use a responsive grid instead of a clipped horizontal strip.
  - Accessible drawer state (`aria-expanded`, `aria-controls`), Escape/scrim close, and body scroll locking.
- `public/app.js`
  - Auth modal with login/register.
  - Inline Forgot Password form instead of `prompt()`.
  - Promo prefill for guest registration and `?promo=` links.
  - Staff routing to the workspace for `agent`/`superadmin`.
  - Staff Logout returns directly to the login form.
- `public/dashboard.css`
  - Workspace layout, cards, sidebar, tables, badges, responsive styles.
  - Added missing CSS variables for borders/text tones.
  - Sidebar drawer breakpoint at `1100px`; desktop sidebar overrides follow the base sidebar rule.
  - Responsive topbar, Logout, stats, promo strip, page headers, tables, notifications, modals, report filters, and chat actions.
- `server.js`
  - Super Admin dashboard corrected to use matching SQL bind arrays for commission, previous commission, agent bars, deposits, and withdrawals.
  - Previous-commission placeholders corrected to `$1/$2`.
  - EAT week start converted to a `Date` before `.getTime()` in trend calculations.
- `public/index.html`
  - Loads workspace assets and Telegram WebApp script.
  - Added `mobile-web-app-capable` meta tag (uncommitted).
- `locales/en.json` and `locales/am.json`
  - Workspace labels and errors.
  - Added `err_SCHEMA_NOT_READY` and `err_SERVICE_UNAVAILABLE` (uncommitted).
  - Existing `err_SETTLEMENT_GAP` translation.

### 3.7 Tests and documentation

- `operations.test.js` — role permissions, commission math, EAT boundaries, migration invariants.
- `payout.test.js`, `payout-rules.test.js` — payout/RTP invariants.
- `road-ui.test.js` — Road Dash responsive UI checks.
- `scripts/test-db-safety.test.js` — test DB identity safety.
- `scripts/run-integration-tests.js` — integration suite requiring `TEST_DATABASE_URL`.
- `AGENT_SUPERADMIN_WORKSPACE.md` — architecture, schema, routes, commission, permissions, deployment, rollback notes. **Its deployment section is now stale**: it says to apply only 004, warns against production, and says to create the first Super Admin through bootstrap. In reality 003+004 are applied and the admin was promoted. Update this document before using it as an operational runbook.

---

## 4. Chronology of the final fix

1. Login returned `503 SCHEMA_NOT_READY`.
2. Server logs showed PostgreSQL `42703: column "username" does not exist`.
3. Read-only database inspection found only migrations `001` and `002`; `users` had only `id, name, phone, password_hash, role, lang, status, created_at`.
4. Confirmed this was a missing-schema issue, not a JWT or password issue.
5. Created a full JSON backup of all public tables and schema metadata.
6. Received explicit user authorization to modify the configured Neon database.
7. Ran `node scripts/run-migrations.js`.
8. Migration `003` applied successfully; migration `004` applied successfully.
9. Verified:
   - all four migration names in `schema_migrations`
   - admin id 1 promoted to superadmin, bootstrap record present
   - agent profile `FB-0000002`, 2500 bps, migration backfill
   - new tables/columns/indexes/constraints
   - role counts
10. Tested login paths; invalid credentials now return `400 LOGIN`, not `503`.
11. User confirmed login is working.
12. Ran `npm run test:static`; all checks passed.
13. Removed temporary inspection scripts from the repository.

No commit, push, deploy, or production environment change was performed during this fix.

---

## 5. Production / Render status

The Render deployment of commit `3427849` previously crashed with:

```text
JWT_SECRET must be configured with at least 32 characters in production.
```

`render.yaml` declares:

- `JWT_SECRET` with `generateValue: true`
- `DATABASE_URL` with `sync: false`

However, the deployed service did not have a valid `JWT_SECRET` at startup. The Render dashboard must be checked.

Required production steps:

1. Open Render → service `fetan-bet` → Environment.
2. Set `JWT_SECRET` to a random value of at least 32 characters (use Render's Generate button).
3. Set `DATABASE_URL` to the correct Neon connection string.
4. Confirm that URL points to the database that now has migrations `003` and `004`.
5. Save and redeploy commit `3427849`.
6. Confirm the startup log shows `Fetan Bet running at ...` and no JWT/schema error.

If Render uses a different database, take a fresh backup and apply migrations there before deploying. Do not paste secrets into chat, tickets, or source control.

No production deploy was performed by the assistant because it requires explicit user authorization and Render dashboard access.

---

## 6. Open items and recommended next steps

### P0 — Production

- Configure Render `JWT_SECRET` and `DATABASE_URL`.
- Redeploy and confirm startup.
- Smoke test production login for `superadmin` and `agent`.

### P1 — Repository hygiene

- Review and commit the uncommitted locale/index changes if approved.
- Review the staged `README.md` binary diff before committing.
- Update `AGENT_SUPERADMIN_WORKSPACE.md` deployment/schema instructions to match the applied state.
- Do not commit `.env`, the backup JSON, or any secret.

### P2 — Database and testing

- Add `DIRECT_DATABASE_URL` (unpooled Neon URL) to local `.env` for future migrations.
- Add a dedicated `TEST_DATABASE_URL` pointing to an isolated/disposable Neon branch.
- Run `npm run test:integration:check` and `npm test` only against that isolated database.
- Do not use the production database for integration tests.

### P2 — End-to-end smoke test checklist

- Agent login and referral URL/promo code.
- Customer registration with promo code; confirm 2,000 promo credits appear exactly once.
- Confirm promo credits are separate from withdrawable balance and do not fund stakes.
- Super Admin deposit approval/rejection with reauthentication.
- Super Admin withdrawal approval, completion, and rejection with reauthentication.
- Agent cannot access `money.decide` routes (expect `403`).
- Commission estimate with carried loss.
- Close a completed week and confirm settlement is immutable.
- Approve/pay commission with reauthentication.
- Support routing: referred customer → agent; unassigned/escalated → Super Admin.
- Support reply notifications and unread badges.
- Reports date range and CSV export.
- Settings update with reauthentication.
- Responsive/mobile layout.

### P3 — Long term

- Add a dedicated rollback for migration 004 or document restore-only rollback.
- Consider making migrations fully idempotent where safe.
- Review rate limits, session expiry, and secret rotation.
- Keep the backup and restore procedure documented.

---

## 7. Invariants and guardrails

Do not break these:

- Game odds, RTP, payout calculations, wallet debit/credit flow, and ledger behavior are unchanged and must remain unchanged unless explicitly scoped.
- Promotional credits are separate from withdrawable funds and are currently display-only.
- Only `superadmin` may approve/reject deposits or withdrawals, complete payouts, approve/pay commissions, manage agents, reassign referrals, close settlements, or change sensitive settings.
- Sensitive actions require password reauthentication and append-only audit history.
- Commission is 25% of positive settled NGR after carried losses, using `Africa/Addis_Ababa` Monday boundaries.
- Only settled `game_rounds` count. Refunds, open rounds, deposits, and withdrawals do not count.
- The 2,000 promotional credit award is exactly once per referred user.
- Dashboards must show real database figures, never fabricated values.
- Do not rerun migrations against production without a backup and authorization.
- Do not expose `.env` values, database URLs, JWT secrets, password hashes, or the backup contents.

---

## 8. Useful commands

```powershell
# Run the app locally (Express, port 3000)
npm start

# Static/unit checks (no database required)
npm run test:static

# Migration runner (already applied; will skip 001-004)
node scripts/run-migrations.js

# Integration safety check (requires TEST_DATABASE_URL)
npm run test:integration:check

# Full integration suite (requires isolated TEST_DATABASE_URL)
npm test

# Current repository state
git status --short
git log --oneline -5
```

Do not use `python -m http.server`, Live Server, or `127.0.0.1:5500` for this app; API routes depend on Express at `http://localhost:3000`.

---

## 9. File map

| Path | Purpose | Status |
|---|---|---|
| `server.js` | Express API, auth, dashboards, support, commissions, settlements | Tracked; uncommitted Super Admin dashboard fixes |
| `permissions.js` | Role-to-permission matrix | Tracked |
| `agent-finance.js` | 25% commission, carried loss, EAT week boundaries | Tracked |
| `db.js` | PostgreSQL pool, transactions, user creation, seed | Tracked |
| `migrations/003_agent_referrals_superadmin_settlements.sql` | Agent/referral/settlement schema and admin promotion | Applied |
| `migrations/004_agent_dashboard_referral_notifications.sql` | Identity, promo, notifications, support reads, indexes | Applied |
| `scripts/run-migrations.js` | Migration runner | Tracked |
| `scripts/rollback-003-agent-ops.sql` | Guarded rollback for 003 | Tracked |
| `scripts/run-integration-tests.js` | Integration test runner | Tracked |
| `scripts/test-db-safety.js` | Test DB safety checks | Tracked |
| `public/workspace.js` | Agent/Super Admin UI | Tracked; uncommitted responsive polish |
| `public/app.js` | Auth, promo prefill, staff routing, staff logout redirect | Tracked; uncommitted logout fix |
| `public/dashboard.css` | Workspace styling | Tracked; uncommitted responsive polish |
| `public/index.html` | App shell, workspace assets, PWA meta | Uncommitted meta tag |
| `locales/en.json`, `locales/am.json` | English/Amharic labels and errors | Uncommitted schema/service error keys |
| `operations.test.js` | Permissions/commission/migration tests | Tracked |
| `payout.test.js`, `payout-rules.test.js` | Payout/RTP tests | Tracked |
| `road-ui.test.js` | Responsive Road Dash tests | Tracked |
| `AGENT_SUPERADMIN_WORKSPACE.md` | Workspace documentation | Tracked; deployment section stale |
| `render.yaml` | Render blueprint | Tracked |
| `.env.example` | Environment variable documentation | Tracked |

---

## 10. Suggested prompt for Codex

```text
You are taking over the Fetan Bet project at C:\Users\User\Desktop\fetan-bet.

Read docs/CODEX_HANDOFF.md first. It contains the full implementation and
verification history.

Current state:
- HEAD is 3427849 (matches origin/main); final workspace polish is uncommitted.
- Agent + Super Admin workspace is implemented.
- DB migrations 001, 002, 003, 004 are applied to the configured Neon database.
- The only admin (users.id=1) was promoted to superadmin by migration 003.
- Agent users.id=2 has promo code FB-0000002 and 25% commission.
- Local login/logout at http://localhost:3000 works for user, agent, and superadmin.
- Responsive UI audit passes 60 page/viewport combinations from 320px to 1366px.
- npm run test:static passes.
- Integration tests have not run because TEST_DATABASE_URL is missing.
- Render still needs JWT_SECRET and DATABASE_URL configured, then a redeploy.

Do not:
- change game odds, RTP, payout logic, wallet balances, or ledger behavior
- rerun migrations without a backup and explicit approval
- expose .env values, database URLs, JWT secrets, password hashes, or backups
- commit/push/deploy without user approval

First tasks:
1. Review the uncommitted locale/index changes and staged README.
2. Update the stale deployment section of AGENT_SUPERADMIN_WORKSPACE.md.
3. Help set Render JWT_SECRET and DATABASE_URL, redeploy, and verify startup.
4. After authorization, run the smoke-test checklist in the handoff report.
```

---

**Bottom line:** local development is working and the database schema is ready. The remaining release blocker is Render environment configuration and redeployment, not application code.
