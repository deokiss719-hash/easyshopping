'use strict';
const { Solar, LunarUtil } = require('lunar-javascript');
const KoreanCalendar = require('korean-lunar-calendar');
const { DateTime } = require('luxon');
const VERSION = 'kr-standard-midnight-1';
const STEMS = '甲乙丙丁戊己庚辛壬癸';
const BRANCHES = '子丑寅卯辰巳午未申酉戌亥';
const KR = Object.fromEntries(
  [...'甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥'].map((c, i) => [
    c,
    [
      '갑',
      '을',
      '병',
      '정',
      '무',
      '기',
      '경',
      '신',
      '임',
      '계',
      '자',
      '축',
      '인',
      '묘',
      '진',
      '사',
      '오',
      '미',
      '신',
      '유',
      '술',
      '해',
    ][i],
  ]),
);
const ELEMENTS = ['목', '화', '토', '금', '수'];
const SG = ['목', '목', '화', '화', '토', '토', '금', '금', '수', '수'];
const BG = ['수', '토', '목', '목', '토', '화', '화', '토', '금', '금', '토', '수'];
const ZONES = {
  'Asia/Seoul': '대한민국',
  'Asia/Tokyo': '일본 도쿄·동일 시간대 지역',
  'Asia/Shanghai': '중국 상하이·동일 시간대 지역',
  'Asia/Taipei': '대만',
  'Asia/Hong_Kong': '홍콩',
  'America/New_York': '미국 동부(뉴욕)',
  'America/Chicago': '미국 중부(시카고)',
  'America/Denver': '미국 산악(덴버)',
  'America/Los_Angeles': '미국 서부(LA)',
  'Pacific/Honolulu': '미국 하와이',
  'Europe/London': '영국(런던)',
  'Europe/Paris': '프랑스(파리)',
  'Australia/Sydney': '호주(시드니)',
  'Pacific/Auckland': '뉴질랜드(오클랜드)',
};
const ko = (s) => [...s].map((c) => KR[c] || c).join('');
const mod = (n, m) => ((n % m) + m) % m;
function god(day, stem) {
  const d = STEMS.indexOf(day),
    s = STEMS.indexOf(stem),
    relation = mod(Math.floor(s / 2) - Math.floor(d / 2), 5),
    same = d % 2 === s % 2;
  return [
    ['비견', '겁재'],
    ['식신', '상관'],
    ['편재', '정재'],
    ['편관', '정관'],
    ['편인', '정인'],
  ][relation][same ? 0 : 1];
}
function pillar(chars, day) {
  if (!chars) return null;
  return {
    chars,
    korean: ko(chars),
    stem: chars[0],
    branch: chars[1],
    elementStem: SG[STEMS.indexOf(chars[0])],
    elementBranch: BG[BRANCHES.indexOf(chars[1])],
    yinYangStem: STEMS.indexOf(chars[0]) % 2 ? '음' : '양',
    yinYangBranch: BRANCHES.indexOf(chars[1]) % 2 ? '음' : '양',
    tenGod: god(day, chars[0]),
    hiddenStems: LunarUtil.ZHI_HIDE_GAN[chars[1]].map((s) => ({
      stem: s,
      korean: ko(s),
      tenGod: god(day, s),
    })),
  };
}
function normalize(input, now = DateTime.now()) {
  if (
    !input ||
    !['solar', 'lunar'].includes(input.calendar) ||
    !['exact', 'range', 'unknown'].includes(input.timeType) ||
    !Object.hasOwn(ZONES, input.zone)
  )
    throw new TypeError('날짜 구분, 출생 지역, 시각 구분을 확인해 주세요.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || ''))
    throw new TypeError('생년월일을 확인해 주세요.');
  let [year, month, day] = input.date.split('-').map(Number);
  if (year < 1900 || year > now.year)
    throw new TypeError('1900년 이후의 생년월일을 입력해 주세요.');
  const c = new KoreanCalendar();
  if (input.calendar === 'lunar') {
    if (typeof input.leap !== 'boolean' || !c.setLunarDate(year, month, day, input.leap))
      throw new TypeError('존재하지 않는 음력 날짜 또는 윤달이에요.');
    const l = c.getLunarCalendar();
    if (l.intercalation !== input.leap || l.year !== year || l.month !== month || l.day !== day)
      throw new TypeError('해당 연월에는 요청한 윤달이 없어요.');
    ({ year, month, day } = c.getSolarCalendar());
  } else if (!c.setSolarDate(year, month, day)) throw new TypeError('존재하지 않는 양력 날짜예요.');
  const date = DateTime.fromObject({ year, month, day }, { zone: input.zone });
  if (!date.isValid || date > now) throw new TypeError('미래 날짜 또는 존재하지 않는 날짜예요.');
  // No guardian/identity collection in v1. The age limitation is stated before entry.
  if (date > now.minus({ years: 14 }).startOf('day'))
    throw new TypeError('현재 서비스는 만 14세 이상만 이용할 수 있어요.');
  let minutes;
  if (input.timeType === 'exact') {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time || ''))
      throw new TypeError('태어난 시각을 확인해 주세요.');
    const [h, m] = input.time.split(':').map(Number);
    minutes = [h * 60 + m];
  } else if (input.timeType === 'range') {
    if (!Number.isInteger(input.period) || input.period < 0 || input.period > 11)
      throw new TypeError('두 시간 단위의 시간대를 선택해 주세요.');
    minutes = Array.from({ length: 120 }, (_, i) => input.period * 120 + i);
  } else minutes = Array.from({ length: 1440 }, (_, i) => i);
  return {
    input: {
      date: input.date,
      calendar: input.calendar,
      leap: input.calendar === 'lunar' ? input.leap : false,
      zone: input.zone,
      timeType: input.timeType,
      ...(input.timeType === 'exact'
        ? { time: input.time }
        : input.timeType === 'range'
          ? { period: input.period }
          : {}),
      name: typeof input.name === 'string' ? input.name.trim().slice(0, 30) : '',
    },
    date: { year, month, day },
    minutes,
  };
}
function atMinute(date, minute, zone) {
  const dt = DateTime.fromObject(
    { ...date, hour: Math.floor(minute / 60), minute: minute % 60 },
    { zone },
  );
  if (!dt.isValid || dt.hour !== Math.floor(minute / 60) || dt.minute !== minute % 60) return [];
  return dt.getPossibleOffsets();
}
function solar(dt) {
  return Solar.fromYmdHms(dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second);
}
function termInstant(term) {
  return DateTime.fromFormat(term.getSolar().toYmdHms(), 'yyyy-MM-dd HH:mm:ss', { zone: 'UTC+8' });
}
function raw(dt) {
  const china = solar(dt.setZone('UTC+8')).getLunar();
  const local = solar(dt).getLunar();
  const day = local.getDayInGanZhi(); // civil midnight, not 23:00; hour stem from same day.
  const bi = Math.floor((dt.hour + 1) / 2) % 12;
  const hour = STEMS[((STEMS.indexOf(day[0]) % 5) * 2 + bi) % 10] + BRANCHES[bi];
  return {
    year: china.getYearInGanZhiExact(),
    month: china.getMonthInGanZhiExact(),
    day,
    hour,
    china,
    dt,
  };
}
function calculate(input, now = DateTime.now()) {
  const n = normalize(input, now),
    samples = [];
  // Minute-level enumeration ensures a period crossing a solar term or DST transition never invents a single chart.
  for (const minute of n.minutes)
    for (const dt of atMinute(n.date, minute, input.zone)) samples.push(raw(dt));
  if (!samples.length)
    throw new TypeError('표준시 변경으로 존재하지 않는 시각이에요. 출생 기록을 확인해 주세요.');
  if (input.timeType === 'exact' && samples.length > 1)
    throw new TypeError(
      '서머타임 종료로 두 번 존재하는 시각이에요. 대략적인 시간대를 선택하면 두 가능성을 표시해요.',
    );
  const variants = {};
  for (const key of ['year', 'month', 'day', 'hour'])
    variants[key] = [...new Set(samples.map((s) => s[key]))];
  const day = variants.day[0];
  const pillars = Object.fromEntries(
    Object.entries(variants).map(([k, v]) => [
      k,
      v.length === 1 && !(k === 'hour' && input.timeType === 'unknown')
        ? pillar(v[0], day[0])
        : null,
    ]),
  );
  const elements = Object.fromEntries(ELEMENTS.map((x) => [x, 0])),
    yinYang = { 음: 0, 양: 0 };
  for (const p of Object.values(pillars).filter(Boolean)) {
    elements[p.elementStem]++;
    elements[p.elementBranch]++;
    yinYang[p.yinYangStem]++;
    yinYang[p.yinYangBranch]++;
  }
  const warnings = [
    '전통 명리 해석은 과학적으로 검증된 성격 진단이나 미래 예측이 아니에요.',
    '출생지의 역사적 표준시·서머타임을 적용하며 진태양시(경도·균시차)는 적용하지 않아요. 자정에 일주를 바꾸는 기준이에요.',
    '오행 수는 확정된 천간·지지의 대표 오행만 같은 비중으로 셉니다. 지장간 가중치·계절 강약·용신 판정이 아니에요.',
  ];
  if (input.timeType !== 'exact')
    warnings.push('입력한 시간 범위에서 달라지는 기둥은 미확정으로 표시하고 관련 해석을 제외해요.');
  if (input.timeType === 'unknown')
    warnings.push('시각 미상: 시주는 계산·해석하지 않아요. 오행은 확정된 기둥만의 부분 분포예요.');
  if (variants.day.length !== 1)
    throw new TypeError('이 시간 범위에서는 일주도 달라져요. 정확한 날짜와 지역을 확인해 주세요.');
  const first = samples[0],
    last = samples[samples.length - 1];
  const next = termInstant(first.china.getNextJie()),
    prev = termInstant(first.china.getPrevJie());
  const near = Math.min(
    Math.abs(next.toMillis() - first.dt.toMillis()),
    Math.abs(prev.toMillis() - first.dt.toMillis()),
  );
  if (input.timeType === 'exact' && near < 120000)
    throw new TypeError(
      '절기 경계 2분 이내예요. 계산 자료의 초 단위 차이로 원국이 달라질 수 있어 유료 분석을 제공하지 않아요.',
    );
  const luck = ['forward', 'reverse'].map((direction) => {
    const starts = samples.map(
      (s) =>
        (direction === 'forward'
          ? termInstant(s.china.getNextJie()).toMillis() - s.dt.toMillis()
          : s.dt.toMillis() - termInstant(s.china.getPrevJie()).toMillis()) /
        86400000 /
        3,
    );
    const startAge = [Math.min(...starts), Math.max(...starts)].map(
      (x) => Math.round(x * 100) / 100,
    );
    const index = LunarUtil.getJiaZiIndex(first.month),
      step = direction === 'forward' ? 1 : -1;
    return {
      direction,
      startAge,
      cycles: pillars.month
        ? Array.from({ length: 8 }, (_, i) => ({
            pillar: pillar(LunarUtil.JIA_ZI[mod(index + step * (i + 1), 60)], day[0]),
            ageRange: [
              Math.round((startAge[0] + i * 10) * 10) / 10,
              Math.round((startAge[1] + (i + 1) * 10) * 10) / 10,
            ],
          }))
        : [],
    };
  });
  warnings.push(
    '성별을 수집하지 않으므로 대운 방향을 하나로 정하지 않아요. 앞·뒤 절입까지 3일=1년으로 환산한 순행·역행 두 시나리오이며 시작 나이는 근삿값이에요.',
  );
  const annual = Array.from({ length: 5 }, (_, i) => {
    const year = 2026 + i;
    return { year, pillar: pillar(LunarUtil.JIA_ZI[mod(year - 4, 60)], day[0]) };
  });
  return {
    version: VERSION,
    input: n.input,
    solarDate: DateTime.fromObject(n.date).toISODate(),
    pillars,
    variants,
    elements,
    yinYang,
    visibleCount: Object.values(elements).reduce((a, b) => a + b, 0),
    luck,
    annual,
    referenceYear: 2026,
    terms: {
      previous: { name: first.china.getPrevJie().getName(), utc: prev.toUTC().toISO() },
      next: { name: first.china.getNextJie().getName(), utc: next.toUTC().toISO() },
    },
    warnings,
    timezoneData: process.versions.tz || 'runtime ICU',
    sampleRange: [first.dt.toISO(), last.dt.toISO()],
  };
}
module.exports = { calculate, normalize, VERSION, ZONES, ELEMENTS, god, pillar, ko };
