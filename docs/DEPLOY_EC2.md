# EC2 release deployment (Ubuntu 24.04, x86_64)

This deploys a compiled release to the existing small instance. Nothing builds on EC2: it downloads Node 24, verifies its official SHA256, and installs only production npm dependencies with package scripts disabled. It does not create AWS resources. Supabase remains the external database and Auth provider. The release contains no `.env`, passwords, access tokens or `node_modules`.

## Prepare and transfer

On the development/CI machine, after reviewing and testing the commit:

```sh
bash deploy/package-release.sh
```

Transfer `/tmp/betweenus-release/betweenus-api.tar.gz` and `SHA256SUMS` to the Ubuntu user's home directory using your existing SSH/SCP connection, or download these two files from the reviewed GitHub release. Use your own SSH key locally; do not send it in chat. The bundle is portable compiled JavaScript, so the build machine does not need to match EC2's architecture. Never run `npm run build` on the 1 GiB instance.

## Install on EC2

From the Ubuntu SSH session, in the directory containing both downloaded files:

```sh
sha256sum --check SHA256SUMS
mkdir -p ~/betweenus-release
tar -xzf betweenus-api.tar.gz -C ~/betweenus-release
cd ~/betweenus-release
sudo apt-get update
sudo apt-get install -y curl ca-certificates xz-utils
sudo bash deploy/install-node.sh
sudo bash deploy/install-release.sh pilot-001
sudoedit /etc/betweenus/api.env
```

Choose a unique release ID on later installs. `install-release.sh` preserves an existing `/etc/betweenus/api.env`; it never overwrites it. It creates an unprivileged `betweenus` service account, immutable root-owned release files under `/opt/betweenus/releases`, and service units. Review the scripts before running them. The install selects the release but **does not start it or run migrations**.

In the private editor set the real `SUPABASE_ANON_KEY` to your public publishable key and `DATABASE_URL` to the private trusted server/owner connection string. Copy that string from Supabase **Connect**, using session pooler if IPv4 connectivity requires it. URL-encode password special characters and use the provider's verified TLS configuration. This file is root-owned, mode 0600; systemd reads it before dropping privileges. No `export` prefixes, shell substitution, or command execution belongs in this file. Do not paste its contents into chat or run commands that print it. Keep `HOST=127.0.0.1`, `DEMO_MODE=false`, `NODE_ENV=production`.

Then explicitly migrate and start:

```sh
sudo systemctl start betweenus-migrate
sudo systemctl enable betweenus-api
sudo systemctl restart betweenus-api
sudo systemctl is-active betweenus-api
curl --fail http://127.0.0.1:3001/health
```

Stop if migration fails; inspect the error locally before starting the API. If tables were already created manually in Supabase SQL Editor, reconcile migration tracking first as described in [Connect Supabase](CONNECT_SUPABASE.md). Health should show production/postgres; it checks liveness, not a database transaction. Complete the authenticated two-account flow and persistence checks after frontend configuration.

## Until HTTPS is ready

Keep EC2 port **3001 closed** in the security group. Do not send user access tokens to public HTTP or point a hosted HTTPS frontend at an HTTP API. Local health above works through SSH without exposing the API. For a temporary developer-only browser test, run this on your own computer in another terminal (use the same SSH key/options as your normal connection):

```sh
ssh -N -L 3001:127.0.0.1:3001 ubuntu@3.1.51.32
```

With the tunnel open, a frontend running locally on that computer can use `http://localhost:3001`; this is not a public API address. Keep the exact local frontend origin in `CORS_ORIGINS` and restart the service after changing it.

## Enable HTTPS after choosing a hostname

Choose a hostname with DNS pointing at this instance, and confirm its resolution before configuring Caddy. The temporary pilot hostname `3-1-51-32.sslip.io` has been checked to resolve to this instance. If using it, set that exact hostname in Caddy. Certificate issuance still depends on public DNS availability and inbound ports 80/443; HTTPS has not been tested or configured here. A domain you own is the preferred long-term address. An EC2 public IP may change after stop/start unless it is reserved, so check DNS again after instance changes and review AWS costs before reserving an address.

Install Caddy using its [official Ubuntu instructions](https://caddyserver.com/docs/install#debian-ubuntu-raspbian). Copy `deploy/Caddyfile.example` to `/etc/caddy/Caddyfile`, replacing `api.example.com` with the actual hostname. Allow inbound TCP 80/443 as required for Caddy's certificate issuance and HTTPS service; retain SSH access limited to your IP and keep port 3001 closed. Validate/reload:

```sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
curl --fail https://YOUR_API_HOSTNAME/health
```

Set the real frontend's `EXPO_PUBLIC_API_URL=https://YOUR_API_HOSTNAME`, and set exact browser frontend origin(s) in `/etc/betweenus/api.env` `CORS_ORIGINS`, then restart `betweenus-api`. Do not add arbitrary origins. The current API has proxy trust disabled, so its in-process 100/minute limit sees Caddy as one IP: adequate for an initial tiny pilot, but configure narrowly trusted proxy handling and per-user/distributed limits before expansion. This is intentionally documented rather than silently trusting arbitrary forwarded headers.

## Logs, upgrades and rollback

```sh
sudo journalctl --namespace=betweenus -u betweenus-api -n 50 --no-pager
sudo journalctl --namespace=betweenus -u betweenus-migrate -n 50 --no-pager
```

Authorization/cookie headers are redacted; request bodies are not logged by the default Fastify serializer. Inspect logs privately and redact any identifiers or infrastructure details before sharing. A dedicated journal namespace caps application logs at approximately 50 MiB persistent / 20 MiB runtime and seven days, with API log burst limiting. The service has a 384 MiB memory cap and runs without write access to the host filesystem. No local PostgreSQL, Docker daemon or build toolchain is required.

For upgrades, take/verify the database backup, unpack a new reviewed release in a fresh directory, install it with a new release ID, then migrate and restart explicitly. Installing records the former current target as `/opt/betweenus/previous`. Keep the previous release until verification finishes; old release directories are not deleted automatically.

To roll back application code only:

```sh
sudo ln -sfn "$(readlink -f /opt/betweenus/previous)" /opt/betweenus/current
sudo systemctl restart betweenus-api
```

Only roll back if the previous application is compatible with the current schema. This **does not undo migrations**. Never automatically drop tables or restore old schemas as part of an app rollback. Database recovery is a separate reviewed operation.
