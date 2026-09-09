#!/bin/zsh
set -euo pipefail

SERVICE="com.easyhotdeal.image-backfill"
readonly SERVICE
readonly REQUIRED_KEYS=(
  DATABASE_URL
  R2_ACCOUNT_ID
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY
  R2_BUCKET_NAME
  R2_PUBLIC_BASE_URL
)

status() {
  local missing=0
  for key in "${REQUIRED_KEYS[@]}"; do
    if /usr/bin/security find-generic-password -s "$SERVICE" -a "$key" >/dev/null 2>&1; then
      printf '%s=present\n' "$key"
    else
      printf '%s=missing\n' "$key"
      missing=1
    fi
  done
  return "$missing"
}

configure() {
  printf '이지핫딜 로컬 이미지 배치 자격증명을 macOS Keychain에 저장합니다.\n'
  printf '각 항목은 화면에 표시되지 않습니다. 입력 후 Enter를 누르세요.\n\n'
  for key in "${REQUIRED_KEYS[@]}"; do
    printf '[%s]\n' "$key"
    /usr/bin/security add-generic-password \
      -U \
      -s "$SERVICE" \
      -a "$key" \
      -T /usr/bin/security \
      -w
  done
  printf '\n저장 완료. 현재 상태:\n'
  status
}

remove() {
  for key in "${REQUIRED_KEYS[@]}"; do
    /usr/bin/security delete-generic-password -s "$SERVICE" -a "$key" >/dev/null 2>&1 || true
  done
  printf '전용 Keychain 항목을 삭제했습니다.\n'
}

case "${1:-status}" in
  configure) configure ;;
  status) status ;;
  remove) remove ;;
  *)
    printf '사용법: %s {configure|status|remove}\n' "$0" >&2
    exit 64
    ;;
esac
