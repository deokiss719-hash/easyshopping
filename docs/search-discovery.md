# 검색 노출 개선 (2026-09-30)

- 홈: 실시간 핫딜 중심을 유지하면서 휴대폰 상담·커뮤니티·사주를 설명에 포함.
- 휴대폰: 아이폰·갤럭시 / 번호이동·기기변경 / 구매 상담 검색 의도를 제목·설명·공개 본문에 반영. 가입 방식 설명과 가격 비교 체크포인트, 상담 연결. 재고·가격·최저가를 만들어 표시하지 않음. WebPage/Service 구조화 데이터.
- 사주: 쿼리 없는 /saju 및 /saju/ 시작 화면만 index. 결제/복구/관리/API/쿼리 URL은 X-Robots-Tag noindex 유지. 기존 인증·암호화·응답 투영 변경 없음.
- 동적 및 정적 fallback 사이트맵: phone.html, saju, advertise.html 추가. 근거 없는 요청 당 오늘 lastmod 제거; 실제 상품/게시글 변경일만 유지.
- 커뮤니티: 기존 canonical 유지, 공유 이미지/아이콘 추가.

## 출처
- Google 제목 가이드: https://developers.google.com/search/docs/appearance/title-link
- Google 링크: https://developers.google.com/search/docs/crawling-indexing/links-crawlable
- Google 사이트맵: https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- Naver 사이트맵: https://searchadvisor.naver.com/guide/request-feed

사이트맵과 명확한 제목/본문은 발견과 이해를 돕지만 순위나 색인을 보장하지 않는다. 검색 도구의 색인 상태/노출/클릭은 별도 계정 접근 및 실제 수집 후 확인해야 한다. 키워드 검색량 측정이나 유료 광고 키워드 등록을 수행한 것으로 간주하지 않는다.
