const test = require('node:test');
const assert = require('node:assert/strict');

const { CATEGORIES, classifyDeal } = require('../src/deal-category');

const cases = [
  ['갤럭시 S26 자급제 스마트폰 특가', '디지털/가전'],
  ['신라면 20봉 컵라면 묶음', '식품'],
  ['테팔 프라이팬 냄비 5종 세트', '생활/주방'],
  ['나이키 에어맥스 운동화 남성 신발', '패션/의류'],
  ['수분 선크림 톤업 크림 2개', '뷰티'],
  ['프로메가 오메가3 영양제 6박스', '건강'],
  ['하기스 네이처메이드 아기 기저귀 2박스', '육아/아동'],
  ['PS5 디스크 에디션 콘솔', '게임'],
  ['캠핑 텐트 등산용품 세트', '스포츠/레저'],
  ['고양이 사료 10kg 반려묘 간식', '반려동물'],
  ['불스원샷 자동차 연료첨가제 1+1', '자동차'],
  ['제주 호텔 숙박권 2박 조식 포함', '여행/숙박'],
  ['신세계 모바일 상품권 5만원권', '상품권/쿠폰'],
  ['이름 모를 랜덤박스 특가', '기타'],
];

test('지원하는 카테고리는 요구된 14개로 고정한다', () => {
  assert.deepEqual(CATEGORIES, [
    '디지털/가전', '식품', '생활/주방', '패션/의류', '뷰티', '건강', '육아/아동',
    '게임', '스포츠/레저', '반려동물', '자동차', '여행/숙박', '상품권/쿠폰', '기타',
  ]);
});

test('대표 상품 제목을 실제 상품 종류에 맞게 분류한다', () => {
  for (const [title, expected] of cases) {
    assert.equal(classifyDeal({ title }), expected, title);
  }
});

test('일반 식품 단어보다 반려동물·육아·건강의 복합 문맥을 우선한다', () => {
  assert.equal(classifyDeal({ title: '강아지 닭가슴살 간식 30개입' }), '반려동물');
  assert.equal(classifyDeal({ title: '아기 유아 이유식 한우죽 10팩' }), '육아/아동');
  assert.equal(classifyDeal({ title: '종근당 비타민C 건강기능식품 180정' }), '건강');
  assert.equal(classifyDeal({ title: '티엘푸드 병아리콩 건강간식 10개' }), '식품');
});

test('실제 RSS 제목의 배송 문구를 과일 배로 오인하지 않고 알려진 상품 유형을 분류한다', () => {
  const regressions = [
    ['네파 고어텍스 비브람 로우 트레킹화 (77,760원/무료배송)', '스포츠/레저'],
    ['은나노스텝 다용도 세정제 선물세트', '생활/주방'],
    ['끌레도르 바 5종 30개 골라담기', '식품'],
    ['여성 레이어 크롭 라운드넥 가디건', '패션/의류'],
    ['차이슨 슈퍼소닉 BLDC 헤어드라이어', '디지털/가전'],
    ['빙그레 더단백 드링크 고함량', '건강'],
    ['남양 과수원 5종 190ml 24팩', '식품'],
    ['CJ 명절 선물세트 스팸 복합 100호', '식품'],
    ['노르웨이 생연어회 몸뱃살 순살 필렛', '식품'],
    ['나인웨스트 뉴 아르크 루나백 M520', '패션/의류'],
    ['치아바타 샌드위치 3입 6팩', '식품'],
    ['시크릿데이 입오버 생리대 60장', '생활/주방'],
    ['시네마 카라멜 팝콘 75g 8개입', '식품'],
    ['뼈 없는 흑돼지 삼겹갈비 600g', '식품'],
    ['서해안 활꽃게 2kg 당일조업', '식품'],
    ['정관장 에브리타임 오리지널 6년근 30포', '건강'],
  ];
  for (const [title, expected] of regressions) {
    assert.equal(classifyDeal({ title }), expected, title);
  }
});

test('키위·몬스터크랩·LA갈비를 식품으로 분류한다', () => {
  const foodTitles = [
    '제스프리 골드키위 점보과 2.5kg',
    '한성 몬스터크랩 72g 10개',
    '미국산 초이스 LA갈비 2kg',
  ];
  for (const title of foodTitles) {
    assert.equal(classifyDeal({ title }), '식품', title);
  }
});

test('명확한 제목 분류는 설명의 부가 상품권 문구보다 우선한다', () => {
  assert.equal(classifyDeal({
    title: 'LG 트롬 세탁기건조기세트 트루스팀 23kg+20kg',
    description: '구매 혜택 상품권, 모바일쿠폰, 포인트 충전권 제공',
  }), '디지털/가전');
});

test('짧은 ASCII 기기 토큰을 일반 브랜드 문자열 안에서 오인하지 않는다', () => {
  assert.notEqual(classifyDeal({ title: 'SPC삼립 빵 세트' }), '디지털/가전');
  assert.notEqual(classifyDeal({ title: 'UPC 바코드 스티커 100매' }), '디지털/가전');
  assert.equal(classifyDeal({ title: '조립 PC 본체 특가' }), '디지털/가전');
});

test('제목이 짧을 때 설명을 보조 신호로 사용하고 근거가 약하면 기타로 둔다', () => {
  assert.equal(classifyDeal({ title: '오늘의 특가', description: '무선 블루투스 키보드와 마우스 세트' }), '디지털/가전');
  assert.equal(classifyDeal({ title: '오늘만 할인', description: '좋은 제품을 저렴하게 판매합니다' }), '기타');
});
