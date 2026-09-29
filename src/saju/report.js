'use strict';
const previous = require('./report-v3');
const profiles = require('./reading-profiles');
const VERSION = 'ko-pattern-4';
const TOC = ['한눈에 보는 나','장점과 단점','금전운','직업운','애정운과 관계','시기별 흐름','사주 계산 근거'];
const labels = ['핵심 판단','생활 속 장면','강점이 되는 조건','약점이 되는 조건','실용적인 대응'];
const family = {비견:'자율',겁재:'자율',식신:'표현',상관:'표현',편재:'자원',정재:'자원',편관:'책임',정관:'책임',편인:'학습',정인:'학습'};
const flows = {
 비견:['내 기준을 세울 때','다른 사람의 속도를 따라가기보다 직접 선택하는 범위를 넓히는 주제입니다.','혼자 결정할 수 있는 작은 과제를 맡는 장면을 생각할 수 있습니다.','방법을 시험하고 결과를 책임질 수 있다면 독립성이 경험으로 남습니다.','모든 조정을 간섭으로 받아들이면 필요한 협력까지 끊길 수 있습니다.','장기 목표를 바꾸기 전에 작은 결정 하나를 스스로 끝내는 연습이 적절합니다.'],
 겁재:['경쟁에 쓸 에너지를 고를 때','경쟁과 공동 활동에 얼마만큼 참여할지 정하는 주제입니다.','새로운 모임이나 공동 프로젝트의 제안을 받는 상황을 가정합니다.','서로의 목표가 맞으면 혼자서는 얻기 어려운 경험을 나눌 수 있습니다.','이기는 것만 남으면 원래 원하지 않았던 조건도 받아들이기 쉽습니다.','참여에서 얻을 것과 포기할 시간을 함께 적으면 선택의 기준이 선명해집니다.'],
 식신:['반복할 수 있는 결과를 만들 때','시도한 일을 생활 속 습관과 결과물로 정착시키는 주제입니다.','짧게 시작한 작업을 일정한 간격으로 완성하는 장면입니다.','작업량을 감당할 수준으로 정하면 완성한 경험이 다음 시도의 기반이 됩니다.','처음부터 분량을 크게 잡으면 지속보다 일정 준수에만 매달릴 수 있습니다.','빈도를 높이기 전에 한 번에 끝낼 수 있는 최소 단위를 정하는 것이 실용적입니다.'],
 상관:['낡은 방식을 바꿀 때','당연하게 여긴 절차를 다시 설계하는 주제입니다.','불편했던 반복 업무 하나를 다른 방법으로 처리하는 상황입니다.','이전 방식과 새 방식의 차이를 측정할 수 있다면 개선의 근거가 남습니다.','모든 규칙을 한꺼번에 뒤집으면 무엇이 효과가 있었는지 알기 어렵습니다.','변경은 한 가지씩 적용하고 결과가 나쁠 때 되돌릴 조건도 마련하는 편이 좋습니다.'],
 편재:['넓힐 범위를 정할 때','새 접점과 기회 가운데 감당할 수 있는 것을 고르는 주제입니다.','관심 분야를 넓히며 새로운 상대와 제안을 주고받는 상황입니다.','기존 약속을 유지할 여력이 있으면 새로운 연결이 선택지를 넓힐 수 있습니다.','새로운 제안을 모두 열어두면 일정과 자원이 분산됩니다.','관심 목록과 실제로 진행할 목록을 나누면 확장의 속도를 조절할 수 있습니다.'],
 정재:['유지 비용을 정리할 때','계속 가져갈 것과 정리할 것을 구분하는 주제입니다.','사용하지 않는 계약이나 습관에 시간과 돈이 계속 드는 상황을 가정합니다.','유지 여부를 주기적으로 결정하면 새 목표에 쓸 자원이 생깁니다.','이미 들인 비용이 아까워 계속 붙들면 다음 선택의 여지가 줄어듭니다.','처음 선택한 이유보다 앞으로 얻을 가치로 유지 여부를 판단하는 것이 핵심입니다.'],
 편관:['어려운 요구를 선별할 때','부담이 큰 과제를 어떤 조건에서 맡을지 정하는 주제입니다.','급한 요청이 들어왔을 때 우선순위를 다시 정하는 장면입니다.','도움을 요청할 경로가 있으면 높은 난도를 성장 경험으로 바꿀 여지가 있습니다.','감당할 수 있음을 증명하려고 한계를 숨기면 실패 신호를 늦게 알리게 됩니다.','진행이 막힐 때 언제 누구에게 알릴지 미리 정하는 대응이 유용합니다.'],
 정관:['약속을 다시 합의할 때','이미 맡고 있는 역할과 기대를 정리하는 주제입니다.','처음과 달라진 업무나 관계의 약속을 다시 맞추는 상황입니다.','서로의 책임을 명확히 하면 말하지 않은 기대 때문에 생기는 비용을 줄일 수 있습니다.','오래 해왔다는 이유만으로 계속 맡으면 역할이 의무처럼 굳어집니다.','기존 약속에 종료나 재검토 시점을 넣으면 책임을 지속 가능한 크기로 유지할 수 있습니다.'],
 편인:['다른 가설을 시험할 때','익숙한 설명 외의 가능성을 작게 검증하는 주제입니다.','막힌 문제를 다른 자료나 관점으로 다시 읽는 장면입니다.','생각과 실제 관찰을 비교하면 새로운 접근의 쓸모를 알 수 있습니다.','흥미로운 설명이라는 이유만으로 사실처럼 믿으면 잘못된 결론을 강화할 수 있습니다.','내 생각이 틀렸다면 어떤 증거가 나와야 하는지 먼저 정하는 것이 도움이 됩니다.'],
 정인:['배운 것을 넘겨줄 때','쌓아둔 이해를 다른 사람도 쓸 수 있는 형태로 만드는 주제입니다.','배운 절차를 짧은 설명이나 안내 자료로 정리하는 상황입니다.','상대의 질문을 받으면 자신이 모호하게 알고 있던 부분도 드러납니다.','설명을 완벽하게 만들려다 공개하지 않으면 실제 피드백을 얻을 수 없습니다.','작은 대상에게 먼저 설명하고 막힌 부분을 수정하는 방식이 적절합니다.']
};
function selectors(chart) {
 const p=chart.pillars;
 const month=p.month?.tenGod || null;
 const financial=['month','year'].find(k=>p[k] && ['편재','정재'].includes(p[k].tenGod));
 return {personality:month, strength:month, money:financial ? p[financial].tenGod : month,
 moneyPath:financial ? `pillars.${financial}` : 'pillars.month', work:month, love:p.day.hiddenStems[0]?.tenGod || null};
}
function generate(chart,version=VERSION) {
 if(version!==VERSION) return previous.generate(chart,version);
 const s=selectors(chart), evidence={};
 function add(id,title,parts,paths,rule) {
  evidence[id]=paths.map(path=>({path,value:path.split('.').reduce((v,k)=>v?.[k],chart)}));
  return {id,title,text:parts.map(p=>typeof p==='string'?p:p.text).join(' '),parts:parts.map(p=>typeof p==='string'?{text:p}:p),reason:rule};
 }
 function reading(id,kind,god,paths,rule) {
  if(!god || !profiles[god]) {
   const missing={
    summary:['성격을 하나로 정하지 않았습니다','절기 경계를 포함한 입력이라 중심 유형을 선택할 근거가 부족합니다. 모호한 정보에 그럴듯한 성격을 붙이는 대신, 확정된 관계 풀이와 계산 근거부터 제공합니다.'],
    strength:['장단점의 판단을 보류합니다','환경에 대응하는 방식을 읽을 기준이 둘 이상 가능합니다. 어느 경우에도 맞는 칭찬과 약점을 대신 제시하지 않습니다. 출생 기록에서 정확한 시각을 찾으면 이 항목을 다시 계산할 수 있습니다.'],
    money:['수익 방식의 구분이 어렵습니다','돈을 다루는 주제를 고를 계산값이 확정되지 않았습니다. 이번 입력으로는 독립 수입형인지 관리형인지 나누지 않으며, 다른 사람의 금전 문단을 임의로 적용하지 않습니다.'],
    work:['업무 환경을 추천할 근거가 부족합니다','출생 범위에서 역할의 기준이 달라집니다. 자율적인 환경과 규칙적인 환경 중 어느 쪽이 맞는지 이번 결과로 결론내리지 않습니다.'],
    love:['관계 유형을 선택하지 못했습니다','가까운 관계를 읽는 기준이 확인되지 않았습니다. 상대에게 보일 행동이나 반복 갈등을 만들어서 설명하지 않습니다.']
   }[kind];
   return add(id,missing[0],[missing[1]],paths,rule);
  }
  const [title,...sentences]=profiles[god][kind];
  return add(id,title,sentences.map((text,i)=>({label:kind==='summary'?undefined:labels[i],text})),paths,rule);
 }
 const summary=reading('overview','summary',s.personality,['pillars.day.stem','pillars.month'],
  '일간과 월간의 십성 관계를 중심 주제로 선택했습니다. 이 기준은 전통 상징을 생활 언어로 옮긴 편집 규칙이며 실제 성격을 측정한 결과가 아닙니다.');
 const strength=reading('strength','strength',s.strength,['pillars.day.stem','pillars.month'],
  '첫 장과 같은 월간 십성을 사용해 동일 성향의 장점과 단점을 짝지었습니다. 강약 점수나 성격 우열로 환산하지 않습니다.');
 const money=reading('money','money',s.money,['pillars.day.stem',s.moneyPath],
  '월간, 연간 순서로 드러난 재성이 있으면 해당 주제를 택하고, 없으면 월간의 십성을 수익 활동의 관점으로 읽습니다. 재성의 유무는 재산이나 소득의 크기를 뜻하지 않습니다.');
 const work=reading('work','work',s.work,['pillars.day.stem','pillars.month'],
  '일간과 월간 관계를 일·역할의 주제로 읽었습니다. 금전 장의 손익 구조와 구분해 권한·평가·업무 환경에 초점을 맞췄습니다.');
 const love=reading('love','love',s.love,['pillars.day'],
  '일지 지장간의 첫 글자(본기)와 일간의 관계를 가까운 관계의 중심 주제로 택했습니다. 성별·상대의 마음·배우자의 실제 성격을 추측하지 않습니다.');
 const flowBlocks=[];
 const slots=new Map();
 for(const [i,l] of chart.luck.entries()) for(const [j,c] of l.cycles.entries()) {
  const g=c.pillar.tenGod;
  if(!slots.has(g))slots.set(g,{ranges:[],paths:[]});
  slots.get(g).ranges.push(`${l.direction==='forward'?'순행':'역행'} 약 ${c.ageRange.join('~')}세`);
  slots.get(g).paths.push(`luck.${i}.cycles.${j}`);
 }
 chart.annual.forEach((a,i)=>{
  const g=a.pillar.tenGod;
  if(!slots.has(g))slots.set(g,{ranges:[],paths:[]});
  slots.get(g).ranges.push(`${a.year}년 입춘 이후`);slots.get(g).paths.push(`annual.${i}`);
 });
 flowBlocks.push(add('flow-guide','언제 무엇을 살펴볼까요',[
  '아래 시기는 사건이 일어나는 날짜가 아니라 전통 해석에서 강조하는 주제를 묶은 것입니다. 같은 주제의 문장을 나이마다 반복하지 않고 해당 구간을 함께 표시합니다.',
  '성별을 입력받지 않아 대운의 순행·역행을 하나로 결정하지 않았습니다. 두 방향은 대안 시나리오이며 동시에 적용하거나 마음에 드는 쪽을 고르는 운세가 아닙니다.',
  `연간 흐름은 계산 기준 연도 ${chart.referenceYear}년부터 5년입니다. 나이는 근사 범위이며 시각 오차가 있으면 구간이 겹칠 수 있습니다.`
 ],['luck','referenceYear'],'대운은 기존 계산의 방향별 시작 나이와 구간을 유지하고, 세운은 입춘 경계를 사용합니다.'));
 flowBlocks[0].timeline = [
  ...chart.luck.map(l=>({label:l.direction==='forward'?'순행 가정 · 나이순':'역행 가정 · 나이순',items:l.cycles.map(c=>({period:`약 ${c.ageRange.join('~')}세`,topic:flows[c.pillar.tenGod][0]}))})),
  {label:'연도순 · 각 해 입춘 이후',items:chart.annual.map(a=>({period:`${a.year}년`,topic:flows[a.pillar.tenGod][0]}))}
 ];
 for(const [g,item] of slots) {
  const [title,...sentences]=flows[g];
  const b=add(`flow-${g}`,title,sentences.map((text,i)=>({label:labels[i],text})),['pillars.day.stem',...item.paths],
   `각 구간 천간과 일간의 관계가 ${g}인 시기를 묶었습니다. 합충·용신이나 사건 예측까지 계산했다는 뜻은 아닙니다.`);
  b.periods=item.ranges; flowBlocks.push(b);
 }
 const technical=[
 add('rules','어떤 기준으로 읽었나요',[
  `계산 ${chart.version}, 해석 버전은 ${VERSION}입니다. 계산값은 그대로 두고 월간·일지 본기·드러난 재성에 각각 역할을 부여하는 고정 규칙으로 문장을 선택합니다.`,
  '십성은 글자 사이의 전통적 관계 분류입니다. 이를 생활 장면으로 옮긴 해석은 경험적 성격 검사나 미래 예측으로 검증된 결론이 아닙니다.',
  '일간 강약·용신·격국·합화 성립은 판정하지 않습니다. 모든 원국을 종합한 전문가 감정이 아니라 공개된 제한적 규칙을 적용한 베타 콘텐츠입니다.'
 ],['version','pillars'],'각 문단의 펼침 영역에서 실제 선택에 사용한 경로와 값을 확인할 수 있습니다.'),
 add('facts','원국·오행·십성·시기 계산값',[
  '아래 계산표와 각 문단의 근거에서 원국, 오행 개수, 음양, 십성, 대운·세운 값을 확인할 수 있습니다. 오행은 확정된 겉글자의 단순 개수로, 지장간을 중복 합산하거나 강약 점수로 바꾸지 않았습니다.'
 ],['pillars','elements','yinYang','luck','annual'],'생년월일과 확정된 출생시각으로 계산한 구조화 데이터입니다.'),
 add('limits','모르는 정보는 채우지 않습니다',[
  chart.pillars.hour ? '출생시각으로 시주를 계산했지만 현재 생활 패턴 문단의 선택에는 시주를 사용하지 않습니다. 따라서 같은 날 같은 월주에서 시각만 바뀌면 본문이 같을 수 있습니다.' : '출생시각을 몰라 시주를 만들지 않았습니다. 자녀·말년·시간에 따른 성향 같은 시주 의존 결론도 쓰지 않습니다.',
  ...chart.warnings,
  '생활 장면은 독자의 과거를 관찰한 기록이 아닌 해석 예시입니다. 실제 경험과 다르면 계산이 당신보다 당신을 더 잘 안다고 받아들이지 않아도 됩니다.'
 ],['pillars.hour','warnings'],'미확정 값은 제외하며, 생활의 중요한 판단은 실제 조건과 정보를 기준으로 해야 합니다.')
 ];
 const sections=[summary,strength,money,work,love].map((b,i)=>({id:['overview','strength','money','work','love'][i],title:TOC[i],blocks:[b]}));
 sections.push({id:'timing',title:TOC[5],blocks:flowBlocks},{id:'basis',title:TOC[6],blocks:technical});
 return {version:VERSION,title:'나의 성격·돈·일·관계',toc:TOC,preview:[summary,strength,love],sample:money,sections,evidence};
}
module.exports={generate,VERSION,TOC,selectors,profile:previous.profile};
