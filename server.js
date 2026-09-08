const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const { migrate, createDealStore } = require('./src/deal-store');
const { createLiveDealsRouter } = require('./src/live-deals-api');
const { runRssCollector } = require('./src/rss-collector');
const { classifyDeal } = require('./src/deal-category');
const { startPollingCollector } = require('./src/polling-collector');
const { createProviderRegistry } = require('./src/images/provider-registry');
const { readR2Config, createR2Storage } = require('./src/images/r2-storage');
const { createImagePipeline, runImageBackfill } = require('./src/images/image-pipeline');
const { buildContentSecurityPolicy } = require('./src/content-security-policy');

const app = express();
const PORT = process.env.PORT || 3000;
let databaseMode = 'fixture';

const deals = [
  {
    id: 1, badge: 'HOT', title: '삼성 갤럭시 버즈3 프로', price: 189000, originalPrice: 279000,
    store: '쿠팡', shipping: '무료배송', category: '디지털', postedMinutes: 10,
    views: 2381, comments: 23, votes: 128, imageLabel: 'Buds 3 Pro', imageTone: 'blue', url: '#'
  },
  {
    id: 2, badge: '인기', title: 'LG 울트라기어 27인치 게이밍 모니터', price: 299000, originalPrice: 449000,
    store: 'G마켓', shipping: '무료배송', category: '가전', postedMinutes: 18,
    views: 1958, comments: 31, votes: 116, imageLabel: '27” Display', imageTone: 'navy', url: '#'
  },
  {
    id: 3, badge: 'HOT', title: '농심 신라면 120g 20봉', price: 13900, originalPrice: 19800,
    store: '11번가', shipping: '무료배송', category: '식품', postedMinutes: 26,
    views: 1732, comments: 17, votes: 94, imageLabel: '辛 20 PACK', imageTone: 'red', url: '#'
  },
  {
    id: 4, badge: '신규', title: '다우니 초고농축 섬유유연제 1L 3개', price: 17900, originalPrice: 28900,
    store: '네이버쇼핑', shipping: '무료배송', category: '생활', postedMinutes: 4,
    views: 621, comments: 6, votes: 42, imageLabel: 'DAILY', imageTone: 'mint', url: '#'
  },
  {
    id: 5, badge: '인기', title: '뉴발란스 530 클래식 스니커즈', price: 79000, originalPrice: 119000,
    store: '무신사', shipping: '무료배송', category: '패션', postedMinutes: 42,
    views: 1410, comments: 28, votes: 103, imageLabel: 'NB 530', imageTone: 'gray', url: '#'
  },
  {
    id: 6, badge: 'HOT', title: '닌텐도 스위치 OLED 화이트', price: 339000, originalPrice: 415000,
    store: 'SSG.COM', shipping: '무료배송', category: '게임', postedMinutes: 35,
    views: 1623, comments: 45, votes: 121, imageLabel: 'SWITCH OLED', imageTone: 'yellow', url: '#'
  },
  {
    id: 7, badge: '신규', title: '라운드랩 자작나무 수분 선크림 2개', price: 23800, originalPrice: 50000,
    store: '올리브영', shipping: '무료배송', category: '뷰티', postedMinutes: 7,
    views: 486, comments: 8, votes: 37, imageLabel: 'SPF 50+', imageTone: 'sky', url: '#'
  },
  {
    id: 8, badge: '추천', title: '팸퍼스 베이비드라이 팬티형 4팩', price: 74900, originalPrice: 99000,
    store: '옥션', shipping: '무료배송', category: '육아', postedMinutes: 55,
    views: 845, comments: 12, votes: 68, imageLabel: 'BABY DRY', imageTone: 'purple', url: '#'
  },
  {
    id: 9, badge: '신규', title: '로지텍 MX Master 3S 무선 마우스', price: 89900, originalPrice: 129000,
    store: '네이버 브랜드스토어', shipping: '무료배송', category: '디지털', postedMinutes: 2,
    views: 392, comments: 5, votes: 31, imageLabel: 'MX 3S', imageTone: 'dark', url: '#'
  },
  {
    id: 10, badge: '추천', title: '테팔 매직핸즈 프라이팬 5종 세트', price: 89900, originalPrice: 159000,
    store: '롯데온', shipping: '무료배송', category: '생활', postedMinutes: 63,
    views: 916, comments: 14, votes: 71, imageLabel: '5 PIECES', imageTone: 'orange', url: '#'
  }
];

function discountRate(deal) {
  return Math.round((1 - deal.price / deal.originalPrice) * 100);
}

function withComputedFields(deal) {
  return {
    ...deal,
    discountRate: discountRate(deal),
    postedAt: deal.postedMinutes < 60 ? `${deal.postedMinutes}분 전` : `${Math.floor(deal.postedMinutes / 60)}시간 전`
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'easyshopping', version: '0.4.0', database: databaseMode });
});

app.get('/api/deals', (req, res) => {
  const category = String(req.query.category || '전체');
  const keyword = String(req.query.q || '').trim().toLowerCase();
  const sort = String(req.query.sort || 'popular');

  const filtered = deals
    .filter((deal) => {
      const categoryMatches = category === '전체' || deal.category === category;
      const searchText = `${deal.title} ${deal.store} ${deal.category}`.toLowerCase();
      return categoryMatches && (!keyword || searchText.includes(keyword));
    })
    .map(withComputedFields)
    .sort((a, b) => {
      if (sort === 'latest') return a.postedMinutes - b.postedMinutes;
      if (sort === 'discount') return b.discountRate - a.discountRate;
      if (sort === 'price-low') return a.price - b.price;
      return (b.views + b.votes * 8 + b.comments * 5) - (a.views + a.votes * 8 + a.comments * 5);
    });

  res.json({
    updatedAt: new Date().toISOString(),
    count: filtered.length,
    deals: filtered
  });
});

app.get('/api/popular', (_req, res) => {
  const popular = deals
    .map(withComputedFields)
    .sort((a, b) => (b.views + b.votes * 8) - (a.views + a.votes * 8))
    .slice(0, 5);
  res.json({ deals: popular });
});

async function start() {
  let store = null;
  const r2Config = readR2Config(process.env);
  const contentSecurityPolicy = buildContentSecurityPolicy(r2Config);
  app.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', contentSecurityPolicy);
    next();
  });
  app.use(express.static(path.join(__dirname, 'public')));

  if (process.env.DATABASE_URL) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await migrate(pool);
    store = createDealStore(pool);
    const reclassified = await store.reclassify(classifyDeal);
    console.log(`기존 핫딜 카테고리 재분류 완료: ${reclassified}건 변경`);
    databaseMode = 'postgresql';

    const feedUrl = process.env.RSS_FEED_URL
      || 'https://www.ppomppu.co.kr/rss.php?id=ppomppu';
    const source = process.env.RSS_FEED_SOURCE || 'ppomppu';
    const intervalMs = Number(process.env.RSS_POLL_INTERVAL_MS || 600000);
    const imageStorage = createR2Storage({ config: r2Config });
    const providerRegistry = createProviderRegistry([]);
    const imagePipeline = createImagePipeline({
      store,
      storage: imageStorage,
      providerRegistry,
    });
    if (!imageStorage.enabled) {
      console.log(`상품 이미지 업로드 비활성화: ${r2Config.missing.join(', ')} 환경변수 필요`);
    } else {
      console.log('상품 이미지 R2 업로드 준비 완료; 등록된 판매처 provider만 사용');
    }
    startPollingCollector({
      collect: async () => {
        const result = await runRssCollector({
          source,
          feedUrl,
          allowedHosts: ['www.ppomppu.co.kr'],
          allowedMerchantHosts: providerRegistry.merchantHosts,
          enrichImages: false,
          store,
        });
        if (imagePipeline.enabled) {
          try {
            const imageResult = await runImageBackfill({ store, pipeline: imagePipeline, limit: 20 });
            console.log('상품 이미지 backfill 완료', imageResult);
          } catch (error) {
            console.warn('상품 이미지 backfill 실패', { reason: error?.code || 'backfill_error' });
          }
        }
        return result;
      },
      intervalMs,
    });
  }

  app.use('/api/live-deals', createLiveDealsRouter(store, {
    imageBaseUrls: r2Config.enabled ? [r2Config.publicBaseUrl] : [],
  }));
  app.listen(PORT, () => {
    console.log(`이지쇼핑 실행 중: http://localhost:${PORT} (${databaseMode})`);
  });
}

start().catch((error) => {
  console.error('이지쇼핑 시작 실패:', error);
  process.exitCode = 1;
});
