# AUTONOMY — household finances

Cloud accounts and household sharing, bills, paycheck allocation, debt payoff,
savings goals, spending insights, reminders, and credit-report dispute drafts.

**The full product is not launch-ready.** The cloud build and core features are
implemented and tested. Signup/recovery email delivery, live financial providers,
credit bureau access and actual money movement still require activation.

See [LAUNCH_READINESS.md](LAUNCH_READINESS.md) for status and verification evidence.

## Phase 1 shared-project build (local, not deployed)

The default same-origin API now uses **pablo-ventures**
(`kfdyrwblvggfrhxcqnug`) through `cloud/shared.js`. It uses Supabase Auth
email/password, confirmation and password recovery without owner approval.
HttpOnly cookies hold separate shared-project sessions; user JWTs enforce RLS.
`PV_SUPABASE_SERVICE_ROLE_KEY` is **not required** and is never sent to clients.
Optional Vercel server variables are `PV_SUPABASE_URL` and
`PV_SUPABASE_PUBLISHABLE_KEY`; defaults are the supplied shared project/public key.

**Review and apply [database/supabase-autonomy.sql](database/supabase-autonomy.sql)
before enabling this build. It has not been applied.** Missing tables/functions
produce a setup message. Do not run the older migrations against pablo-ventures.
All new tables/functions use `autonomy_`; other apps' data is untouched. The
authorized registry exception extends the `app_users` app constraint and mirrors
actual Doood policies for `app='autonomy'`. Schema lookup was denied by the
connector: the reviewer must confirm the shared registry ownership columns,
required fields/defaults, and existing Doood SELECT/INSERT/UPDATE policies.
The usage RPC supports `user_id`/`auth_user_id`, `app`, optional `email`, and
defaults for other fields; unfamiliar registry layouts require adjustment.
The SQL transaction fails explicitly when expected registry policies are absent.

Owner creates a household and a seven-day single-use join code. The second
partner signs in with their own confirmed email and enters the code in setup or
Household. Codes have 128 bits of randomness, are stored hashed, and rotation
invalidates the old code. Joins and removal are serialized; only two members can
join. Both edit the plan; only the owner manages membership. A code is a secret
invitation: send it privately. It is not email-bound like the legacy invitation.

Income entries assign partner A/B, per-check pay, weekly/biweekly anchor dates,
custom semimonthly days or monthly dates. Bills include category, autopay,
amount per occurrence, monthly due day or dated weekly/biweekly/quarterly/yearly/
one-time schedules. CSV/manual transactions, debt and goals remain available.

`Finance.threeMonthPlan` generates the next three **calendar** months (exclusive
end), with proportional, 50/50 or custom partner splits. Bills use checks strictly
before each due date; impossible splits, overdue bills and insufficient income
show funding shortfalls. Reserved cash funds only the next unpaid occurrence.
Checks are capped at take-home pay, then allocate remaining money to everyday
spending, the cash floor, goals and rainy-day contributions. No funds move.
The original next-check screen also retains its extra-debt recommendation.
Recurring schedules project the current cycle and latest overdue occurrence;
they are not a historical arrears ledger. Monthly totals average nonmonthly bills
and exclude one-time expenses, which remain in the dated plan.

Settings track rainy-day savings separately from available cash and other goals.
The app shows months of recurring bills/minimums saved and celebrates 1/3/6 months.
Do not count the same savings toward multiple goals. The leak finder checks
recurring bills/merchants, matches entered category budgets and offers an optional
playful roast. Its seven-service editable price table starts at zero (unknown),
uses matching-tier monthly/yearly prices and always says **check current price**.
Some tiers have no annual plan; no savings are invented. Debt payoff displays
both strategies with equal payment budgets and recommends lower modeled interest.
Credit guidance is education, not financial advice.

Vercel sandbox bank linking uses `cloud/bank-provider.js` with server-only
`PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV=sandbox`. With no credentials it is
disabled as coming soon. The shared adapter verifies a sandbox Link exchange,
then removes the test item: persistent bank sync is a later phase. Production
credentials do not enable this adapter. The older encrypted sync implementation
is preserved in `cloud/backend.js`. There are **no real transfers**. See
[money movement plan](docs/money-movement-plan.md) for custody, legal requirements,
providers, cost assumptions and release gates.

Configure shared Supabase Auth SMTP, Site URL and allowed confirmation/recovery
redirects to `https://autonomy-wheat.vercel.app`; keep confirmation enabled.
Use the existing token-hash email templates below, or supported Supabase email
session links. Public signups must be enabled. Default SMTP restrictions/rate limits
still apply. Set Vercel `AUTH_EMAIL_READY=true` only after verifying delivery.

For the existing isolated backend, explicitly set `AUTONOMY_BACKEND=legacy`.
Its accounts and household data remain separate; no data is automatically copied
between projects. Export/import a household plan manually if migrating. Deploy
the updated Edge backend as well when using new plan fields with legacy mode;
the previous deployed validator would discard those fields.

Validation: `npm test` (43 passing), `npm run check`, and the desktop/mobile
browser regression including the new split, reserve, leak and comparison controls.
The shared adapter tests mock Supabase; **no live shared-project SQL/RLS or email
delivery verification has been performed**. Before release, review the migration,
test two partners plus an outsider against actual RLS/RPCs, and verify SMTP.
`RELEASE.json` continues to describe the previous deployed release.

## Preserved isolated-backend files and infrastructure
- Frontend: platform.html, platform.css, platform.js, finance.js.
- Vercel same-origin API proxy: api/index.js.
- Supabase Edge backend: cloud/backend.js and cloud/index.ts.
- Database migrations: database/. Authentication and household data live in the
  separate Autonomy project (mswszuvtffztattslfzg), US East, quoted $0/month.
- HttpOnly/Secure/SameSite=Strict cookies, real session revocation checks,
  owner/editor/viewer authorization, household RLS, revision conflicts.
- Provider secrets are AES-GCM encrypted; raw tokens never reach the frontend.
  Current encryption derives from the service key, so ciphertext must migrate
  alongside service-key rotation.
- Daily reminder worker: 12:15 UTC, using household timezone for due dates.

## How allocation works
Pay schedules generate actual household pay dates. Each unpaid bill and debt
minimum is divided across pay dates before it is due, less cash explicitly
reserved for it. Then the check covers everyday spending until the next payday,
restores the cash floor, funds goals, and pays extra debt. Allocations cannot
exceed the check; overdue-before-payday warnings and shortfalls remain visible.
Monthly overview uses average weekly/biweekly frequency.

Avalanche and snowball estimates assume fixed rates, monthly interest, no new
charges or fees, and a fixed total payment budget as balances are paid off.
Debt balances cannot determine a credit score. Recorded scores require a real
source, scoring model and date. Dispute drafts describe specific alleged errors;
they do not promise accurate debt can be removed and are never sent automatically.

## Legacy Edge activation requirements
Configure keys only in Supabase Edge Function Secrets, never in frontend files.

- Bank data: PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV=sandbox or production.
  Enable Transactions and optionally Liabilities. Live use needs provider approval.
  Link/exchange, encrypted tokens, cursor sync, pending replacement, liability
  review and disconnect are implemented. Sandbox data is labeled explicitly.
- Payroll: ARGYLE_KEY_ID, ARGYLE_KEY_SECRET, ARGYLE_ENV=sandbox or production.
  User/link tokens, provider flow, paystub import, and disconnect are implemented.
- Reminder email: RESEND_API_KEY and EMAIL_FROM with a verified sender.
  Messages contain a sign-in notice, not financial amounts. Delivery is idempotent.
- Auth email: configure custom SMTP in Supabase Auth. The default mail service
  only sends to project team addresses and is not a production signup service.
  Set Site URL and allowed redirects to https://autonomy-wheat.vercel.app.
  Use confirmation/recovery email links:
  https://autonomy-wheat.vercel.app/#token_hash={{ .TokenHash }}&type=signup
  https://autonomy-wheat.vercel.app/#token_hash={{ .TokenHash }}&type=recovery
  Keep email confirmation enabled. The app supports these links in its verification
  form. SMTP and auth-link settings require account-side access not exposed by
  the connected tools used in this session.
  After delivery and recovery have been verified, set AUTH_EMAIL_READY=true in
  Edge Function Secrets to remove the deployment activation notice.
- Payments: there is no approved execution rail in this build. Automatic transfers,
  automatic savings and creditor payments are not implemented as live services.
  The execute endpoint fails closed. Bank-data access is not transfer authorization.
- Credit: no bureau score/report API is connected. Manual score tracking and
  source-backed educational actions are available.

## Data
Manual plans allow 5,000 CSV transactions. Bank views load up to 1,000 recent
transactions; payroll views load up to 200 records. CSV dates are ISO dates,
positive amounts mean spending, and negative amounts mean deposits. Verify the
bank's sign convention. Exclude transfers/debt payments from spending insights.

Cloud changes are shared when saved. Backups contain unencrypted planning values
and should be kept private. Connection secrets never appear in backups.
Previous browser-only plan data can be imported from Settings without deleting
the old copy.

## Verification
Node 20+, no npm dependencies for core tests:

```powershell
npm.cmd run check
npm.cmd test
$env:PLAYWRIGHT_PATH='path-to-an-installed-playwright-core'
node tests/platform-browser.cjs
```

cloud/verify.ts creates isolated temporary accounts for real Auth/Postgres/RLS
checks, then deletes them. Its deployed verification endpoint is disabled after
validation. It must never be deployed as an unprotected admin endpoint.

npm start (or start-autonomy.cmd) opens the platform at localhost:8081 and
uses the shared-project adapter by default (or proxies to the original Edge
service when AUTONOMY_BACKEND=legacy). Cloud connectivity is required.
npm run start:legacy runs the original local owner MVP in server.js; its account
store is separate from the new cloud household platform.

## Git history
This workspace imported upstream ffa8d99 because Git network access was blocked.
Its first local commit is not the actual upstream commit. Do not force-push this
history. Apply the generated patch to a fresh clone, or publish the final file tree
on top of the remote commit once GitHub write access is restored.

