const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const deals = [
  {
    id: 1,
    title: '삼성 갤럭시 버즈3 프로',
    price: 189000,
    originalPrice: 249000,
    store: '쿠팡',
    category: '디지털',
    temperature: 98,
    postedAt: '방금 전',
    url: '#'
  },
  {
    id: 2,
    title: '제주 왕복 항공권 특가',
    price: 39800,
    originalPrice: 79000,
    store: '여행 특가',
    category: '여행',
    temperature: 91,
    postedAt: '4분 전',
    url: '#'
  },
  {
    id: 3,
    title: '신라면 120g 20개',
    price: 13900,
    originalPrice: 19800,
    store: '11번가',
    category: '식품',
    temperature: 86,
    postedAt: '11분 전',
    url: '#'
  },
  {
    id: 4,
    title: '로지텍 MX Master 3S',
    price: 89900,
    originalPrice: 129000,
    store: '네이버쇼핑',
    category: '디지털',
    temperature: 82,
    postedAt: '18분 전',
    url: '#'
  },
  {
    id: 5,
    title: '스타벅스 아메리카노 2잔',
    price: 7200,
    originalPrice: 9000,
    store: '카카오톡 선물하기',
    category: '생활',
    temperature: 74,
    postedAt: '25분 전',
    url: '#'
  },
  {
    id: 6,
    title: '애플 에어팟 4세대',
    price: 169000,
    originalPrice: 199000,
    store: 'G마켓',
    category: '디지털',
    temperature: 69,
    postedAt: '32분 전',
    url: '#'
  }
];

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'easyshopping' });
});

app.get('/api/deals', (req, res) => {
  const category = req.query.category;
  const keyword = String(req.query.q || '').trim().toLowerCase();

  const filtered = deals.filter((deal) => {
    const categoryMatches = !category || category === '전체' || deal.category === category;
    const keywordMatches = !keyword || `${deal.title} ${deal.store}`.toLowerCase().includes(keyword);
    return categoryMatches && keywordMatches;
  });

  res.json({ updatedAt: new Date().toISOString(), count: filtered.length, deals: filtered });
});

app.listen(PORT, () => {
  console.log(`쉬운쇼핑 실행 중: http://localhost:${PORT}`);
});
