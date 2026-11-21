#!/usr/bin/env bash
# Run from the extracted trusted release directory, after install-node.sh.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
release_id=${1:?Usage: sudo bash deploy/install-release.sh RELEASE_ID}
[[ $release_id =~ ^[a-zA-Z0-9._-]+$ ]] || { echo 'Invalid release ID.' >&2; exit 1; }
[[ -f dist/server.js && -f dist/migrate.js && -x /opt/betweenus/node/bin/node ]] || { echo 'Run from release root; install Node first.' >&2; exit 1; }
if ! id betweenus >/dev/null 2>&1; then useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin betweenus; fi
target="/opt/betweenus/releases/$release_id"
[[ ! -e $target ]] || { echo 'Release exists; use a new ID.' >&2; exit 1; }
install -d -m 0755 /opt/betweenus/releases
install -d -o betweenus -g betweenus -m 0755 "$target"
cp -R dist migrations package.json package-lock.json deploy "$target/"
chown -R betweenus:betweenus "$target"
(cd "$target" && runuser -u betweenus -- env PATH="/opt/betweenus/node/bin:/usr/bin:/bin" npm ci --omit=dev --ignore-scripts --no-audit --no-fund --cache "$target/.npm-cache")
rm -rf "$target/.npm-cache"
chown -R root:root "$target"
chmod -R go-w "$target"
install -d -m 0700 /etc/betweenus
if [[ ! -e /etc/betweenus/api.env ]]; then install -m 0600 deploy/api.env.example /etc/betweenus/api.env; fi
install -m 0644 deploy/betweenus-api.service deploy/betweenus-migrate.service /etc/systemd/system/
# Dedicated journal namespace caps this app's logs without changing host-wide limits.
cat > /etc/systemd/journald@betweenus.conf <<'JOURNAL'
[Journal]
Storage=persistent
SystemMaxUse=50M
RuntimeMaxUse=20M
MaxRetentionSec=7day
JOURNAL
if [[ -L /opt/betweenus/current ]]; then ln -sfn "$(readlink -f /opt/betweenus/current)" /opt/betweenus/previous; fi
ln -sfn "$target" /opt/betweenus/current
systemctl daemon-reload
echo 'Installed; existing private environment preserved. Edit /etc/betweenus/api.env privately.'
echo 'Then: sudo systemctl start betweenus-migrate && sudo systemctl enable betweenus-api && sudo systemctl restart betweenus-api'
