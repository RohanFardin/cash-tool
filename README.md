# Pharmacy Accounts

Daily entry happens on `/dashboard`. Each saved amount is permanent for storekeepers; they can add more entries until the day's report is submitted. Submission closes the forms and unlocks `/summary`. The next dashboard day starts at midnight in `Asia/Dhaka`; earlier entries remain in history.

Read-only history is available at `/cash-sales`, `/credit-recovery`, `/supplier`, `/local-supplier`, `/overhead-cost`, and `/conveyance`. Credit and supplier pages have name filters. Totals cover all matching records, including records on other pages.

## Database setup

For an existing project with migrations 001–005 applied, run the contents of `supabase/migrations/006_admin_entry_editing.sql` **once** in the Supabase SQL Editor before using this version. If migration 005 is still pending, apply it first. For a new project, apply all migrations in filename order.

Migration 005 preserves each existing cash-sales daily total as a "Previous daily total" history row. The old implementation overwrote amounts, so individual earlier cash entries and their exact timestamps cannot be reconstructed. New cash entries have their own database timestamps. Existing administrator changes to a cash total are recorded as adjustments.

## Shared records and administration

All storekeepers contribute to one combined report per business date. User1 and user2 see the same entries, totals, and submission status. The entry author is retained for attribution; records are not separated by account.

Administrators start at `/admin/summary`, which shows today's submitted report and has a date selector for older submitted reports. Its entries can be edited individually. The six category pages have matching `/admin/...` URLs, date filters, and Edit buttons. Administrator edits update the original record, preserve its entry time and author, record the editor and edit time, and recalculate the shared totals. Storekeepers cannot edit those records.

History and admin-summary tables keep their column headers and rows on phones; wide tables scroll horizontally.

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
