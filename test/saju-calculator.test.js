const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const { calculate, normalize, god } = require('../src/saju/calculator');
const { generate } = require('../src/saju/report');
const now = DateTime.fromISO('2040-01-01');
const input = (date = '1990-01-01', time = '12:00', zone = 'Asia/Seoul') => ({
  date,
  time,
  zone,
  calendar: 'solar',
  timeType: 'exact',
});
test('Korean conversion: published leap-month example and impossible leap month', () => {
  const a = normalize({ ...input('2017-05-01'), calendar: 'lunar', leap: true }, now);
  assert.deepEqual(a.date, { year: 2017, month: 6, day: 24 });
  assert.throws(
    () => normalize({ ...input('2017-03-01'), calendar: 'lunar', leap: true }, now),
    /윤달/,
  );
  const b = normalize({ ...input('1956-01-21'), calendar: 'lunar', leap: false }, now);
  assert.deepEqual(b.date, { year: 1956, month: 3, day: 3 });
});
test('KASI 2024 입춘 17:27 KST: different year/month either side, guarded exact boundary', () => {
  const a = calculate(input('2024-02-04', '17:24'), now),
    b = calculate(input('2024-02-04', '17:30'), now);
  assert.equal(a.pillars.year.chars, '癸卯');
  assert.equal(b.pillars.year.chars, '甲辰');
  assert.equal(a.pillars.month.chars, '乙丑');
  assert.equal(b.pillars.month.chars, '丙寅');
  assert.throws(() => calculate(input('2024-02-04', '17:27'), now), /절기 경계/);
});
test('month changes at 절입, not lunar month start', () => {
  const a = calculate(input('2024-03-05', '11:20'), now),
    b = calculate(input('2024-03-05', '11:30'), now);
  assert.equal(a.pillars.month.chars, '丙寅');
  assert.equal(b.pillars.month.chars, '丁卯');
});
test('unknown time has no hour and does not pretend a term-boundary month is fixed', () => {
  const a = calculate({ ...input(), timeType: 'unknown' }, now);
  assert.equal(a.pillars.hour, null);
  assert.equal(a.visibleCount, 6);
  const b = calculate({ ...input('2024-02-04'), timeType: 'unknown' }, now);
  assert.equal(b.pillars.month, null);
  assert.equal(b.pillars.year, null);
  assert.equal(b.visibleCount, 2);
  assert.equal(b.luck[0].cycles.length, 0);
});
test('approximate period crossing an hour pillar contains alternatives', () => {
  const a = calculate({ ...input(), timeType: 'range', period: 0 }, now);
  assert.equal(a.variants.hour.length, 2);
  assert.equal(a.pillars.hour, null);
});
test('civil midnight convention: 23:00 retains day, next midnight changes day and hour stem', () => {
  const a = calculate(input('1990-01-01', '22:59'), now),
    b = calculate(input('1990-01-01', '23:59'), now),
    c = calculate(input('1990-01-02', '00:00'), now);
  assert.equal(a.pillars.day.chars, b.pillars.day.chars);
  assert.notEqual(b.pillars.day.chars, c.pillars.day.chars);
  assert.notEqual(b.pillars.hour.stem, c.pillars.hour.stem);
});
test('historical Korean timezone and DST gaps/duplicates are not silently normalized', () => {
  const a = calculate(input('1960-01-01', '12:00'), now);
  assert.match(a.sampleRange[0], /\+08:30$/);
  assert.throws(() => calculate(input('1988-05-08', '02:30'), now), /존재하지 않는 시각/);
  assert.throws(() => calculate(input('1988-10-09', '02:30'), now), /두 번 존재/);
});
test('same instant gives same term pillars in different zones', () => {
  const a = calculate(input('2000-02-04', '22:00', 'Asia/Seoul'), now),
    b = calculate(input('2000-02-04', '08:00', 'America/New_York'), now);
  assert.equal(a.pillars.year.chars, b.pillars.year.chars);
  assert.equal(a.pillars.month.chars, b.pillars.month.chars);
});
test('ten gods relationships/polarity', () => {
  assert.equal(god('甲', '甲'), '비견');
  assert.equal(god('甲', '乙'), '겁재');
  assert.equal(god('甲', '丙'), '식신');
  assert.equal(god('甲', '己'), '정재');
  assert.equal(god('甲', '辛'), '정관');
  assert.equal(god('甲', '癸'), '정인');
});
test('deterministic report: every interpretation resolves to structured evidence', () => {
  const chart = calculate(input(), now);
  const a = generate(chart),
    b = generate(calculate(input(), now));
  assert.deepEqual(a, b);
  assert.equal(a.sections.length, 8);
  for (const s of a.sections)
    for (const b of s.blocks) {
      assert.ok(a.evidence[b.id].length);
      for (const e of a.evidence[b.id]) assert.notEqual(e.value, undefined, e.path);
    }
  assert.equal(chart.luck.length, 2);
  assert.equal(chart.annual.length, 5);
});
test('input validation excludes impossible/future/unsupported data', () => {
  assert.throws(() => calculate(input('2001-02-29'), now));
  assert.throws(() => calculate(input('2041-01-01'), now));
  assert.throws(() => calculate(input('1990-01-01', '25:00'), now));
  assert.throws(() => calculate(input('1990-01-01', '12:00', 'Mars/Base'), now));
});
