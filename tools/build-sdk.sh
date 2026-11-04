#!/usr/bin/env bash
# Rebuilds js/vendor/anthropic-sdk.mjs: the official Anthropic TypeScript/JS SDK
# bundled into one browser ES module, so the site keeps working with no build step.
#
#   tools/build-sdk.sh            # uses the version below
#   tools/build-sdk.sh 1.5.0      # or pick another @anthropic-ai/sdk version
set -euo pipefail

VERSION="${1:-1.4.0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cd "$WORK"
npm init -y >/dev/null
npm install --silent "@anthropic-ai/sdk@$VERSION" esbuild@0.25.10
cat > entry.mjs <<'JS'
export { default, APIError, APIUserAbortError, AuthenticationError, PermissionDeniedError, RateLimitError, BadRequestError, InternalServerError, APIConnectionError } from '@anthropic-ai/sdk';
JS
npx esbuild entry.mjs --bundle --format=esm --platform=browser --target=es2022 --minify \
  --legal-comments=eof --outfile="$ROOT/js/vendor/anthropic-sdk.mjs"
echo "Built @anthropic-ai/sdk@$VERSION -> js/vendor/anthropic-sdk.mjs"
