# 토스쇼핑 웹 동기화

현재 토스 베스트 50개를 웹 DB에 등록한다. 평점 4.5 이상·리뷰 100개 이상이며 순위 30위 이내 또는 최근 24시간 사이트 클릭 3회 이상인 상품에는 인기 표시를 붙인다.

- 저장된 메시지 해시·발행 확인 시각·확인 증거·메시지 속 수익화 링크 검증
- 기존 수익화 링크 재사용. 새 인기상품은 DB 예약 후 링크를 발급하고 저장한다. pending/uncertain 발급은 자동 재시도하지 않는다. 메시지 발송 없음
- 현재 가격·이미지 갱신, `(source, source_item_id)` 기준 중복 방지
- 품절·현재 베스트 목록 제외·확정 목록 제외 상품 종료
- 빈 응답·불완전 응답·잘못된 상품 응답은 쓰기 전에 중단
- PostgreSQL advisory lock으로 조회부터 저장까지 직렬화, 전체 갱신은 한 트랜잭션
- 갱신이 30분 이상 멈추면 웹 조회에서 토스 상품 숨김
- 실제 응답에서 확인한 `shopping.toss.im`과 기존 `static.toss.im` HTTPS 이미지 허용. 다른 이미지는 자리 표시자
- 웹 API `source=toss`, `source=all` 추가. 기존 `community` 의미 유지
- 제휴 고지 및 sponsored 링크 속성 적용. 출처 필터는 URL에 저장

## 명령

```sh
npm run toss:web:preview   # DB 쓰기 없는 미리보기
npm run toss:web:sync      # 웹 DB에만 반영
node scripts/manage-toss-web-launchagent.js install
```

macOS 키체인의 기존 `easyshopping-toss-sharelink-{access-key,secret-key,member-id}` 항목과 `com.easyhotdeal.image-backfill` / `DATABASE_URL` 항목을 사용한다. 값은 출력하지 않는다. SQLite는 readOnly로 열고 운영 토큰 캐시는 건드리지 않는다.

기본 DB: `~/Library/Application Support/EasyHotDeal/kakao-auto.sqlite`. 직접 CLI 실행 시 `KAKAO_AUTO_DB_PATH`로 바꿀 수 있다.

설치할 때는 테스트가 끝난 고정된 릴리스 폴더에서 실행한다. 별도 LaunchAgent `com.easyhotdeal.toss-web-sync`가 설치 직후 및 하루마다 실행된다. 정상 실행은 순위 조회 1회, 신규 링크 최대 48회, 링크 발급 뒤 확인 조회 1회로 토스 OpenAPI 사용량을 50회로 제한한다. 링크 요청은 API의 순간 요청 제한을 넘지 않도록 간격을 두며, 순위 조회가 일시적으로 실패하면 제한된 횟수만 자동 재시도한다. Mac이 켜져 있고 사용자 세션이 살아 있어야 한다.

로그: `~/Library/Logs/EasyHotDeal/toss-web-sync.log`, `toss-web-sync.error.log`.

## 검증 / 복구

1. 미리보기의 확정 건수·상품을 확인한다.
2. 배포 뒤 `/api/live-deals?source=toss`, `source=all`, `source=community`를 확인한다.
3. 실행 1회 뒤 동기화를 다시 실행해 중복이 없는지 확인한다.
4. 브라우저에서 출처 필터·가격 정렬·더 보기와 상품 이미지·제휴 고지를 확인한다.

중단은 해당 LaunchAgent만 `launchctl bootout`한다. 토스 상품은 마지막 갱신 26시간 후 자동 숨김된다. 기존 커뮤니티 상품과 카카오 발행은 영향을 받지 않는다. 웹 코드 롤백은 Render에서 직전 배포 커밋을 다시 배포한다. 데이터 삭제는 필요 없다.

사이트 클릭은 서명된 방문 쿠키 기준 상품별 하루 1회 집계한다. 봇·관리자·다른 출처 요청은 제외한다. 최근 24시간 클릭 수로 인기순 정렬하며 동률이면 인기상품·토스 순위를 사용한다. 구매나 토스 내부 실적을 뜻하지 않는다. 클릭 해시는 48시간 뒤 정리한다. dry-run은 DB 없이 순위 기준 후보를 확인하므로 클릭 신호는 포함하지 않는다.
