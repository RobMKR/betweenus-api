# Pilot architecture and account ownership

BetweenUs starts with two independent monolith repositories: Expo/TypeScript client in `betweenus-mobile`, and Node/TypeScript/Fastify API in `betweenus-api`. PostgreSQL is the durable source of truth; Supabase Auth supplies verified identity. The client calls the API rather than accessing debt tables. Keep migration, domain transitions, persistence, auth, and routes inside this single API deployable. Use reusable folder conventions, templates, CI, auth adapters and deployment notes for future apps. A shared platform or microservice estate is unnecessary at this stage.

## First milestone

Delivered: email-addressed debt request creation, lender/borrower scoped lists, borrower accept/dispute with required reason, append-only response history through the API, and accepted-only AED balances using integer money. The local demonstration uses explicitly enabled fake identities and ephemeral memory. Durable PostgreSQL migration and Supabase verified-token adapter are implemented. Real account onboarding and live hosted end-to-end verification remain to be completed before inviting users.

Next slices, each separately reviewable:

1. Real client sign-in, Google and Apple providers under the owner's accounts, email verification and browser invite acceptance with redirect/deep-link recovery. Require sign-in and verified email match; an invitation URL must never itself grant permission.
2. Transactional invitation email delivery using an outbox and a verified sender domain, retries and delivery status. Keep notification delivery independent from debt creation correctness.
3. Dispute/revision resolution through a newly proposed version and explicit borrower consent, preserving earlier history; never silently change an accepted amount.
4. Instalment schedules, repayment recording and acknowledgement, then auditable balances adjusted by accepted repayment events. No bank transfer or payment processor is included.
5. Opt-in reminders, background worker/outbox retries, CSV exports, account deletion/retention policy, operational audit logging, pagination and performance checks.

## Affordable hosting approach

Start with one small API instance/container and one managed PostgreSQL database, using Supabase Auth for identity. A provider offering a managed database and app service reduces maintenance; keeping auth and database in one Supabase project can reduce the number of accounts. Check current regional pricing, free-tier limits, sleep behavior, backup retention, network limits and budget alerts before choosing. No exact pricing is assumed and no hosting resource has been created. Avoid adding Redis, queues as separate services, or multiple API instances until a measured need exists. A database-backed outbox can handle later email/reminder jobs in the monolith.

Before launch, deploy migrations, verify database persistence across restarts, try two simultaneous responses (exactly one succeeds), verify verified/unverified auth, test allowlisted origins on device/browser, configure HTTPS, and restore a test backup. Run a narrow friends/family pilot and record issues before expanding. The Docker image is production-only; it cannot expose local demo credentials accidentally through its default settings.

## Ownership checklist

All organizations, projects, billing and recovery methods should belong to the product owner. Give collaborators scoped access rather than sharing passwords.

- GitHub: owner-controlled organization, two private repositories, branch protections, CI and recovery access. Repositories have only been initialized locally; no remotes or pushes are performed here.
- Expo: owner-controlled organization/project and EAS credentials; configure app identifiers, builds, deep links and distribution separately.
- Supabase: owner-controlled organization/project, confirmed-email auth, database backups, asymmetric signing key, redirect allowlist and least privilege access. Keep service/database secrets on the server; no service-role key is needed by this API.
- Google: owner-controlled Cloud/OAuth project, consent configuration, allowed origins/redirects and OAuth credentials. Complete provider verification as required for the planned audience.
- Apple: owner-controlled developer membership, app/service identifiers, Sign in with Apple configuration, keys and renewal ownership. Publishing is separate work.
- Email: owner-controlled sender provider/domain, DNS verification, delivery credentials and sender reputation. No email is sent by this implementation.
- Hosting and DNS: owner billing account, production domain, HTTPS, region, budget alerts, log access, backup/restore and incident owner.

Secrets live in environment variables/host secret settings and ignored local `.env` files. Commit only placeholder configuration. Rotate any credential accidentally committed, restrict CI secrets, and never paste credentials into source, screenshots, logs or client bundles. Nothing in this delivery provisions accounts, starts billing, publishes an app, sends invitations, or incurs a hosting subscription.
