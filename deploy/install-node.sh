#!/usr/bin/env bash
# Run on Ubuntu x86_64 as root. HTTPS download + official SHA256 verification.
set -euo pipefail
[[ $EUID -eq 0 && $(uname -m) == x86_64 ]] || { echo 'Requires root on x86_64 Linux.' >&2; exit 1; }
command -v curl >/dev/null || { echo 'Install curl, ca-certificates and xz-utils first.' >&2; exit 1; }
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"
curl --fail --silent --show-error --location https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o SHASUMS256.txt
archive=$(awk '$2 ~ /^node-v24\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$/ {print $2}' SHASUMS256.txt)
[[ -n $archive && $archive != *$'\n'* ]] || { echo 'Unexpected Node manifest.' >&2; exit 1; }
curl --fail --silent --show-error --location "https://nodejs.org/dist/latest-v24.x/$archive" -o "$archive"
awk -v file="$archive" '$2==file' SHASUMS256.txt | sha256sum --check --strict
install -d /opt/betweenus
tar -xJf "$archive" -C /opt/betweenus
ln -sfn "/opt/betweenus/${archive%.tar.xz}" /opt/betweenus/node
/opt/betweenus/node/bin/node --version
