# AUTONOMY — household finances

Cloud accounts and household sharing, bills, paycheck allocation, debt payoff,
savings goals, spending insights, reminders, and credit-report dispute drafts.

**The full product is not launch-ready.** The cloud build and core features are
implemented and tested. Signup/recovery email delivery, live financial providers,
credit bureau access and actual money movement still require activation.

See [LAUNCH_READINESS.md](LAUNCH_READINESS.md) for status and verification evidence.

## Files and infrastructure
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

## Activation requirements
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

npm start (or start-autonomy.cmd) opens the new platform at localhost:8081 and
proxies requests to the same cloud service. Cloud connectivity is required.
npm run start:legacy runs the original local owner MVP in server.js; its account
store is separate from the new cloud household platform.

## Git history
This workspace imported upstream ffa8d99 because Git network access was blocked.
Its first local commit is not the actual upstream commit. Do not force-push this
history. Apply the generated patch to a fresh clone, or publish the final file tree
on top of the remote commit once GitHub write access is restored.

