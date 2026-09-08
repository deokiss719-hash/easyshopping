# Cloudflare R2 연결 준비

현재 코드는 R2 자격증명 5개가 모두 있을 때만 업로드 adapter를 켭니다. 하나라도 비어 있으면 시작 오류 없이 비활성화되고 기존 placeholder를 표시합니다. 현재 판매처 provider는 의도적으로 등록하지 않았으므로 자격증명을 넣어도 임의 상품 검색이나 이미지 매칭은 일어나지 않습니다.

## Cloudflare에서 만들 것

1. Cloudflare 대시보드에서 **R2 Object Storage**를 엽니다.
2. **Create bucket**을 눌러 버킷을 하나 만듭니다. 예: `easyshopping-images`.
3. 버킷의 **Settings → Public access**에서 공개 주소를 준비합니다.
   - 운영용은 본인 도메인의 하위 도메인 연결을 권장합니다. 예: `https://images.example.com`
   - 시험용으로 Cloudflare가 허용한다면 `r2.dev` 공개 URL을 사용할 수 있습니다.
4. **Manage R2 API Tokens → Create API token**으로 이 버킷에만 범위를 제한한 Object Read & Write 토큰을 만듭니다.
5. 생성 직후 표시되는 Access Key ID와 Secret Access Key를 안전하게 보관합니다. Secret은 다시 표시되지 않을 수 있습니다.

## Render에 넣을 값

Render 서비스의 **Environment**에서 다음 5개를 추가합니다.

| 환경변수 | 넣을 값 |
|---|---|
| `R2_ACCOUNT_ID` | Cloudflare 계정 ID |
| `R2_ACCESS_KEY_ID` | R2 API 토큰의 Access Key ID |
| `R2_SECRET_ACCESS_KEY` | R2 API 토큰의 Secret Access Key |
| `R2_BUCKET_NAME` | 만든 버킷 이름, 예: `easyshopping-images` |
| `R2_PUBLIC_BASE_URL` | 공개 주소의 HTTPS 기준 URL, 끝 `/` 없이 입력 |

주의:

- Secret 값을 GitHub, 소스 코드, Discord에 붙여 넣지 않습니다.
- 토큰 권한은 가능하면 해당 버킷의 Object Read & Write로만 제한합니다.
- `R2_PUBLIC_BASE_URL`에는 S3 API endpoint가 아니라 브라우저에서 이미지를 읽을 공개 URL을 넣습니다.
- 다섯 값이 모두 설정돼야 adapter가 활성화됩니다.
- 실제 이미지는 향후 검증된 판매처별 provider가 등록된 후에만 처리됩니다.
