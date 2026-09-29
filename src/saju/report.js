'use strict';
const legacy = require('./report-v1');
const VERSION = 'ko-grandmother-2';
const TOC = legacy.TOC;
// A versioned narrator, not a claim that a real person authored these readings.
function narrator(value) {
  return value
    .replace(/([가-힣])(?:입니다|이에요|예요)\./g, (_, last) => last + ((last.charCodeAt(0) - 0xac00) % 28 ? '이란다.' : '란다.'))
    .replaceAll('해 주세요.', '해 보거라.')
    .replaceAll('읽어 주세요.', '읽어 보거라.')
    .replaceAll('셉니다.', '세는 거란다.')
    .replaceAll('보세요.', '보거라.')
    .replaceAll('마세요.', '말거라.')
    .replaceAll('아니에요.', '아니란다.')
    .replaceAll('않습니다.', '않는단다.')
    .replaceAll('다릅니다.', '다르단다.')
    .replaceAll('가리킵니다.', '가리키는 거란다.')
    .replaceAll('사용합니다.', '쓰는 거란다.')
    .replaceAll('읽습니다.', '읽는단다.')
    .replaceAll('더합니다.', '더하는구나.')
    .replaceAll('입니다.', '이란다.')
    .replaceAll('이에요.', '이란다.')
    .replaceAll('예요.', '란다.')
    .replaceAll('있어요.', '있단다.')
    .replaceAll('없어요.', '없단다.')
    .replaceAll('않아요.', '않는단다.')
    .replaceAll('않았어요.', '않았단다.')
    .replaceAll('나타나요.', '보이는구나.')
    .replaceAll('적용해요.', '적용한단다.')
    .replaceAll('분류해요.', '분류한단다.')
    .replaceAll('생략해요.', '건너뛰는 게 맞겠구나.')
    .replaceAll('유용해요.', '도움이 된단다.')
    .replaceAll('제외했어요.', '빼두었단다.');
}
function generate(chart, version = VERSION) {
  if (version === legacy.VERSION) return legacy.generate(chart, version);
  if (version !== VERSION) throw new TypeError('지원하지 않는 보고서 버전이에요.');
  const result = legacy.generate(chart);
  result.version = VERSION;
  const day = chart.pillars.day;
  const images = {
    甲: ['곧게 자라는 나무', '먼저 방향을 세우고 한 걸음씩 나아가는 모습'],
    乙: ['주변을 따라 뻗는 풀과 덩굴', '여러 사람의 사정을 살피며 길을 찾아가는 모습'],
    丙: ['넓게 비추는 햇볕', '생각을 밖으로 꺼내 사람들과 나누는 모습'],
    丁: ['가까운 곳을 밝히는 등불', '작은 차이를 놓치지 않고 한 가지를 깊이 다듬는 모습'],
    戊: ['든든하게 자리를 지키는 산', '흔들리는 상황에서도 기준을 세우는 모습'],
    己: ['손길을 들여 가꾸는 밭', '작은 일들을 돌보며 전체를 챙기는 모습'],
    庚: ['단단하게 벼린 쇠', '복잡한 것 사이에서 기준을 잡고 결정을 내리는 모습'],
    辛: ['섬세하게 다듬는 보석', '작은 차이를 가려내 완성도를 높이는 모습'],
    壬: ['넓게 흘러가는 큰 물', '여러 가능성을 살피고 서로 연결하는 모습'],
    癸: ['차분히 스며드는 빗물', '작은 신호를 모아 속뜻을 헤아리는 모습'],
  };
  const [symbol, tendency] = images[day.stem];
  const count = Math.max(...Object.values(chart.elements));
  const leaders = Object.keys(chart.elements).filter(k => chart.elements[k] === count);
  const overrides = {
    summary: {
      title: '너라는 사람',
      text: `자, 네 사주에서 너를 가리키는 글자부터 보자꾸나. 일간은 ${day.korean[0]}${day.elementStem}(${day.stem})란다. 옛 명리에서는 이 글자를 ${symbol}에 빗대어 읽곤 하지. 그래서 ${tendency}을 네 경험과 견주어 볼 수 있겠구나. 확정된 ${chart.visibleCount}글자를 세어보니 ${leaders.join('·')} 기운의 글자가 각각 ${count}개로 가장 많구나. 이건 글자 수를 센 것이지, 네 성격이나 기운의 세기를 단정한 건 아니란다.`,
    },
    elements: {
      text: `${Object.entries(chart.elements).map(([key, value]) => `${key} ${value}개`).join(' · ')}로 세어지는구나. ${leaders.join('·')}에 해당하는 글자가 가장 많단다. ${Object.keys(chart.elements).filter(key => !chart.elements[key]).length ? `${Object.keys(chart.elements).filter(key => !chart.elements[key]).join('·')}에 해당하는 글자는 확정된 겉글자에 보이지 않는구나.` : '다섯 오행이 모두 보이는구나.'} 보이지 않는 오행이 있다고 네 삶에 무엇이 부족하거나 불행하다는 뜻은 아니란다. 지장간과 계절의 강약을 제외하고 센 것이니, 이것만으로 직업이나 길흉을 정하지 말거라.`,
    },
    strength: { title: '네가 살펴볼 힘' },
    relationship: { title: '사람과 마음을 나눌 때' },
    caution: { title: '잠깐 돌아보면 좋을 것' },
    partner: { title: '인연 앞에서 기억할 것' },
    work: { title: '네 일과 돈을 대하는 마음' },
    method: { title: '이 이야기를 어디서 읽었느냐면' },
  };
  const convert = block => {
    const override = overrides[block.id] || {};
    let value = narrator(block.text.replaceAll(legacy.VERSION, VERSION));
    if (block.id === 'strength') value = `네가 잘할 수 있는 일을 함께 짚어보자꾸나. ${value}`;
    if (block.id === 'relationship') value = `사람 마음은 사주 몇 글자로 다 알 수 있는 게 아니란다. ${value}`;
    if (block.id === 'work') value = `일과 돈 이야기도 차근차근 해보자꾸나. ${value}`;
    return { ...block, title: override.title || block.title, text: override.text || value };
  };
  result.preview = result.preview.map(convert);
  result.sample = convert(result.sample);
  result.sections = result.sections.map(section => ({ ...section, blocks: section.blocks.map(convert) }));
  return result;
}
module.exports = { generate, VERSION, TOC };
