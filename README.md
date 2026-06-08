# AUTONOMY

AUTONOMY is a read-only personal finance planning MVP. It models:

- fixed bills through year-end
- variable essentials such as groceries and fuel
- prepaid memberships and subscriptions
- paycheck and commission allocation rules
- lump-sum funding gaps
- runway if primary income stops
- guardrails for future automation

This version includes local owner login, server-side saved plan data, connector status, and an audit log.
It does not connect to banks, place trades, initiate transfers, or call paid APIs yet.

## Run Locally

```bash
cd /Users/regalia/autonomy
npm start
```

Open `http://127.0.0.1:8081`.

The first account created becomes the `owner`.

## Local Data

The local server stores app data in:

```text
/Users/regalia/autonomy/data/db.json
```

That directory is ignored by git. It may contain financial planning values and hashed login credentials, so do not commit it.

## Safety Rules

- Keep v1 read-only.
- Use the dashboard to validate assumptions for at least one to two months.
- Do not add paid APIs until explicitly approved.
- Do not store credentials, tokens, or account secrets in this repo.
- Treat Fidelity activity as recommendation-only unless a supported official workflow is confirmed.
- Financial provider credentials should be configured through environment variables or a secret manager, not the browser UI.

## Deployment Note

The current backend stores data in the local filesystem for the personal MVP. Vercel can host the UI/runtime for testing, but persistent multi-user financial data should be moved to Supabase/Postgres before relying on the hosted app.
