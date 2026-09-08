# 상품 이미지 파이프라인

## 현재 동작

- 뽐뿌 RSS 수집은 기존 방식으로 계속 동작합니다.
- RSS 설명에 **등록된 provider의 `merchantHosts`에 속하는 명시적 HTTPS 판매처 URL**이 있을 때만 `merchantUrl`로 저장합니다.
- 상품명으로 판매처를 검색하거나 검색 결과의 첫 상품을 선택하지 않습니다.
- RSS가 제공한 허용된 이미지 URL은 참고용 `sourceImageUrl`로만 저장하며 브라우저가 원본을 직접 요청하지 않습니다.
- 등록된 provider가 없거나 R2 환경변수가 하나라도 없으면 이미지 파이프라인은 비활성 상태이며 기존 placeholder를 유지합니다.
- 뽐뿌 원문 페이지를 이미지 때문에 추가 요청하지 않습니다.

## 구성 요소

- `src/images/provider-registry.js`: HTTPS 판매처 URL 검증 및 provider 선택
- `src/images/webp.js`: Sharp 기반 WebP 변환, 리사이즈, 메타데이터 제거, 용량 제한
- `src/images/r2-storage.js`: Cloudflare R2(S3 호환) 업로드 및 공개 URL 생성
- `src/images/image-pipeline.js`: provider → WebP → R2 → DB 상태 갱신과 실패 캐시
- `DealStore.listImageBackfillCandidates()`: 판매처 URL이 있고 이미지가 없는 재처리 후보 조회

## Provider 계약

provider는 향후 판매처별로 검증을 마친 뒤 명시적으로 등록합니다.

```js
{
  name: 'official-shop',
  canHandle(url) {
    return url.hostname === 'shop.example.com';
  },
  isAllowedImageUrl(url) {
    return url.hostname === 'cdn.example.com';
  },
  async fetchImageCandidate({ merchantUrl, deal }) {
    return {
      sourceImageUrl: 'https://cdn.example.com/product.jpg',
      contentType: 'image/jpeg',
      body: Buffer.from(/* downloaded image bytes */),
    };
  },
}
```

provider는 반드시 전달받은 `merchantUrl`의 공식 공개 상품 페이지만 사용해야 합니다. 검색 결과를 이용한 추정 매칭은 금지합니다. 현재 운영 registry는 의도적으로 비어 있습니다.

## 이미지 상태

- `missing_merchant_url`: 확정된 판매처 URL 없음
- `pending`: 판매처 URL은 있으나 아직 처리 전
- `ready`: 자체 공개 URL 저장 완료
- `failed`: 처리 실패, `image_retry_at` 전까지 재시도 안 함
- `unsupported_provider`: 해당 판매처 provider 없음

원본 후보는 `source_image_url`, 서비스가 노출하는 최종 자체 URL은 기존 `image_url`에 각각 저장합니다.
