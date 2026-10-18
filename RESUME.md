# Autonomy — saved work, October 18, 2026

User requested saving all progress before shutting down the PC. Resume the full
launch-readiness task when requested. Do not call the product launch-ready.

## Saved locally, not deployed yet

- Second AI completed a design pass in platform.html/platform.css: stronger
  financial hierarchy and contrast, clearer first-household setup, improved
  empty states, mobile household controls and collapsible navigation.
- Parent wired #toggleNav and aria-current navigation behavior in platform.js.
- Added resend-confirmation button/API with a persisted email rate limit shared
  with recovery requests. Resend uses Supabase's existing mail transport; it does
  not activate unrestricted delivery or fix provider redirect settings.
- Added handling for default Supabase access/refresh-token email fragments,
  explicit confirmation, URL-fragment removal and server validation before
  setting HttpOnly cookies. Tokens are bound to the same authenticated account.
- Node syntax checks, all 29 Node tests and the desktop/mobile browser regression
  suite passed after integration. New auth behavior has not been checked against
  the live service or deployed. Browser tests exercise prior confirmation/pasted
  recovery handling but need added coverage for the new email-session flow and
  resend button before release.
- Design agent checked 320/390/768/1440 layouts with no horizontal overflow.
  Screenshots remain in ignored test-results/design-*.png. Main browser screenshots
  are platform-desktop.png and platform-mobile.png in that directory.

## Still deployed

RELEASE.json describes the previous deployed source (5627b1f), Vercel production
dpl_86CHVpApJpwNtgTgiJFtaw6edjAr and Supabase autonomy Edge function v4.
29 prior live production API/Auth/Postgres checks passed. The temporary
autonomy-verification function is disabled (410, v9); no temporary test accounts
remain. Do not treat those live checks as verification of the new local auth code.

## Activation investigation and next steps

- Local outbound sockets remain blocked; curl to api.vercel.com failed.
- Connected Vercel/Supabase tools work. Supabase tools lack Auth configuration and
  secret management operations. No Resend/Plaid/Argyle plugin was found.
- Installed Vercel CLI 64.0.2 credentials exist at the path returned by its own
  getAuthConfigFilePath helper: AppData/Roaming/com.vercel.cli/Data/auth.json.
  Previous attempts looked in the parent folder and incorrectly missed them.
  Never print or commit these credentials. Credential usability not yet tested.
- A temporary nonpersistent Vercel sandbox was created to run network-capable CLI
  provider discovery. Session sbx_mTTmZ3NPRC12A62Us6n4RRE9bEhG is STOPPED; name
  autonomy-activation-check. npm install vercel@latest and messaging discovery
  were started but output was not inspected before shutdown. No provider was
  provisioned, no credentials transferred into that session, no activation done.
- A future short-lived remote Vercel session may allow CLI marketplace provisioning
  using the existing CLI credential without the local socket restriction. Read
  the Vercel Marketplace skill first. Discover/install actual services before
  writing provider-specific integration code; report a genuine interactive
  provider login requirement if encountered. Stop the temporary session afterward.
- Finish signup SMTP/Auth site URL/templates and leaked-password protection.
  Then activate approved bank/payroll providers, outgoing reminder sender, credit
  bureau feed and approved money movement; verify actual execution/reconciliation.
- Owner account was unconfirmed at the last check. Do not confirm it via SQL,
  consume their private token, or read/change their password. Earlier corrected
  private confirmation email is documented in the global HANDOFF.md.
- GitHub writes were blocked with connector 403; direct Git networking blocked.
  Local history was imported from a snapshot, so NEVER force-push it over upstream.
  data/autonomy-platform.patch is the transferable diff against imported base
  6af8646; apply it to a fresh clone of upstream ffa8d99 when access is restored.

Read C:/Users/pratt/Documents/Projects/HANDOFF.md and LAUNCH_READINESS.md first.
