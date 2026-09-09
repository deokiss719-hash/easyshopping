#!/bin/zsh
set -euo pipefail

umask 077
SERVICE="com.easyhotdeal.image-backfill"
SCRIPT_DIR="${0:A:h}"
PROJECT_DIR="${EASYHOTDEAL_PROJECT_DIR:-${SCRIPT_DIR:h:h}}"
NODE_BINARY="${EASYHOTDEAL_NODE_BINARY:-$(command -v node || true)}"
readonly SERVICE PROJECT_DIR NODE_BINARY
readonly REQUIRED_KEYS=(
  DATABASE_URL
  R2_ACCOUNT_ID
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY
  R2_BUCKET_NAME
  R2_PUBLIC_BASE_URL
)

if (( $# > 1 )) || (( $# == 1 )) && [[ "$1" != "--check" ]]; then
  printf 'usage: %s [--check]\n' "$0" >&2
  exit 64
fi

if [[ ! -f "$PROJECT_DIR/scripts/run-local-image-backfill.js" ]]; then
  printf '{"status":"error","reason":"invalid_project_dir"}\n' >&2
  exit 78
fi
if [[ -z "$NODE_BINARY" || ! -x "$NODE_BINARY" ]]; then
  printf '{"status":"error","reason":"node_not_found"}\n' >&2
  exit 78
fi

for key in "${REQUIRED_KEYS[@]}"; do
  if ! value="$(/usr/bin/security find-generic-password -s "$SERVICE" -a "$key" -w 2>/dev/null)"; then
    printf '{"status":"error","reason":"missing_keychain_item","key":"%s"}\n' "$key" >&2
    exit 78
  fi
  export "$key=$value"
  unset value
done

export IMAGE_BACKFILL_LIMIT="${IMAGE_BACKFILL_LIMIT:-15}"
export IMAGE_REQUEST_INTERVAL_MS="${IMAGE_REQUEST_INTERVAL_MS:-5000}"

cd "$PROJECT_DIR"
exec "$NODE_BINARY" scripts/run-local-image-backfill.js "$@"
