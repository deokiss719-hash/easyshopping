'use strict';
const previous = require('./report-v2');
const VERSION = 'ko-depth-3';
const TOC = [
  '네 사주를 이루는 네 기둥', '계절·오행·지장간을 함께 읽기',
  '네 성향이 강점이 되는 때와 엇갈리는 때', '가까운 사람과 마음을 나누는 방식',
  '일을 해내는 방식과 돈을 관리하는 기준', '대운·세운별로 돌아볼 삶의 주제',
  '풀이에 사용한 계산값과 해석 기준', '확정할 수 없는 이야기와 이용 안내',
];
// Editorial interpretations of ten-god symbols. Never a diagnosis or event prediction.
const THEMES = {
  비견: ['내 기준과 동료', '자기 기준을 세우고 동료와 나란히 일을 해내는 힘', '서로 옳다고 버티느라 결정이 늦어지는 모습', '상대의 선택을 존중하면서 각자 맡을 몫을 분명히 정해 보거라.', '혼자 결정할 일과 함께 결정할 일을 나누어 두면 협업의 기준이 또렷해진단다.', '이 결정은 내가 맡을 일인가, 함께 합의할 일인가'],
  겁재: ['경쟁과 나눌 몫', '사람들과 힘을 모으고 경쟁을 계기로 움직이는 힘', '남의 속도에 휩쓸려 내 몫과 비용을 놓치는 모습', '친하다는 이유로 돈이나 시간을 당연하게 나누지 말고 서로 편한 선을 이야기해 보거라.', '공동 비용과 수익을 누가 얼마나 맡는지 시작 전에 적어두는 편이 좋겠구나.', '함께 쓰는 시간과 돈의 기준을 서로 알고 있는가'],
  식신: ['꾸준한 표현과 생산', '작은 결과를 꾸준히 만들어 신뢰를 쌓는 힘', '익숙한 방식만 지키다가 새 요구를 늦게 알아차리는 모습', '큰 약속 하나보다 지킬 수 있는 작은 행동을 반복해 보거라.', '매일 완성할 수 있는 결과물을 정하고 그 결과에 대한 반응을 기록해 보거라.', '내가 반복하는 일이 실제로 누구에게 도움이 되는가'],
  상관: ['표현과 개선', '불편한 지점을 찾아 새로운 방법을 제안하는 힘', '문제보다 사람을 평가하는 말이 먼저 나오는 모습', '상대가 어떤 사람인지 단정하기보다 어떤 행동이 불편했는지 구체적으로 말해 보거라.', '기존 방식의 문제를 지적할 때 작은 대안과 비교 결과를 함께 내놓아 보거라.', '내 지적 뒤에 상대가 실행할 수 있는 대안도 있는가'],
  편재: ['기회와 바깥 자원', '사람과 기회를 넓게 연결하는 힘', '여러 가능성을 한꺼번에 좇다가 약속과 비용이 불어나는 모습', '만나는 사람의 수보다 이미 한 약속을 지킬 여유가 있는지 살펴보거라.', '새 제안을 받으면 기대하는 결과뿐 아니라 필요한 시간과 감당 가능한 비용도 적어보거라.', '이 기회를 맡아도 기존 약속과 생활을 지킬 수 있는가'],
  정재: ['일상과 자원 관리', '작은 자원을 차근차근 관리해 기반을 만드는 힘', '계획을 지키는 일이 목적이 되어 달라진 사정을 받아들이기 어려운 모습', '생활비나 연락 빈도처럼 서로 기대하는 일상을 구체적으로 맞추어 보거라.', '반복 지출과 들어오는 돈을 나누어 기록하되 계획을 고칠 날짜도 정해 두거라.', '지금 지키는 계획은 현재의 사정에도 맞는가'],
  편관: ['도전과 부담 조절', '어려운 요구 앞에서 대응하고 책임을 붙드는 힘', '요구를 전부 떠안고 쉬어갈 여지를 잃는 모습', '힘든 일을 혼자 버티는 것으로 마음을 증명하려 하지 말고 필요한 도움을 말해 보거라.', '어려운 과제를 맡을 때 기한과 권한, 지원받을 수 있는 범위를 함께 확인하거라.', '이 책임을 감당할 권한과 지원도 함께 주어졌는가'],
  정관: ['책임과 합의', '약속과 역할을 지켜 믿음을 쌓는 힘', '정해진 기대에 맞추느라 내 의견을 뒤로 미루는 모습', '말하지 않아도 알겠거니 하지 말고 서로 기대하는 역할을 확인해 보거라.', '평가 기준과 책임 범위를 먼저 맞추고 바뀐 조건은 다시 합의해 보거라.', '나는 합의된 일을 하는가, 혼자 짐작한 기대까지 떠안는가'],
  편인: ['탐구와 다른 관점', '익숙하지 않은 문제를 새로운 각도로 살피는 힘', '생각의 갈래가 많아져 실제 시도를 미루는 모습', '혼자 생각할 시간과 함께 대화할 시간을 나누고 침묵의 이유를 알려주거라.', '흥미로운 생각 하나를 작은 실험으로 옮겨 실제로 쓸 수 있는지 확인해 보거라.', '내가 더 알아야 할 것과 지금 시험할 수 있는 것은 무엇인가'],
  정인: ['배움과 도움', '배운 것을 정리하고 도움을 주고받는 힘', '준비가 충분해야 한다는 생각에 첫 실행을 늦추는 모습', '도움이 필요할 때는 무엇을 부탁하는지 말하고 상대가 원하는 도움도 물어보거라.', '배운 내용을 한 번 정리한 뒤 실제 일 하나에 적용해 보거라.', '오늘 배운 것 가운데 바로 써볼 수 있는 것은 무엇인가'],
};
const FAMILIES = { 비견:'비겁', 겁재:'비겁', 식신:'식상', 상관:'식상', 편재:'재성', 정재:'재성', 편관:'관성', 정관:'관성', 편인:'인성', 정인:'인성' };
const LABELS = { year:'연주', month:'월주', day:'일주', hour:'시주' };
const ROLE = {
  year: ['바깥 환경을 돌아보는 자리', '처음 만나는 자리에서 어떤 기준을 드러내는지'],
  month: ['일과 역할을 돌아보는 자리', '일을 맡을 때 익숙하게 취하는 방식이 무엇인지'],
  day: ['나와 가까운 관계를 돌아보는 자리', '혼자 내리는 선택과 가까운 사람에게 보이는 모습이 어떻게 다른지'],
  hour: ['계획과 결과를 돌아보는 자리', '생각을 실제 결과로 옮길 때 무엇을 중요하게 여기는지'],
};
function profile(chart) {
  const visible = Object.entries(chart.pillars).filter(([key,p]) => key !== 'day' && p);
  const counts = {};
  for (const [, p] of visible) counts[FAMILIES[p.tenGod]] = (counts[FAMILIES[p.tenGod]] || 0) + 1;
  const roots = Object.entries(chart.pillars).filter(([,p]) => p && p.hiddenStems.some(h => ['비견','겁재'].includes(h.tenGod))).map(([key]) => key);
  return { visible, counts, roots };
}
function generate(chart, version = VERSION) {
  if (version !== VERSION) return previous.generate(chart, version);
  const report = previous.generate(chart);
  report.version = VERSION;
  report.toc = TOC;
  report.sections.forEach((s,i) => { s.title = TOC[i]; });
  const p = chart.pillars, day = p.day, month = p.month;
  const info = profile(chart);
  const add = (id, title, value, refs) => {
    report.evidence[id] = refs.map(path => ({path, value:path.split('.').reduce((v,k)=>v?.[k],chart)}));
    return { id, title, text:value, evidence:refs };
  };
  const term = (god) => THEMES[god];
  const monthly = month ? term(month.tenGod) : null;
  const hidden = day.hiddenStems.map(h => `${h.korean}(${h.tenGod})`).join('·');
  const visibleDescription = info.visible.map(([key,v]) => `${LABELS[key]} 천간의 ${v.tenGod}`).join(', ');
  const themeIntro = monthly ? `월주 ${month.korean}의 천간을 네 일간(${day.stem})과 비교하면 ${month.tenGod}이란다. 이 조합에서 꺼내볼 주제는 '${monthly[0]}'란다.` : '월주가 확정되지 않아 일에서 드러나는 월간의 주제는 정하지 않았단다.';
  const summary = { ...report.preview[0], text: report.preview[0].text + ' ' + themeIntro + (monthly ? ` ${monthly[1]}이 네 경험 속에서 어떻게 나타났는지 떠올려 보거라. 예를 들어 함께 일을 정할 때 '${monthly[5]}'라고 물어볼 수 있단다.` : '') };
  summary.evidence = [...summary.evidence, 'pillars.month'];
  report.evidence.summary = [...report.evidence.summary, {path:'pillars.month',value:month}];
  const strength = add('strength', '네 힘이 잘 쓰일 때', monthly
    ? `월간의 ${month.tenGod}을 일간과 함께 읽어보면 ${monthly[1]}을 살펴볼 수 있단다. ${monthly[4]} 반대로 ${monthly[2]}이 익숙하다면, 같은 성향을 너무 오래 한쪽으로 쓰고 있는지 돌아보거라. 잘 맞았던 일 한 가지와 힘들었던 일 한 가지를 나란히 적어보면 네 방식의 쓰임을 구분하기 쉽겠구나.`
    : `${report.preview[1].text} 태어난 시간대가 절기 경계와 겹쳐 월주가 달라질 수 있다면, 월간을 억지로 하나 골라 강점을 덧붙이지 않는 게 맞겠구나. 확정된 일간의 이야기와 네 실제 경험을 먼저 견주어 보거라.`, ['pillars.day.stem','pillars.month']);
  const relationship = add('relationship', '가까운 사람에게 보이는 너',
    `네 일지는 ${day.korean[1]}(${day.branch})이고, 그 안의 지장간은 ${hidden}이란다. 겉으로 드러난 한 글자와 안에 함께 놓인 글자들을 구분해 보자꾸나. ${monthly ? `월간에서는 '${monthly[0]}' 주제를 읽지만 가까운 관계를 볼 때는 일지의 여러 십성도 함께 살펴볼 수 있단다. ${monthly[3]}` : '월간과 비교하는 해석은 보류하고 확정된 일지부터 살펴보는 게 맞겠구나.'} 이것은 상대의 마음을 맞히는 말이 아니라 네가 대화를 시작할 때 써볼 질문이란다.`, ['pillars.day','pillars.month']);
  report.preview = [summary, strength, relationship];
  // Explain the role of each confirmed pillar without inventing a missing hour.
  report.sections[0].blocks = report.sections[0].blocks.map((block,i) => {
    const key = ['year','month','day','hour'][i];
    if (!p[key]) return block;
    return {...block, text:block.text + ` 이 기둥은 전통적으로 ${ROLE[key][0]}로 읽기도 한단다. 네게는 ${ROLE[key][1]} 돌아보는 질문으로 쓰면 좋겠구나. 기둥 하나로 실제 가족이나 성장 환경을 알아맞힐 수는 없단다.`};
  });
  report.sections[1].blocks.push(add('season', '같은 오행도 계절을 함께 보는 까닭', month
    ? `네 월지는 ${month.korean[1]}(${month.branch})란다. 절기 기준으로 ${'寅卯辰'.includes(month.branch) ? '봄' : '巳午未'.includes(month.branch) ? '여름' : '申酉戌'.includes(month.branch) ? '가을' : '겨울'}에 해당하는 월지이니, 같은 오행 개수라도 계절 조건을 따로 살펴야 한다는 점을 기억하거라. 월지 안에는 ${month.hiddenStems.map(h=>`${h.korean}(${h.tenGod})`).join('·')}가 들어 있단다. 겉글자 개수와 지장간은 서로 다른 관찰 자료라 둘을 단순히 더하지 않았단다. 이 보고서는 월지를 확인하되 계절의 가중치를 임의로 점수화해 신강·신약이나 용신을 확정하지는 않는단다.`
    : '월지가 확정되지 않아 태어난 계절을 하나로 정하지 않았단다. 오행 개수만 보고 계절의 도움을 받는다거나 약하다고 덧붙이지 않겠구나.', ['pillars.month','elements']));
  report.sections[1].blocks.push(add('roots', '겉에 보이는 글자와 안에 놓인 글자',
    info.roots.length
      ? `${info.roots.map(key=>LABELS[key]).join('·')}의 지장간에서 일간과 같은 오행인 비견 또는 겁재가 확인되는구나. 이는 네 일간 ${day.stem}과 같은 오행의 글자가 지지 안에도 있다는 뜻이란다. 겉에 드러난 글자와 안에 놓인 글자가 어떤 자리에 반복되는지 살펴볼 수 있겠구나. 다만 지장간의 개수를 바로 힘의 크기로 바꾸거나 이것만으로 신강이라 단정하지는 않는단다.`
      : `확정된 지장간에서는 네 일간 ${day.stem}과 같은 오행인 비견·겁재가 확인되지 않는구나. 이것을 의지할 곳이 없거나 의지가 약하다는 말로 바꾸면 안 된단다. ${p.hour ? '지장간과 계절을 함께 따져야 하는 문제이므로 단순 개수로 힘을 판정하지 않았단다.' : '시주를 모르니 그 자리에 같은 오행이 있을 가능성까지 없다고 말할 수는 없단다.'}`, ['pillars']));
  const pattern = add('pattern', '반복되는 역할과 서로 다른 마음',
    `${visibleDescription || '일간 밖의 확정된 천간이 없는 상태'}를 확인했단다. ${Object.keys(info.counts).length ? `같은 계열끼리 묶으면 ${Object.entries(info.counts).map(([k,v])=>`${k} ${v}개`).join('·')}이고, 기준인 일간은 이 횟수에서 빼두었단다.` : ''} ${Object.keys(info.counts).length === 1 ? '바깥 천간이 한 계열로 모여 있으니 그 역할을 반복해서 맡는 장면이 있었는지 돌아보거라. 잘하는 역할이어도 매번 네가 맡아야 한다는 뜻은 아니란다.' : '여러 계열이 함께 보이는구나. 상황에 따라 서로 다른 역할을 택하는 일이 자연스러울 수 있으니 한 가지 성격표에 너를 가두지 말거라.'} 이것은 확정된 천간의 분류이며 숨은 십성까지 가중해 계산한 성격 점수는 아니란다.`, ['pillars']);
  report.sections[2].blocks = [summary, strength, pattern, add('caution','같은 힘이 부담으로 바뀌는 순간',monthly
    ? `월간의 '${monthly[0]}' 주제는 ${monthly[1]}으로 읽을 수 있지만, ${monthly[2]}도 점검해 볼 수 있겠구나. 최근 비슷한 상황을 하나 떠올리고 네가 원한 결과와 실제 한 행동을 나누어 적어보거라. 그다음에는 '${monthly[5]}'라는 질문에 답해 보거라. 이건 정해진 약점을 고치는 처방이 아니라 네 경험과 맞는지 확인하는 방법이란다.`
    : report.sections[2].blocks[2].text, ['pillars.day.stem','pillars.month'])];
  const innerThemes = [...new Set(day.hiddenStems.map(h=>h.tenGod))];
  report.sections[3].blocks = [relationship, ...innerThemes.map((god,i)=>add(`relationship-inner-${i}`, `일지의 ${god}에서 꺼내볼 대화`,
    `네 일지의 지장간에서 ${god}을 확인했단다. 전통 상징으로는 '${term(god)[0]}'에 해당하는 관계를 일간과 맺는 글자란다. ${term(god)[3]} 서로 서운했던 일을 이야기할 때 '${term(god)[5]}'라는 질문을 네 상황에 맞게 바꾸어 써보거라. 상대가 실제로 무엇을 원했는지는 사주보다 직접 나눈 말로 확인하는 게 좋단다.`, ['pillars.day']))];
  const work = add('work','네가 일에서 쓸 수 있는 힘',monthly
    ? `${themeIntro} ${monthly[1]}을 일의 방식으로 옮겨보자꾸나. ${monthly[4]} 예를 들어 새 일을 맡는 자리에서는 '${monthly[5]}'를 확인하고 시작할 수 있겠구나. 이 관점이 맞는지는 실제로 잘 끝낸 일과 중간에 막힌 일을 비교해 보거라. 사주로 직업 이름을 정하기보다 네 기술과 선호, 지금 주어진 조건에 맞게 쓸 방법을 찾는 것이란다.`
    : '월주가 확정되지 않아 월간을 이용한 업무 방식은 단정하지 않았단다. 확정된 일간의 강점 설명을 읽고 네 기술과 실제 경력에서 맞는 사례를 찾아보거라.', ['pillars.month','pillars.day.stem']);
  const finance = info.visible.filter(([,v])=>['편재','정재'].includes(v.tenGod));
  report.sections[4].blocks = [work, add('resources','돈을 읽을 때 먼저 구분할 것',finance.length
    ? `${finance.map(([key,v])=>`${LABELS[key]} 천간의 ${v.tenGod}`).join('·')}를 확인했단다. 재성은 일간과 대상 천간의 생극 관계를 분류한 말이지 통장 잔액을 나타내는 숫자는 아니란다. ${finance.map(([,v])=>term(v.tenGod)[4]).filter((v,i,a)=>a.indexOf(v)===i).join(' ')} 얼마를 벌게 된다고 말하기보다 네가 관리할 수 있는 지출과 약속의 범위를 분명히 해두거라.`
    : `확정된 바깥 천간에는 편재·정재가 나타나지 않는구나. 지장간을 제외한 관찰이니 재성이 아예 없다는 말도 아니고, 돈을 벌지 못한다는 뜻은 더더욱 아니란다. ${monthly ? monthly[4] : '실제 수입과 반복 지출부터 나누어 적어보거라.'} 네 수입은 기술과 환경, 선택에 따라 달라지니 글자 수만으로 금액을 예언하지 않는단다.`, ['pillars']), add('work-plan','이번에 실제로 해볼 한 가지',monthly
    ? `'${monthly[0]}' 주제를 시험하려면 작은 일 하나를 골라보거라. ${monthly[4]} 시작 전에 기대하는 결과를 적고, 끝난 뒤에는 무엇이 달라졌는지 기록해 보거라. 뜻대로 되지 않았다면 네 사주 탓을 하기보다 시간과 자원, 함께 일하는 사람의 조건이 어땠는지 살펴보는 거란다.`
    : '월주가 확정되지 않았으니 이 자리에 구체적인 십성 과제를 끼워 맞추지 않겠구나. 네가 이미 알고 있는 강점 한 가지를 작은 일에 적용하고 결과를 기록해 보거라.', ['pillars.month'])];
  report.sample = work;
  const flows = [];
  for (const [i,luck] of chart.luck.entries()) {
    flows.push(add(`luck-${i}`,luck.direction === 'forward' ? '순행으로 읽는 경우' : '역행으로 읽는 경우',
      `이쪽은 ${luck.direction === 'forward' ? '순행' : '역행'}을 가정한 흐름이란다. ${luck.cycles.length ? `시작 나이는 약 ${luck.startAge[0]}~${luck.startAge[1]}세로 계산됐구나. 아래 구간은 나이 범위이며 태어난 시각의 오차 때문에 이웃 구간이 겹칠 수 있단다.` : '월주가 미확정이라 대운의 글자를 정하지 않았단다.'} 성별을 입력받지 않아 방향을 하나로 정하지 않았으니 두 시나리오 가운데 마음에 드는 쪽을 확정 운세로 택하지 말거라.`, [`luck.${i}`]));
    luck.cycles.forEach((cycle,j)=>{
      const theme = term(cycle.pillar.tenGod);
      flows.push(add(`luck-${i}-cycle-${j}`,`${cycle.ageRange[0]}~${cycle.ageRange[1]}세 · ${cycle.pillar.korean}`,
        `${cycle.pillar.chars}의 천간을 일간 ${day.stem}과 비교하면 ${cycle.pillar.tenGod}이란다. 이 구간의 참고 주제를 '${theme[0]}'으로 읽어보자꾸나. ${theme[4]} ${month ? `원국 월간의 ${month.tenGod} 계열과 ${FAMILIES[month.tenGod] === FAMILIES[cycle.pillar.tenGod] ? '같은 계열이니 익숙한 방식이 반복될 때의 장점과 부담을 함께 점검해 보거라.' : '다른 계열이니 평소 맡던 역할과 다른 요구가 생겼을 때 무엇을 조정할지 생각해 볼 수 있겠구나.'}` : '월간과의 비교는 월주가 미확정이라 하지 않았단다.'} 그 시기에 실제 사건이 생긴다는 확정 예언은 아니란다.`, [`luck.${i}.cycles.${j}`,'pillars.day.stem','pillars.month']));
    });
  }
  chart.annual.forEach((annual,i)=>{
    const theme=term(annual.pillar.tenGod);
    const sameBranch = Object.entries(p).filter(([,v])=>v && v.branch === annual.pillar.branch).map(([key])=>LABELS[key]);
    flows.push(add(`year-${annual.year}`,`${annual.year}년 입춘부터 · ${annual.pillar.korean}`,
      `이 해의 간지는 ${annual.pillar.chars}이고 일간과 비교한 천간의 십성은 ${annual.pillar.tenGod}이란다. '${theme[0]}' 주제로 ${theme[1]}을 돌아볼 수 있겠구나. ${theme[4]} ${sameBranch.length ? `세운 지지 ${annual.pillar.branch}는 원국 ${sameBranch.join('·')}의 지지와 같은 글자란다. 반복되는 글자를 확인한 것이며 길흉이나 사건의 반복을 뜻하지는 않는단다.` : '원국의 확정된 지지와 세운 지지가 같은 자리는 없구나. 이것만으로 좋거나 나쁜 해를 나누지는 않는단다.'} 한 해를 준비하며 '${theme[5]}'라고 스스로 물어보거라.`, [`annual.${i}`,'pillars']));
  });
  report.sections[5].blocks = flows;
  report.sections[6].blocks = [add('method','여러 글자를 함께 읽되, 근거는 분명하게',
    `계산 버전은 ${chart.version}, 해석 버전은 ${VERSION}이란다. 일간 한 글자뿐 아니라 월간 십성, 월지와 지장간, 확정된 바깥 천간의 계열, 일지의 숨은 글자, 대운·세운을 연결해 읽었단다. 계절은 월지로 확인하고 지장간은 겉글자 오행 수에 더하지 않았단다. 각 문단 아래에는 그 문단에 사용한 계산값을 남겨두었으니 펼쳐볼 수 있단다. 생활 속 사례와 실천 질문은 전통 상징을 바탕으로 작성한 해석이며 네 과거나 미래가 계산으로 증명됐다는 뜻은 아니란다. 신강·신약, 용신, 합화 성립, 사건의 날짜나 재산 규모는 이 보고서에서 확정하지 않는단다.`, ['version','referenceYear','pillars','elements'])];
  return report;
}
module.exports = { generate, VERSION, TOC, profile };
