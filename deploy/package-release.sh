#!/usr/bin/env bash
# Run on development/CI machine. Never includes .env, node_modules or credentials.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
release_dir=${1:-/tmp/betweenus-release}
mkdir -p "$release_dir"
archive="$release_dir/betweenus-api.tar.gz"
tar -czf "$archive" dist migrations deploy docs README.md package.json package-lock.json
(cd "$release_dir" && sha256sum betweenus-api.tar.gz > SHA256SUMS)
echo "$archive"
