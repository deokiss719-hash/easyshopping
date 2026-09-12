# Toss Sharelink 제한형 추천 구좌 구현 계획

> 작성: 2026-09-12 KST
> 상태: API 심사 중. 승인 전 운영 호출·활성화·배포 금지.

## 목표

토스쇼핑 쉐어링크 Open API의 통합 베스트 및 하루특가 상품 중 최대 10개를 별도 추천 구좌에 자동 게시한다. 기존 핫딜 검색·카테고리·가격 비교·전체 카탈로그와 분리하며 공식 쉐어링크만 외부에 노출한다.

## 정책·보안 경계

- `TOSS_SHARELINK_ENABLED=true`와 모든 승인 자격정보가 동시에 있을 때만 외부 API 호출
- 승인 전 기본값은 OFF이며 테스트는 가짜 응답만 사용
- 고정 출발지 IP와 등록된 IP 일치 여부는 배포 전 별도 검증
- 수집원은 `integrated-best`와 `today-special`만 허용
- 공개 추천 상품은 최대 10개, 검색/카테고리/페이지네이션 없음
- 일반 `productUrl`은 저장·공개하지 않고 공식 링크 생성 API 결과만 저장·노출
- 토스 응답 원문·OAuth 토큰·Client Secret은 DB/로그에 저장하지 않음
- 대가성 문구는 추천 상품보다 먼저 보이도록 렌더링
- 상품 이미지 사용 권한 확인 전 이미지 필드는 공개 응답과 화면에서 제외
- API 오류 시 마지막 성공 스냅샷을 유지하고 기존 핫딜 수집에는 영향 없음

## Task 1 — 클라이언트·정규화·런타임 (TDD)

**Create**
- `src/toss-sharelink.js`
- `test/toss-sharelink.test.js`

**Requirements**
- OFF 기본값의 런타임 설정 파서
- 필수 환경변수: `TOSS_SHARELINK_ENABLED`, `TOSS_SHARELINK_CLIENT_ID`, `TOSS_SHARELINK_CLIENT_SECRET`, `TOSS_SHARELINK_PUBLISHER_ID`
- 선택 환경변수: `TOSS_SHARELINK_POLL_INTERVAL_MS`, `TOSS_SHARELINK_REQUEST_TIMEOUT_MS`, `TOSS_SHARELINK_MAX_ITEMS`
- 허용 범위: 1~10개, 수집 주기 최소 1시간, 요청 제한시간 1~30초
- OAuth client credentials 요청과 토큰 메모리 캐시
- `integrated-best` 및 `today-special`만 호출
- 링크 생성 API를 통해 `linkType=all` 링크만 공개 후보에 포함
- 응답 크기, JSON Content-Type, 리디렉션, 타임아웃, HTTP/공식 오류 코드 검증
- 상품 ID·제목·가격·공식 쉐어링크 호스트/HTTPS 정규화
- 중복 제거 후 최대 N개 선택, 이미지 미사용
- 로그/오류 메시지에 자격정보 및 토큰 미포함

**Verification**
- 먼저 실패 테스트를 확인하고 최소 구현 후 해당 테스트와 전체 테스트 통과

## Task 2 — 전용 저장소·공개 API·스케줄러 연결 (TDD)

**Modify**
- `db/schema.sql`
- `src/deal-store.js`
- `server.js`
- `.env.example`

**Create**
- `src/toss-recommendations-api.js`
- 관련 테스트 파일

**Requirements**
- `toss_recommendations` 전용 테이블: product ID, source kind, title, price, sharelink URL, rank, first/last seen, active 상태
- 원문 JSON·일반 상품 URL·토큰·비밀키·이미지 URL 미저장
- 스냅샷 성공 시 transaction으로 최대 10개 upsert 및 누락 상품 비활성화
- PostgreSQL advisory lock으로 중복 수집 방지
- `GET /api/toss-recommendations`는 활성화 시에만 최대 10개 반환; 비활성화/DB 미설정은 `{enabled:false,recommendations:[]}`
- 검색·정렬·카테고리·페이지네이션 쿼리 미지원
- `server.js`에서 기존 RSS/쿠팡과 독립된 polling collector로 연결
- 활성화 요청했으나 설정 누락 시 외부 호출 없이 경고
- 환경변수 예시에 실제 비밀값 없음

## Task 3 — 별도 텍스트형 추천 구좌 (TDD)

**Modify**
- `public/index.html`
- `public/app.js`
- `public/styles.css`
- 필요 시 브라우저 유틸/DOM 테스트

**Requirements**
- 쿠팡 구좌와 별개의 `토스쇼핑 오늘의 추천` 섹션
- API가 disabled/empty/error이면 섹션 전체 숨김
- 상품 카드 위에 다음 공식 문구를 먼저 표시:
  - `이 포스팅은 토스쇼핑 쉐어링크 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.`
- 최대 10개 텍스트형 카드: 출처 배지, 상품명, 가격, `토스쇼핑에서 보기`
- 링크에 `target=_blank`, `rel="sponsored noopener noreferrer"`
- 이미지·검색·카테고리·가격 비교 UI 없음
- DOM 삽입값 HTML escaping 및 URL 검증 유지
- 기존 레이아웃·검색·모바일 동작 회귀 없음

## Task 4 — 최종 검증 게이트

- 토스 관련 단위/통합/DOM 테스트
- `npm test` 전체 회귀
- 변경 파일 syntax 검사
- secret pattern 및 일반 product URL 저장 여부 검사
- 승인 전 실제 토스 API 호출이 발생하지 않는 테스트
- 독립 spec review 후 code-quality/security review
- 운영 배포·환경변수 등록·활성화는 수행하지 않음

## 승인 후 별도 작업

1. API 키 발급 및 민감정보 직접 입력
2. Render의 고정 outbound IP 지원 여부와 토스 등록 IP 일치 확인
3. 테스트 환경에서 1회 수동 수집 및 응답 필드 검증
4. 이미지 권한을 토스에 서면 확인하기 전 텍스트형 유지
5. 사용자 명시 승인 후 운영 환경변수 설정·배포·활성화
