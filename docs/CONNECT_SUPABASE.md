# Connect your Supabase project

This setup connects an existing owner-controlled project. It does not provision services, send emails or deploy anything. Keep database passwords, connection strings, SMTP passwords, secret keys and user access tokens out of chat and source control.

## 1. Copy public configuration

Open your project in the [Supabase dashboard](https://supabase.com/dashboard), then **Connect**. Copy the **Project URL** and **publishable key** (`sb_publishable_...`). Keys are also under **Settings → API Keys**. Dashboard labels can change; choose the publishable key, never `sb_secret_...` or legacy `service_role`.

Configure the Expo client's ignored local `.env`:

```dotenv
EXPO_PUBLIC_DEMO_MODE=false
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PUBLIC_KEY
EXPO_PUBLIC_API_URL=http://localhost:3001
```

Check the frontend README for its current start command. For a physical device, use the API computer's reachable LAN address for the API URL, and bind the real-mode API to that interface. `localhost` on a phone means the phone. Remote clients need a reachable HTTPS API; this guide does not deploy one. Restart Expo after changing public variables.

The API's existing environment variable is named `SUPABASE_ANON_KEY` for compatibility. **Put the same publishable key in it**; no legacy anon key is required. The adapter sends it as the Supabase `apikey` header. Only the signed-in user's `session.access_token` goes in `Authorization: Bearer ...` when calling BetweenUs. A publishable key is not a user JWT. No secret/service-role API key or JWT signing secret is needed by this API.

## 2. Check Auth before requesting a code

- Under **Authentication**, enable the **Email** provider and email confirmations. Allow new user signups for the pilot if they are currently disabled. Keep accounts verified: BetweenUs rejects identities without `email_confirmed_at`.
- Under **Authentication → Email Templates → Magic Link**, include the code variable, for example `<p>Your BetweenUs sign-in code: {{ .Token }}</p>`. Supabase's passwordless email guide uses this template for email OTP. The client sends `signInWithOtp` and verifies the typed code using `verifyOtp({ email, token, type: 'email' })`. This flow does not require clicking a magic link or configuring a deep link. Check the actual signup email template too if your project uses a separate confirmation message for newly created users.
- Configure **Authentication → URL Configuration** with the intended web origin/site URL and exact allowed redirect URLs before adding browser-link or social login. Numeric code entry is the current client flow; Google/Apple remain future setup.
- Under **Authentication → Signing Keys**, ensure the **current signing key** is asymmetric **ES256** (recommended) or **RS256**. This API deliberately rejects legacy **HS256** user tokens. If your project still uses the legacy secret, follow Supabase's migration flow: create an asymmetric standby key, rotate it to current, then sign out and sign in again to obtain a newly signed session. Do not revoke older keys prematurely in a project with active users; follow the documented rotation/cache guidance.

Supabase's built-in SMTP is for limited testing: official documentation currently restricts recipients to project organization team members and states a limit of two messages per hour, subject to change. An arbitrary friend's address will fail until you configure **custom SMTP** under Authentication settings. Use an owner-controlled sender/provider and verified sender domain, and keep SMTP credentials in Supabase's private settings. Check current Auth rate limits and your email provider's delivery limits. Do not add real pilot users as organization administrators just to bypass email delivery restrictions.

## 3. Save the database connection privately and migrate

Use **Connect → connection string**. For this persistent Node API, choose **Direct connection** if your machine/host supports the project's network (typically IPv6), otherwise **Session pooler** for IPv4 compatibility. Prefer these over the transaction pooler for straightforward setup. Copy the trusted owner/server connection string privately, replace `[YOUR-PASSWORD]` locally with your database password, and URL-encode special password characters. The password is not the publishable key. Use the project's recommended TLS/certificate configuration; do not disable certificate verification.

In the API repository:

```sh
cp .env.example .env
```

Edit `.env` in your local editor (it is Git-ignored):

```dotenv
DEMO_MODE=false
NODE_ENV=development
HOST=127.0.0.1
PORT=3001
CORS_ORIGINS=http://localhost:8081,http://localhost:5173
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=sb_publishable_YOUR_PUBLIC_KEY
DATABASE_URL=YOUR_PRIVATE_POSTGRES_CONNECTION_STRING
```

Use your actual Expo web origin in `CORS_ORIGINS`. For a device/LAN connection set `HOST=0.0.0.0` only with real authentication enabled and appropriate local network controls. Production requires HTTPS ingress, server secrets and `NODE_ENV=production`; demo mode remains forbidden there.

Recommended: run the repository migration runner, which records migration filenames and prevents accidental double application:

```sh
npm ci
npm run build
node --env-file=.env --import tsx src/migrate.ts
node --env-file=.env dist/server.js
```

The API does **not** load `.env` automatically. Node's `--env-file` option above loads it explicitly; existing shell variables take precedence, so clear any stale `DEMO_MODE=true` or other previously exported settings first. `npm run dev:demo` intentionally forces fake local identities and memory storage; use the real-mode command above when connecting Supabase.

The trusted database owner applies migrations and the API enforces row authorization. Migration SQL enables RLS and revokes browser-role access; do not grant direct client access to debts. Run migrations against the intended project, once per release, and preserve backups before future changes.

**SQL Editor alternative:** for an owner who cannot yet connect locally, review and run `migrations/001_initial.sql` once in the project's SQL Editor. This creates the debt schema, but does **not** create the migration runner's tracking record. Before later running the CLI against that database, reconcile/baseline `schema_migrations` with the applied file rather than rerunning it (which would fail because tables already exist). The recommended CLI route avoids this extra step. SQL Editor alone also does not give the API a database connection; a private `DATABASE_URL` is still required to run the real API.

## 4. Verify with your own accounts

`GET /health` should report `mode: "production"` and `storage: "postgres"` whenever demo is disabled, including a local real-auth run. This is a mode label, not proof of deployment; health checks process liveness only. Then use the frontend OTP flow with an allowed test recipient, verify sign-in, create a request to a second verified account, switch accounts, accept/dispute, and verify accepted balances. Confirm the record survives an API restart. No OTP has been requested or email sent by this setup guide.

A 401 can mean an unverified email, expired session, wrong project URL/key, an HS256 session, or Supabase connectivity failure. Check project settings and sign in again after changing signing keys. Keep access tokens and full database connection errors out of shared screenshots/logs.

## Official references

Verified against the following Supabase documentation during setup preparation:

- [API keys and publishable keys](https://supabase.com/docs/guides/api/api-keys)
- [Email passwordless login and OTP templates](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [Custom SMTP and built-in delivery restrictions](https://supabase.com/docs/guides/auth/auth-smtp)
- [JWT signing keys and rotation](https://supabase.com/docs/guides/auth/signing-keys)
- [Connecting to PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres)
