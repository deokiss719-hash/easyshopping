const test = require('node:test');
const assert = require('node:assert/strict');
const { unitPrice } = require('../public/deal-value');
const { classifyDeal } = require('../src/deal-category');
test('clear pack sizes provide comparable prices without inventing shipping or discounts', () => {
  assert.equal(unitPrice({ source: 'toss', title: '생수, 330ml, 40개', price: 11900 }), '330ml당 약 298원');
  assert.equal(unitPrice({ source: 'toss', title: '치약, 120g, 8개', price: 13900 }), '120g당 약 1,738원');
  for (const title of ['커피, 0.9g, 100개입, 2개', '음료 500ml+200ml, 20개', '혼합 음료, 500ml, 20개', '샘물, 500ml, 0개', '생수, 500ml, 1개', '샘물, 500ml, 40개 + 2개 증정']) {
    assert.equal(unitPrice({ source:'toss', title, price:10000 }), '');
  }
  assert.equal(unitPrice({ source:'ppomppu', title:'생수, 500ml, 40개', price:10000 }), '');
});
test('previously unclassified common goods appear in their relevant category', () => {
  for (const title of ['농부의 정육점 한돈 뒷고기, 500g, 2개', '오레오 화이트 크림, 100g, 3개', '제주 삼다수, 330ml, 40개', '펩시콜라 제로슈거, 355ml, 48개', '할리스 시그니처 아메리카노']) assert.equal(classifyDeal({ title }), '식품', title);
  assert.equal(classifyDeal({ title:'코디 순수 3겹 데코, 30m, 30롤, 1개' }), '생활/주방');
  assert.equal(classifyDeal({ title:'쉬젤 믹싱볼 채반 세트' }), '생활/주방');
  assert.equal(classifyDeal({ title:'괄사 마사지 3종' }), '뷰티');
  assert.equal(classifyDeal({ title:'강아지 닭가슴살 간식' }), '반려동물');
  assert.equal(classifyDeal({ title:'콜라겐 영양제' }), '건강');
  assert.equal(classifyDeal({ title:'고칼슘 비타민D 두유 21곡 미숫가루' }), '식품');
});
