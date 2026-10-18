# AUTONOMY
A personal money planner: monthly bills and paid checklists, everyday spending,
cash reserve coverage, savings goals, and paycheck/commission/lump-sum allocation.

## Use the hosted planner
https://autonomy-wheat.vercel.app

Select **Open my planner**, enter available cash and monthly expenses, then add
take-home pay and savings goals. Changes save automatically after a short pause;
**Save plan** saves immediately. Check the save status before leaving.

Hosted storage is **only in this browser profile on this device**. It is not a
cloud account. Anyone with access to that profile can open the plan. Clearing site
data removes the plan. Private browsing may delete it when the window closes.
Export a backup regularly, and import that backup on another device if needed.
Backups are unencrypted financial planning data; keep them private.

Older hosted v1 plan data is migrated when opened; the old copy is preserved.
The old pretend browser login has been removed. Network or login failures never
enable another storage mode.

## Run the local owner version
Requires Node.js 20 or later. No dependencies or paid APIs.
On Windows, double-click `start-autonomy.cmd`, or run:

```powershell
npm.cmd start
```

Open http://127.0.0.1:8081 and create the owner account yourself.
The local version saves in `data/db.json`, with hashed passwords and expiring
sessions. Use **Save plan** after editing. The server listens only on loopback;
do not expose it using a tunnel or reverse proxy.
Existing original local databases migrate automatically.
Data is private to the computer account but not encrypted at rest.

Optional settings: `PORT` and `AUTONOMY_DATA_DIR` (a writable private directory).
Back up the data directory while the server is stopped, or use Export backup.

## Calculation rules
- All listed bills, essentials, and other spending count toward monthly needs.
- Reserves = monthly spending × months × (1 + buffer percentage).
- Only available cash funds reserves; prepaid memberships are informational.
- Enter each account once. Exclude securities and restricted funds.
- Goal balances track progress and never add to cash totals.
- Monthly room = regular checks × take-home pay − expenses − goal contributions.
- Commission and lump sums are separate one-time scenarios, not regular income.
  Do not enter the same deposit as both an existing balance and a new lump sum.
- Per-check expense allocation cannot exceed that check; shortfalls remain visible.
- Bill due days 29–31 clamp to month-end. Paid status rolls over each month.
  The checklist does not deduct cash or send payments.

## Checks
```powershell
npm.cmd run check
npm.cmd test
```

Browser checks require an installed `playwright-core` with its matching Chromium.
Set `PLAYWRIGHT_PATH` to that package if it is outside this project, then run
`node tests/browser.cjs`. To test the hosted browser flow, set `TEST_BASE_URL`
to a public test deployment. The script uses isolated synthetic data and also
tests a temporary local owner server. Screenshots go to ignored `test-results/`.

## Deployment
The existing Vercel project is `autonomy` in `signalinput25-s-projects`.
`vercel.json` explicitly builds only the public frontend assets. The hosted
`/api/session` route returns `runtime.json`, declaring browser storage mode.
The local Node server returns local mode and handles authentication itself.
Never upload `data/`, environment files, credentials, or real financial data.

## Scope
Ready for manual personal planning in one browser, or local owner use.
No bank connections, live balances, transfer execution, actual bill payments,
email reminders, investment trades, public multi-user accounts, or cloud sync.
For a public multi-user service, add and verify a persistent database, real
authentication, per-user authorization, recovery, and privacy/data lifecycle
before inviting users. Configured environment variables alone must never be
presented as working financial integrations.

