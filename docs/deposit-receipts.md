# Deposit receipt storage and rollout

The application is a virtual-credit demo. Its seeded payment providers/instructions are demo-only; there is no live bank or payment-provider integration. Never request or send real funds based on this application. A receipt is evidence for a human review and does not itself change a wallet.

## Storage

Receipt files are written outside `public/` to a private directory with random server-generated names and restrictive file permissions. Only a receipt key is stored on the deposit row. The authenticated receipt route checks deposit ownership for customers and the existing `agent`/`admin` roles for staff before serving a no-store image response.

For local development, the default directory is `private-receipts/`. Set `RECEIPT_STORAGE_DIR` to an absolute private directory when the service runs elsewhere. This directory must not be mounted as static content or served by a web server.

The current Render blueprint has no persistent disk and its free service filesystem is ephemeral. Receipt files can disappear on restart/deploy there. Before enabling uploads for persistent use on Render, attach a private persistent disk and set `RECEIPT_STORAGE_DIR` to its mount path, or configure a private object-storage adapter. No such storage has been configured in this project, so persistent production receipt retention is not yet available.

## Database rollout

`migrations/002_deposit_receipts_and_reviews.sql` adds a nullable receipt key and the review-history table without changing existing deposit statuses or ledger structures. Review the SQL and apply it through the existing migration process in a non-production environment first. This task did not connect to Neon or run migrations. The application routes using receipt metadata require migration 002 to be applied before release.

## Review and credit

Approval remains inside the existing locked deposit transaction and `postLedger` helper. The server rejects approval unless all five verification fields are explicitly checked, including independent verification in authorized bank/provider records. Review notes/actions are recorded in `deposit_reviews` and `audit_logs`. Since no provider API exists, staff must check payment records outside this demo. Agents continue to use the project's existing shared agent queue and permissions; this code does not add assignment-scoped roles.
