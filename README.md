# Pharmacy Accounts

Daily entry happens on `/dashboard`. Each saved amount is permanent for storekeepers; they can add more entries until the day's report is submitted. Submission closes the forms and unlocks `/summary`. The next dashboard day starts at midnight in `Asia/Dhaka`; earlier entries remain in history.

Read-only history is available at `/cash-sales`, `/credit-recovery`, `/supplier`, `/local-supplier`, `/overhead-cost`, and `/conveyance`. Credit and supplier pages have name filters. Totals cover all matching records, including records on other pages.

## Database setup

For an existing project with migrations 001–004 applied, run the contents of `supabase/migrations/005_entry_history_and_cash_sales.sql` **once** in the Supabase SQL Editor before using this version. For a new project, apply all migrations in filename order.

Migration 005 preserves each existing cash-sales daily total as a "Previous daily total" history row. The old implementation overwrote amounts, so individual earlier cash entries and their exact timestamps cannot be reconstructed. New cash entries have their own database timestamps. Existing administrator changes to a cash total are recorded as adjustments.

## Local development and checks

```sh
npm install
npm run dev
npm test
npm run test:pages
npm run build
```

Tests run all migrations against an isolated in-memory PostgreSQL database with Supabase Auth scaffolding. They do not connect to the Supabase project or use its credentials.

`test:pages` starts a temporary Next.js development server on port 4317 and a local Supabase API fixture to check the real pages, name filters, submission gating, and read-only history requests.
