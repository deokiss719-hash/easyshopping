# 관리자 휴대폰 초특가 기능 구현 계획

> 작성일: 2026-09-10 KST
> 범위: 로컬 구현·검증만 수행. Git commit/push 및 Render 배포 금지.

## 보호 경계

- 기존 `deals` 행, RSS 수집·종료 처리·중복 방지, 뽐뿌 본문 이미지/R2 배치 동작을 변경하거나 삭제하지 않는다.
- 공개 `index.html`의 검색/지금 올라온 핫딜/카테고리/전체 핫딜/최신 핫딜 구조와 색상·간격·반응형 레이아웃을 유지한다.
- 기존 카드 렌더러를 재사용하고 수동 상품에는 작은 배지만 조건부 추가한다.
- 기존 미커밋 파일 `scripts/manage-image-backfill-launchagent.js`, `test/macos-image-backfill-agent.test.js`는 수정하지 않는다.
- 비밀값을 코드·DB migration·로그·응답에 넣지 않는다.

## 연결 설계

1. `db/schema.sql`에 추가적이고 재실행 가능한 테이블을 추가한다.
   - `admin_users`: 정규화 사용자명, 비밀번호 해시, 활성 여부, 로그인 시각
   - `admin_sessions`: 세션 토큰의 SHA-256 해시, CSRF 토큰 해시, 만료 시각
   - `manual_deals`: 관리자 편집 원본, 기존 `deals` projection 연결, 노출/메인/우선순위
   - `site_settings`: 허용된 운영 설정 key/value
2. 게시된 수동 상품은 `deals`에 `source='manual'`인 공통 projection으로 트랜잭션 동기화한다. RSS source에는 관여하지 않는다.
3. 공개 조회는 source 미지정 시 RSS+manual을 함께 반환한다. 수동 상품의 배지·원가·설명·메인 노출·우선순위는 `manual_deals` 조인으로 확장한다.
4. 기존 브라우저의 고정 `source=ppomppu` 요청을 제거하고 공통 응답을 사용한다. 검색은 기존 title/merchant 검색으로 함께 작동한다. 수동 상품 category 기본값은 `디지털/가전`이다.
5. 메인 카드 배열에서 `show_on_home=true`인 수동 상품을 priority 순으로 설정 개수만큼 선택하고 기존 RSS 사이에 일정 간격으로 섞는다.
6. `/admin`은 별도 HTML/CSS/JS로 제공하고 `robots` noindex 및 응답 헤더 `X-Robots-Tag: noindex, nofollow`를 적용한다.
7. 로그인은 `ADMIN_USERNAME`+`ADMIN_PASSWORD_HASH`로 계정을 bootstrap한다. 비밀번호는 bcrypt 해시만 비교한다.
8. 세션은 256-bit 무작위 토큰을 쿠키로 발급하고 DB에는 해시만 저장한다. 쿠키는 HttpOnly, SameSite=Strict, production Secure이다. 변경 요청은 same-origin 검사와 `X-CSRF-Token`을 모두 요구한다.
9. 로그인 시도는 IP+사용자명 기준 제한한다. 모든 관리자 API는 서버 인증 middleware 뒤에 둔다.
10. URL 미리보기는 HTTPS만 허용하며 DNS의 모든 주소와 매 redirect를 검사해 loopback/private/link-local/reserved/metadata 목적지를 거부한다. 요청 시간·redirect·HTML 크기·content-type을 제한하고 JSON-LD Product → Open Graph → meta/title 순으로 추출한다.
11. 외부 이미지 URL은 관리자 미리보기와 공개 카드에서 서버가 저장된 URL만 제한적으로 프록시하며, 매 요청 동일 SSRF/이미지 형식/크기 검사를 수행한다. 임의 URL을 query로 받는 공개 프록시는 만들지 않는다. R2 원본 URL은 기존 경로를 그대로 사용한다.
12. 사이트 설정은 허용된 key만 수정하며 공개 가능한 값만 별도 GET API에 노출한다.

## 구현 순서

1. 관리자/수동 상품/설정/공개 projection/URL fetch의 기대 동작 테스트를 먼저 작성하고 RED 확인
2. schema 및 store 계층 구현
3. 인증·세션·CSRF·rate limit·SSRF metadata fetch 구현
4. 관리자 API와 `/admin` UI 구현
5. 공개 API mapping 및 기존 카드 렌더링·혼합 로직 최소 수정
6. 집중 테스트 → 전체 테스트 → audit → diff/scope review
7. 로컬 PostgreSQL 가능 시 migration/CRUD 샘플, 로컬 브라우저에서 desktop/mobile/admin 차단/console/network 검증

## 예정 파일

- 수정: `db/schema.sql`, `server.js`, `src/deal-store.js`, `src/live-deals-api.js`, `public/app.js`, `public/deal-utils.js`, `public/styles.css`, `package.json`, `package-lock.json`
- 추가: `src/admin/*`, `src/manual-deals/*`, `src/url-metadata/*`, `public/admin/index.html`, `public/admin/admin.css`, `public/admin/admin.js`
- 추가 테스트: schema/admin auth/manual CRUD/settings/metadata SSRF/public integration/frontend contract

## 완료 조건

- 기존 RSS 및 이미지 tests 포함 전체 suite 통과
- 비로그인 `/admin` 및 모든 admin API 차단
- 로그인/CSRF/CRUD/ON-OFF/우선순위/삭제 동작
- URL 자동 추출 실패 시 수동 편집 가능
- 메인 혼합, 디지털/가전, 통합 검색, 모바일 관리자 화면 확인
- `npm audit --omit=dev`, `git diff --check`, 독립 diff review 통과
- 최종 상태는 로컬 변경만이며 commit/push/deploy 없음
