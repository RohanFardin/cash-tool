# Pharmacy Accounts

Daily entry happens on `/dashboard`. New amounts are held temporarily in the browser, where users can review and delete them. Submitting saves the full batch atomically, closes the forms, and unlocks `/summary`. The next dashboard day starts at midnight in `Asia/Dhaka`; earlier submitted entries remain in history.

Read-only history is available at `/cash-sales`, `/credit-recovery`, `/supplier`, `/local-supplier`, `/overhead-cost`, and `/conveyance`. Cash Sales shows one row per submitted day with Date, Total Sales, and the running closing Cash in Hand. Credit and supplier pages have name filters. Totals cover all matching records, including records on other pages.

## Database setup

For an existing project, the core entry workflow requires migrations through 008. Apply `supabase/migrations/010_admin_add_history_record.sql` **once** before using the admin add forms. It adds one transactional function and reuses existing tables. Migration 009 provides a database view for cumulative balances and renames legacy default display names; until it is applied, the app computes balances from paginated existing reports and displays legacy account names as User. For a new project, apply all migrations in filename order.

Migration 005 preserves each existing cash-sales daily total as a "Previous daily total" history row. The old implementation overwrote amounts, so individual earlier cash entries and their exact timestamps cannot be reconstructed. New cash entries have their own database timestamps. Existing administrator changes to a cash total are recorded as adjustments.

## Shared records and administration

All users contribute to one combined report per business date. User1 and user2 see the same entries, totals, and submission status. The entry author is retained for attribution; records are not separated by account.

Administrators start at `/admin/summary`, which shows today's submitted report and has a date selector for older submitted reports. Its entries can be edited individually. The six category pages have matching `/admin/...` URLs, date filters, and Edit buttons. Administrator edits update the original record, preserve its entry time and author, record the editor and edit time, and recalculate the shared totals. Users cannot edit those records.

History and admin-summary tables keep their column headers and rows on phones; wide tables scroll horizontally.

On the admin Due / Recovery, Supplier, and Overhead Cost pages, the header button opens Add Person, Add Supplier Name, or Add Overhead. Only the name is required. A person or supplier may also have a phone number and an optional due/recovery or purchase/payment amount. An amount is recorded under the selected report date, or today when no date is selected; saving it does not change that report's status. Names without entries appear in the same table with blank amount cells and do not affect financial totals. Adding an overhead name makes it available in the user's existing overhead selector. Name-only additions clear filters so the new name is visible; additions with amounts keep the selected date and clear the old party/page filter.

Users can add customer and supplier records with a phone number and notes from the dashboard. Due/recovery and supplier entries retain a contact-and-note snapshot in history. Cash in hand carries forward the balance from all earlier submitted or approved days, plus today's cash sales and due recovery, less supplier payments, local-supplier purchases, overhead costs, and conveyance. The dashboard card shows the balance through the latest submitted day; Calculate Cash in Hand previews the closing balance including today's temporary entries. Submission updates the balance, summaries, and Cash Sales history. Days without reports do not reset it, and administrator corrections to older reports update every later balance. The database retains each day's net movement in `daily_reports.cash_in_hand`; `daily_cash_balances` derives the cumulative closing balances.

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
