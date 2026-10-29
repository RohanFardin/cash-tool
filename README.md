# Joarder Pharmacy

Daily entry happens on `/dashboard`. New amounts are held temporarily in the browser, where users can review and delete them. Submitting saves the full batch atomically, closes the forms, and unlocks `/summary`. The next dashboard day starts at midnight in `Asia/Dhaka`; earlier submitted entries remain in history.

Read-only history is available at `/cash-sales`, `/credit-recovery`, `/supplier`, `/local-supplier`, `/overhead-cost`, and `/conveyance`. Cash Sales shows one row per submitted day with Date, Total Sales, and the running closing Cash in Hand. Credit and supplier pages have name filters. Totals cover all matching records, including records on other pages.

## Database setup

For an existing project, apply any pending migrations **once**, in filename order, in Supabase SQL Editor. Migration `011_date_ranges_and_admin_dashboard.sql` adds inclusive date-range totals and admin dashboard batches. Migration `012_admin_delete_daily_report.sql` adds deletion of one selected submitted report and all its entries as a single transaction. Migration `013_admin_entry_edit_mode.sql` adds a per-administrator edit-mode setting, off by default, and database enforcement for saved-entry updates. For a new project, apply all migrations in filename order.

History pages also work while migration 011 is pending: they use the previous totals function for all dates or one exact date, and calculate multi-day totals from all matching pages of the existing history view. Date and name filters remain active. Permission and network errors still surface as errors. Migration 011 remains required for saving admin dashboard batches.

Migration 005 preserves each existing cash-sales daily total as a "Previous daily total" history row. The old implementation overwrote amounts, so individual earlier cash entries and their exact timestamps cannot be reconstructed. New cash entries have their own database timestamps. Existing administrator changes to a cash total are recorded as adjustments.

## Shared records and administration

All users contribute to one combined report per business date. User1 and user2 see the same entries, totals, and submission status. The entry author is retained for attribution; records are not separated by account.

Administrators start at `/admin/summary`, which shows today's submitted report and has a date selector for older submitted reports. Each selected date shows the name and sign-in username of the person who submitted that shared report, plus the submission time. Submission is attributed to the person who finalized the report, even when other users contributed entries.

Both submitted summaries show Yesterday’s Cash in Hand and the selected report’s closing Cash in Hand at the top. The previous balance includes all earlier submitted or approved reports, including across days without a report, and starts at zero when there are no earlier reports.

In admin Settings, **Download Backup** downloads a restorable PostgreSQL `.dump` archive of the entire database, including all dates, drafts, individual entries, account password hashes and database structure. It replaces the date-range Excel export. Set the private `SUPABASE_DB_URL` variable in Vercel and redeploy with `npm run build`; no new migration is required. See [database backup setup and restore instructions](docs/database-backups.md).

Entry Editing in Settings controls whether Edit buttons appear on the summary and all six `/admin/...` category pages. It is off by default and saved separately for each administrator. Turning it off hides entry editors and blocks saved-entry updates in both server actions and the database. Adding missing entries and deleting a complete report keep their existing controls. Administrator corrections preserve original entry times and authors, record the editor and edit time, and recalculate totals. Projects awaiting migration 013 can still sign in and read reports; editing remains unavailable until the migration is applied.

Change User Name in Settings lets an administrator choose a user's display name. The user list, signed-in header and submission attribution use that updated name. Sign-in usernames, passwords, roles and historical submission IDs are retained.

The administrator's Settings link sits above Logout and opens `/admin/settings`. Change My Password verifies the current password before updating it. Change User Password sets a new password for a selected user account; it cannot target another administrator. Both forms require matching new passwords with at least 12 characters, and Supabase applies its project password rules. Passwords are handled by Supabase Auth and are never saved in the application's accounting tables or returned in action responses.

For user password changes, set `SUPABASE_SECRET_KEY` (or the legacy `SUPABASE_SERVICE_ROLE_KEY`) in the server environment, including the hosting provider's environment variables, then restart/redeploy. The key must belong to the same project as `NEXT_PUBLIC_SUPABASE_URL` and must never use a `NEXT_PUBLIC_` variable. Own-password changes use the authenticated session and do not need this key. See `.env.example` and the [Supabase Admin API documentation](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid).

Daily Summary includes Delete This Report for its selected submitted or approved date. The administrator must type that date to confirm. Deletion permanently removes the report and all its cash, credit/recovery, supplier, local-supplier, overhead and conveyance entries, including legacy entries. Customer, supplier, overhead-name and user directories remain available. Running cash balances and outstanding dues update automatically. Other report dates remain unchanged. Deleting today's report allows a fresh report to be entered for that date.

History and admin-summary tables keep their column headers and rows on phones; wide tables scroll horizontally.

All history pages for users and administrators have inclusive Date From / Date To filters, which also filter totals and persist when paging. On phones, the dates form an equal-width pair, name filters occupy a full row, and Apply/Reset buttons sit side by side. Summary and dashboard report-date controls use the same mobile styling. Cash in Hand includes days before the selected range. Table headings, numbers and form fields align left. The daily cash table fits phone screens. The admin summary initially shows Section and Total Amount; swiping its table reveals Records.

Administrators can open `/admin/dashboard`, select today or an earlier report date, and use the same temporary entry forms as users. Save Report Entries commits the whole batch atomically. A draft or missing report becomes submitted; additions to submitted or approved reports retain their existing status and submission/approval metadata. Administrator entries are attributed to the administrator, and cash corrections carry forward to later days. Users stay locked out of submitted report entry forms.

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

Tests run all migrations against an isolated in-memory PostgreSQL database with Supabase Auth scaffolding. After `npm run backup:prepare`, native PostgreSQL tests also verify complete backup/restore round trips and the Supabase restore script. They do not connect to the Supabase project or use its credentials.

`test:pages` starts a temporary Next.js development server on port 4317 and a local Supabase API fixture to check the real pages, name filters, submission gating, and read-only history requests.

Optionally set `CASH_TOOL_BROWSER` to the full path of an installed Chrome/Chromium executable before running `test:pages`. It checks summary scrolling and cash-history layouts, then every user/admin date filter at 320px and 390px. It also exercises editing on/off across navigation, user-name selection, customer/supplier entry forms, temporary deletion, submission confirmation and the complete database backup download flow. Screenshots are saved under `.next-page-check/screenshots/`, and the test download under `.next-page-check/downloads/`. These checks use the local fixture and do not connect to the Supabase project.
