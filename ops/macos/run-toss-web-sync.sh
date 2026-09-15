#!/bin/bash
set -euo pipefail
umask 077
TASK_PROJECT_DIR="${EASYHOTDEAL_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
TASK_NODE="${EASYHOTDEAL_NODE_BINARY:-$(command -v node)}"
TASK_MODE="${1:---dry-run}"
if [[ $# -gt 1 || ( "$TASK_MODE" != '--dry-run' && "$TASK_MODE" != '--apply' ) ]]; then exit 64; fi
: "${USER:?USER is required}"
# The existing Kakao agent uses these same keychain entries. Values stay in the environment.
TOSS_SHARELINK_ACCESS_KEY="$(/usr/bin/security find-generic-password -s easyshopping-toss-sharelink-access-key -a "$USER" -w 2>/dev/null)"
TOSS_SHARELINK_SECRET_KEY="$(/usr/bin/security find-generic-password -s easyshopping-toss-sharelink-secret-key -a "$USER" -w 2>/dev/null)"
TOSS_SHARELINK_MEMBER_ID="$(/usr/bin/security find-generic-password -s easyshopping-toss-sharelink-member-id -a "$USER" -w 2>/dev/null)"
export TOSS_SHARELINK_ACCESS_KEY TOSS_SHARELINK_SECRET_KEY TOSS_SHARELINK_MEMBER_ID
if [[ "$TASK_MODE" == '--apply' ]]; then
  DATABASE_URL="$(/usr/bin/security find-generic-password -s com.easyhotdeal.image-backfill -a DATABASE_URL -w 2>/dev/null)"
  export DATABASE_URL
fi
cd "$TASK_PROJECT_DIR"
exec "$TASK_NODE" scripts/sync-toss-web.js "$TASK_MODE"
