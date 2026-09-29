'use strict';
const { ELEMENTS } = require('./calculator');
const VERSION = 'ko-evidence-1';
const TOC = [
  '사주 원국과 네 기둥',
  '오행·음양 분포',
  '일간으로 읽는 성향·강점·주의점',
  '관계와 연애에서의 대화 방식',
  '일·직업·재물의 참고 방향',
  '대운 두 시나리오와 세운',
  '해석의 계산 근거',
  '불확실성과 이용 안내',
];
const DAY = {
  甲: [
    '갑목',
    '새로운 구조를 세우는 관점',
    '목표를 먼저 정하고 단계를 나눠 추진하는 방식',
    '이미 세운 방향을 바꾸는 데 시간이 걸릴 수 있어 중간 점검 날짜를 정해 보세요.',
  ],
  乙: [
    '을목',
    '주변 조건을 살피며 조율하는 관점',
    '여러 사람의 요구를 연결해 실행 가능한 대안을 만드는 방식',
    '상대에게 맞추느라 자신의 조건을 놓치지 않도록 양보할 수 없는 기준을 먼저 적어 보세요.',
  ],
  丙: [
    '병화',
    '생각을 밖으로 드러내고 공유하는 관점',
    '목적을 설명하며 사람들의 참여를 이끄는 방식',
    '반응이 바로 보이지 않는 일에서도 성과를 확인할 수 있도록 기록을 남겨 보세요.',
  ],
  丁: [
    '정화',
    '작은 차이를 관찰하고 집중하는 관점',
    '특정 주제를 깊이 다듬어 다른 사람이 이해하도록 설명하는 방식',
    '한 부분을 계속 다듬다 마감이 밀리지 않도록 완성 기준을 정해 보세요.',
  ],
  戊: [
    '무토',
    '일의 중심과 기준을 유지하는 관점',
    '변수가 생겨도 원칙을 세우고 계획을 지키는 방식',
    '안정성을 지키려다 새 조건을 놓치지 않도록 반대 의견 하나도 함께 검토해 보세요.',
  ],
  己: [
    '기토',
    '필요한 것을 모아 정리하는 관점',
    '일상적인 관리와 세부 조정을 통해 전체를 유지하는 방식',
    '모든 일을 직접 관리하려 하기보다 담당 범위를 나눠 보세요.',
  ],
  庚: [
    '경금',
    '기준에 따라 선택하고 정리하는 관점',
    '복잡한 문제에서 우선순위를 정하고 결정을 실행하는 방식',
    '결론을 말하기 전에 상대가 중요하게 여기는 조건을 한 번 확인해 보세요.',
  ],
  辛: [
    '신금',
    '차이와 완성도를 구별하는 관점',
    '세밀한 검토로 결과물의 품질을 높이는 방식',
    '완벽한 결과와 지금 필요한 결과를 구분하는 마감 기준을 만들어 보세요.',
  ],
  壬: [
    '임수',
    '정보를 넓게 모아 연결하는 관점',
    '다양한 가능성을 탐색해 대안을 만드는 방식',
    '선택지를 늘리는 단계와 하나를 실행하는 단계를 구분해 보세요.',
  ],
  癸: [
    '계수',
    '작은 신호를 읽고 생각을 정리하는 관점',
    '관찰한 정보를 쌓아 문제의 맥락을 이해하는 방식',
    '검토한 내용을 혼자만 보관하지 말고 판단 근거를 짧게 공유해 보세요.',
  ],
};
const GOD = {
  비견: [
    '자기 기준과 동료 관계',
    '역할을 대등하게 나누되 누가 최종 결정을 맡는지 합의하는 주제',
    '독립적인 업무와 공동 작업의 경계를 정해 보는 주제',
  ],
  겁재: [
    '경쟁과 자원 배분',
    '비교나 경쟁이 생길 때 공동의 목표를 다시 확인하는 주제',
    '공동 비용·수익 배분을 미리 문서로 정리하는 주제',
  ],
  식신: [
    '꾸준한 표현과 생산',
    '과장된 약속보다 반복해서 지킬 수 있는 행동으로 신뢰를 쌓는 주제',
    '작게 만들어 시험하고 반복 개선하는 주제',
  ],
  상관: [
    '변화와 비판적 표현',
    '문제 지적과 상대에 대한 평가를 분리해서 말하는 주제',
    '기존 방식을 바꿀 때 비교 자료와 대안을 함께 제시하는 주제',
  ],
  편재: [
    '기회 탐색과 외부 자원',
    '넓은 관계 속에서 시간과 약속의 범위를 정하는 주제',
    '여러 기회의 예상 비용과 손실 한도를 비교하는 주제',
  ],
  정재: [
    '계획과 일상 자원',
    '서로 기대하는 생활 방식과 책임을 구체적으로 맞추는 주제',
    '현금흐름과 반복 지출을 기록하는 주제',
  ],
  편관: [
    '도전과 대응',
    '부담이 커질 때 혼자 감당하지 않고 요구 수준을 조정하는 주제',
    '압박이 있는 과제에서 권한·기한·지원 조건을 명확히 하는 주제',
  ],
  정관: [
    '책임과 합의된 규칙',
    '묵시적인 기대를 말로 확인하고 합의하는 주제',
    '역할·평가 기준·업무 규칙을 확인하는 주제',
  ],
  편인: [
    '탐구와 새로운 관점',
    '혼자 정리할 시간과 함께 대화할 시간을 구분하는 주제',
    '낯선 문제를 탐구하되 실제 적용 가능성도 시험하는 주제',
  ],
  정인: [
    '학습과 지원',
    '도움을 주고받는 방식이 서로 편안한지 확인하는 주제',
    '학습한 내용을 정리해 다음 작업에 적용하는 주제',
  ],
};
function generate(chart, version = VERSION) {
  if (version !== VERSION) throw new TypeError('지원하지 않는 보고서 버전이에요.');
  const p = chart.pillars,
    d = DAY[p.day.stem],
    top = Math.max(...Object.values(chart.elements));
  const leaders = ELEMENTS.filter((e) => chart.elements[e] === top),
    absent = ELEMENTS.filter((e) => !chart.elements[e]);
  const month = p.month ? GOD[p.month.tenGod] : null;
  const evidence = {};
  const add = (id, title, text, refs) => {
    evidence[id] = refs.map((path) => ({
      path,
      value: path.split('.').reduce((x, k) => x?.[k], chart),
    }));
    return { id, title, text, evidence: refs };
  };
  const summary = add(
    'summary',
    '핵심 성향',
    `일간은 ${d[0]}(${p.day.stem})예요. 전통 해석에서는 ${d[1]}으로 읽습니다. 확정된 ${chart.visibleCount}글자 중 ${leaders.join('·')}의 대표 오행이 각각 ${top}개로 가장 많이 나타나요. 이는 글자 수의 특징이며 실제 성격이나 오행의 강약을 확정하는 검사는 아니에요.`,
    ['pillars.day.stem', 'elements', 'visibleCount'],
  );
  const strength = add(
    'strength',
    '살펴볼 강점',
    `${d[0]}의 상징에서 가져온 강점은 ${d[2]}이에요.${month ? ` 월간의 십성 ${p.month.tenGod}은 ‘${month[0]}’ 주제를 더합니다. 실제로 이 방식이 잘 맞았던 경험이 있었는지 떠올려 보세요.` : ' 월주가 미확정이라 계절·월간 해석은 더하지 않았어요.'}`,
    ['pillars.day.stem', 'pillars.month'],
  );
  const relationship = add(
    'relationship',
    '관계의 짧은 힌트',
    month
      ? `일간(${d[0]})과 월간 ${p.month.stem}의 관계를 ${p.month.tenGod}으로 분류해요. 이를 관계의 언어로 옮기면 ${month[1]}예요. 상대의 마음이나 결혼 시기를 예측하는 뜻은 아니에요.`
      : '월주가 달라질 수 있어 월간을 이용한 관계 해석은 생략해요. 일간의 특징은 상대를 평가하는 기준보다 자신의 표현 방식을 돌아보는 질문으로 활용해 주세요.',
    ['pillars.day.stem', 'pillars.month'],
  );
  const sections = [];
  sections.push({
    title: TOC[0],
    blocks: Object.entries(p).map(([key, v]) =>
      add(
        `pillar-${key}`,
        { year: '연주', month: '월주', day: '일주', hour: '시주' }[key],
        v
          ? `${v.korean}(${v.chars})입니다. 천간은 ${v.elementStem}·${v.yinYangStem}, 지지의 대표 오행은 ${v.elementBranch}·${v.yinYangBranch}예요. ${key === 'day' ? '일간은 십성 비교의 기준입니다.' : `일간과 천간의 관계는 ${v.tenGod}으로 분류해요.`} 지장간은 ${v.hiddenStems.map((x) => `${x.korean}(${x.tenGod})`).join(', ')}이며 단순 오행 개수에는 중복 합산하지 않았어요.`
          : '입력 범위에서 확정할 수 없어 계산·해석에서 제외했어요.',
        [`pillars.${key}`],
      ),
    ),
  });
  sections.push({
    title: TOC[1],
    blocks: [
      add(
        'elements',
        '오행을 읽는 범위',
        `${ELEMENTS.map((e) => `${e} ${chart.elements[e]}개`).join(' · ')}입니다. ${leaders.join('·')}이 가장 많고 ${absent.length ? `${absent.join('·')}은 확정된 겉글자에 나타나지 않아요` : '다섯 오행이 모두 나타나요'}. 없는 오행을 결핍이나 불행으로 해석하지 않습니다. 지장간과 계절을 제외한 단순 집계로 ‘특정 직업이 맞다’거나 ‘운이 나쁘다’고 결론 내릴 수 없어요.`,
        ['elements', 'visibleCount'],
      ),
      add(
        'yin-yang',
        '음양의 분포',
        `음 ${chart.yinYang.음}개, 양 ${chart.yinYang.양}개예요. 전통적으로 음은 수렴·정리, 양은 발산·시작의 상징으로 사용합니다. 지금 맡은 일에서 시작하는 역할과 마무리하는 역할 중 어느 쪽을 더 자주 하는지 점검하는 질문으로 읽어 주세요.`,
        ['yinYang'],
      ),
    ],
  });
  sections.push({
    title: TOC[2],
    blocks: [
      summary,
      strength,
      add(
        'caution',
        '주의해서 볼 경향',
        `${d[3]} 이는 ${d[0]}의 상징을 생활 속 점검 질문으로 옮긴 것이며, 반드시 이런 약점이 있다는 뜻은 아니에요.`,
        ['pillars.day.stem'],
      ),
    ],
  });
  sections.push({
    title: TOC[3],
    blocks: [
      relationship,
      add(
        'partner',
        '관계에서 확인할 점',
        `일지 ${p.day.korean.slice(1)}(${p.day.branch})의 대표 오행은 ${p.day.elementBranch}예요. 지장간과 일간의 관계는 ${p.day.hiddenStems.map((x) => x.tenGod).join('·')}입니다. 이 분류만으로 상대의 성격·외도·이별을 판정하지 않아요. 관계에서는 기대하는 연락 빈도, 혼자 쉴 시간, 비용 분담처럼 관찰 가능한 조건을 대화로 확인하는 편이 유용해요.`,
        ['pillars.day'],
      ),
    ],
  });
  sections.push({
    title: TOC[4],
    blocks: [
      add(
        'work',
        '업무 방식과 재물',
        month
          ? `월간 ${p.month.stem}을 일간과 비교하면 ${p.month.tenGod}입니다. ‘${month[0]}’의 상징을 일에 적용하면 ${month[2]}로 읽을 수 있어요. ${d[2]}과 연결해 자신의 실제 성과를 확인해 보세요. 이 계산은 직업 적성 검사나 수입 예측이 아니며 투자 종목·수익률을 제시하지 않습니다.`
          : '월주가 미확정이므로 월간을 이용한 업무·재물 해석을 제공하지 않아요. 일간 설명에서 제시한 방식과 실제 경력·기술·선호를 함께 검토해 주세요.',
        ['pillars.month', 'pillars.day.stem'],
      ),
    ],
  });
  const luckBlocks = chart.luck.map((l, i) =>
    add(
      `luck-${i}`,
      l.direction === 'forward' ? '순행을 가정한 흐름' : '역행을 가정한 흐름',
      l.cycles.length
        ? `시작 나이 약 ${l.startAge[0]}~${l.startAge[1]}세. ${l.cycles.map((x) => `${x.ageRange[0]}~${x.ageRange[1]}세 구간 ${x.pillar.korean}(${x.pillar.tenGod}: ${GOD[x.pillar.tenGod][0]})`).join(' / ')}. 구간 표시는 출생시각 오차를 포함한 범위로 겹칠 수 있어요. 방향을 정하지 않았으므로 어느 한쪽을 자신의 확정 운세로 읽지 마세요.`
        : '월주 미확정으로 대운 간지를 확정하지 않았어요.',
      [`luck.${i}`],
    ),
  );
  const yearly = chart.annual.map((a, i) =>
    add(
      `year-${a.year}`,
      `${a.year}년 입춘부터 다음 입춘까지`,
      `${a.pillar.korean}(${a.pillar.chars})의 천간을 일간과 비교한 십성은 ${a.pillar.tenGod}이에요. 참고 주제는 ‘${GOD[a.pillar.tenGod][0]}’, 생활 속 질문은 ${GOD[a.pillar.tenGod][2]}입니다. 해당 해에 사건이나 수입 변화가 반드시 일어난다는 예언은 아니에요.`,
      [`annual.${i}`, 'pillars.day.stem'],
    ),
  );
  sections.push({ title: TOC[5], blocks: [...luckBlocks, ...yearly] });
  sections.push({
    title: TOC[6],
    blocks: [
      add(
        'method',
        '계산과 해석을 구분해요',
        `계산 버전 ${chart.version}, 해석 버전 ${version}, 세운 기준 연도 ${chart.referenceYear}입니다. 연주·월주는 UTC+8로 제공되는 절기 시각을 출생 순간과 비교하고, 일주·시주는 출생 지역의 시계를 적용해요. 각 문단 아래의 근거 경로는 이 보고서에 저장된 계산 자료를 가리킵니다. 전통 상징을 생활 질문으로 옮기는 해석문은 천문 계산으로 증명되는 사실과 다릅니다.`,
        ['version', 'referenceYear', 'terms', 'timezoneData'],
      ),
    ],
  });
  sections.push({
    title: TOC[7],
    blocks: chart.warnings.map((w, i) =>
      add(`limit-${i}`, '계산·해석의 한계', w, [`warnings.${i}`]),
    ),
  });
  return {
    version,
    title: '나의 사주 기본 보고서',
    toc: TOC,
    preview: [summary, strength, relationship],
    sample: sections[4].blocks[0],
    sections,
    evidence,
  };
}
module.exports = { generate, VERSION, TOC };
