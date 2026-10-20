# Launch readiness — phase 1 local update, 2026-10-20

Phase 1 changes are local and uncommitted. Nothing was deployed or applied to
pablo-ventures. The default API uses the shared project; explicit
`AUTONOMY_BACKEND=legacy` retains the previous isolated backend. Review README
and database/supabase-autonomy.sql before deploying. The shared registry schema
was unavailable to the connector; its Doood policy cloning and registry field
assumptions need review. Live shared-project RLS/Auth/SMTP checks remain pending.
43 Node tests, syntax checks and desktop/mobile regression pass locally; these
do not validate the unapplied SQL. Sandbox-only bank Link verification removes
the test item; persistence and live bank sync remain future shared-project work.

## Previous deployed readiness — 2026-10-18

The cloud rebuild is implemented and verified; the full product is not launch-ready.

| Feature | Current state |
|---|---|
| Real password login, refresh and logout | Verified against live Supabase Auth |
| Household sharing | Verified email-bound invites; owner/editor/viewer; member removal |
| Cloud household storage | Persistence, revision conflicts and database RLS verified |
| Bills | Due dates, reserved cash, paid checklist and provider links |
| Reminders | Daily job, in-app notifications and calendar alerts; email sender not activated |
| Paycheck planning | Multiple earners, actual dates, bill sinking funds, essentials, cash floor, goals and extra debt |
| Debt payoff | Minimums and APR tracking; avalanche/snowball estimates |
| Savings | Targets, progress and monthly/per-check allocation recommendations |
| Spending | CSV, manual records, posted category analysis and recurring merchant suggestions |
| Bank adapter | Link, exchange, encrypted tokens, balances/transactions/liabilities, disconnect; no live credentials |
| Payroll adapter | Link tokens and paystub import; no live credentials |
| Credit | Real-score recording and entered-card utilization; no bureau feed |
| Disputes | Editable factual-error drafts with CFPB guidance; no automatic sending |
| Money movement | Not implemented with an approved execution provider; fails closed |
| Signup / recovery | Code implemented; custom SMTP and auth email-link settings still required |

## Evidence
- 27 automated Node tests passed, including completed savings targets, reserved
  bill funds after payment, distant pay dates, unusual transaction categories,
  expired-session logout and recovery request rate limits.
- Desktop/mobile browser checks passed, with no page errors.
  Checks also cover saving while switching households, failed household loads,
  invalid timezones and pasted recovery links.
- 29 checks passed through the production Vercel API and real Supabase Auth/Postgres: login, household creation,
  sharing, wrong-email rejection, viewer write rejection, saved-plan persistence,
  stale-write rejection, direct database RLS rejection, provider-secret denial,
  role changes, removal, revoked-session rejection, expired-session logout,
  signup token confirmation, one-time-token replay rejection, recovery,
  password change, old-password rejection and new-password login.
  Test links were generated for temporary accounts; this does not verify
  general outbound email delivery.
- Latest Supabase security check warns that leaked-password protection is
  disabled. Auth configuration access is required to enable it:
  https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
- Preview page, cloud session and provider-status endpoints returned 200.
  Backend source URLs returned 404.
- Browser automation cannot reach external URLs in the local sandbox; live HTTP
  checks used the Vercel connector.
- Temporary verification accounts were removed; no real user account was created.

## Infrastructure
- Vercel: autonomy / prj_5esbfAixu82G2i8BtEqrfq9P5UNJ
- Team: signalinput25-s-projects / team_RQPNBdoifxNJa00Y8bEHtDku
- Supabase: Autonomy / mswszuvtffztattslfzg, quoted $0/month at creation
- Daily worker: autonomy-daily-reminders, 15 12 * * * UTC
- Previous browser planner production: dpl_3JTKkEkNeQdePgEamhYfYpo5mtTY
- First cloud preview: dpl_DVx1pD1Eeb9E5BXx8rdJ7Uq1LfJ6
- Final deployment and commit: see RELEASE.json.

## Remaining work
Activate SMTP/auth URLs, live bank/payroll products, a bureau feed if wanted, and
an appropriate approved money-movement service with verified destinations and
end-to-end execution/reconciliation tests. Never bypass email confirmation,
fabricate scores, or label recommendations as executed transactions.

The owner's confirmation email arrived, but its original link redirected to
localhost. A corrected private link was sent; account confirmation remains
pending the owner's click. That workaround does not activate general signup
email delivery or correct the provider's default link configuration.
