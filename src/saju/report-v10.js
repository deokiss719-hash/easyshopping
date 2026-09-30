'use strict';
const previous=require('./report-v9');
const {analyze,comparePeriod,FAMILY}=require('./whole-chart');
const {compose}=require('./narrative-stories');
const flows=require('./simple-flows');
const VERSION='ko-lived-story-10';
const TITLES=['한눈에 보는 나','장점과 단점','금전운','직업운','애정운과 관계','시기별 흐름','사주 계산 근거'];
function generate(chart,version=VERSION){
 if(version!==VERSION)return previous.generate(chart,version);
 const analysis=analyze(chart),evidence={},traces={};
 const all=analysis.certainty.knownPositions.map(k=>`pillars.${k}`);
 function block(id,claims,periods){
  const paths=[...new Set(claims.flatMap(c=>c.paths))];
  evidence[id]=paths.map(path=>({path,value:path.split('.').reduce((v,k)=>v?.[k],chart)}));
  if(evidence[id].some(e=>e.value===undefined))throw Error('unresolved reading evidence');
  traces[id]=claims.map((c,index)=>({paragraph:index,rule:c.id,paths:c.paths,sources:c.sources||[],kind:'traditional-symbolic-editorial-interpretation'}));
  return {id,title:'',hideHeading:true,parts:claims.map(c=>({text:c.text})),text:claims.map(c=>c.text).join(' '),ruleIds:claims.map(c=>c.id),...(periods?{periods}:{}),reason:'명리 원문에서 추출한 구조 조건과 편집된 생활 비유를 구분해 적용합니다. 실제 사건이나 과학적 성격 진단은 아닙니다.'};
 }
 const domains=['summary','strength','money','work','love'];
 const sections=domains.map((d,i)=>({id:d,title:TITLES[i],blocks:[block(d,compose(chart,analysis,d))]}));
 if(!chart.pillars.hour){
  const b=sections[0].blocks[0];
  const note=analysis.sensitivity.focusMayChange||analysis.sensitivity.supportMayChange
   ?'태어난 시각을 몰라 빠진 이야기가 있단다. 그 시각에 따라 읽는 중심이나 버티는 힘이 달라질 수 있어, 지금 보이는 모습이 전부라고 말하지는 않으마.'
   :'태어난 시각은 이 풀이에 넣지 않았단다. 지금 확인된 글자에서 이어지는 이야기만 들려주는 것이지, 모르는 시간을 짐작해 채운 것은 아니란다.';
  b.parts.push({text:note});b.text+=' '+note;
  evidence.summary.push({path:'input.timeType',value:chart.input.timeType});
  traces.summary.push({paragraph:b.parts.length-1,rule:'uncertainty-hour',paths:['input.timeType','variants.hour'],sources:[],kind:'calculation-limit'});
 }
 const timing=[];
 timing.push(block('flow-guide-v8',[{id:'flow-limits',text:'이제 나이와 해마다의 이야기를 니가 태어난 날의 모습과 함께 읽어주마. 같은 해라도 사람마다 다르게 풀리는 까닭이 여기에 있단다. 어느 때에 꼭 돈이 생기거나 결혼한다는 뜻은 아니지.',paths:['referenceYear','luck'],sources:['interaction']},
  {id:'flow-directions',text:'나이별 이야기는 첫 번째와 두 번째 풀이를 따로 적었단다. 지금 정보로는 둘 중 하나를 정할 수 없고, 둘을 동시에 겪는 것도 아니지. 나이는 대략이며, 해마다의 이야기는 그해 2월 초부터 다음 해 2월 초까지를 말한다. 같은 이야기를 거듭 읽지 않도록, 내용이 같은 나이와 해는 모아서 적었단다.',paths:['luck'],sources:[]} ]));
 // Keep direction and chronological order instead of combining unrelated ages under one ten-god.
 const contexts=[];
 const timingGroups=new Map();
 for(let i=0;i<chart.luck.length;i++)for(let j=0;j<chart.luck[i].cycles.length;j++){
  const cycle=chart.luck[i].cycles[j],path=`luck.${i}.cycles.${j}.pillar`;
  contexts.push({id:`age-${i}-${j}`,pillar:cycle.pillar,path,label:`${i===0?'첫 번째':'두 번째'} 풀이: 약 ${Math.round(cycle.ageRange[0])}살부터 ${Math.round(cycle.ageRange[1])}살까지`,young:cycle.ageRange[1]<=18});
 }
 for(let i=0;i<chart.annual.length;i++)contexts.push({id:`year-${chart.annual[i].year}`,pillar:chart.annual[i].pillar,path:`annual.${i}.pillar`,label:`${chart.annual[i].year}년 2월 초부터`,young:false});
 for(const c of contexts){
  const v=comparePeriod(chart,c.pillar,c.path);analysis[c.id]=v;
  const paths=['pillars.day',c.path,...v.relations.flatMap(x=>x.paths)];
  const claims=[];
  let base=flows[v.stemGod];
  if(c.young)base={peer:'이 나이의 이야기는 스스로 고르고 해보려는 마음으로 풀어볼 수 있단다. 놀이든 공부든 니가 정한 작은 일을 끝내면 뿌듯함이 남지. 다만 어리다는 이유로 모든 선택을 대신해주거나, 반대로 혼자 다 하라고 두는 것은 서로 다른 어려움을 만든다.',output:'이 나이에는 배운 것을 말이나 만들기로 꺼내보는 이야기를 읽는단다. 잘했는지 점수만 받기보다 무엇을 만들었는지 함께 봐주는 환경이 도움이 될 수 있지. 남보다 빠르게 많이 하라는 말만 들으면 즐겁던 일도 숙제가 되기 쉽다.',wealth:'이 나이에는 가진 것을 아끼고 나누는 일을 배우는 쪽으로 풀어보는 게 맞단다. 돈을 벌 때라고 해석하는 것은 아니지. 용돈이나 물건을 스스로 챙길 작은 기회가 있으면, 원하는 것과 지금 필요한 것이 다를 수 있음을 배우게 된다.',authority:'이 나이에는 약속과 규칙을 배우는 이야기가 담긴단다. 무엇을 해야 하는지 분명하면 마음이 놓일 수 있지. 하지만 잘해야만 사랑받는다고 느끼게 하면 작은 실수도 숨기려 할 수 있다. 잘못한 일을 고치는 것과 사람을 나쁘다고 부르는 것은 달라야 한단다.',resource:'이 나이의 이야기는 배우고 도움받는 일로 읽는단다. 모르는 것을 물었을 때 차근차근 알려주는 사람이 있으면 배움이 덜 두렵지. 다만 어른이 전부 대신 끝내주면 혼자 해봤다는 마음이 자라기 어렵다.'}[v.family];
  base.split('\n\n').forEach((text,index)=>claims.push({id:`timing-${v.family}-${index}${c.young?'-young':''}`,text,paths,sources:['month']}));
  const branchFamily=FAMILY[v.branchGod];
  if(branchFamily!==v.family)claims.push({id:`timing-under-${branchFamily}`,text:{peer:'겉으로 읽는 이야기 아래에는 니 뜻을 지키려는 모습도 함께 있구나. 함께 정한 일에서 니 몫이 전혀 없으면 겉으로 따라가도 마음은 멀어질 수 있지.',output:'이때의 다른 글자는 생각을 밖으로 꺼내는 쪽도 가리킨단다. 마음속으로만 정리한 것과 남에게 전해진 것은 다르니, 실제로 만들거나 말할 자리가 있어야 이야기가 이어진다.',wealth:'그 아래에는 가진 시간과 돈을 챙기는 이야기도 있구나. 해보고 싶은 일을 늘리는 만큼, 이미 쓰기로 한 것을 감당할 수 있는지가 함께 따라온다.',authority:'또 다른 쪽에서는 지켜야 할 약속이 함께 읽힌단다. 하고 싶은 일이 있어도 함께 정한 일을 버려두면 니 뜻을 펴기 어려워질 수 있지.',resource:'그 안에는 배우고 준비하는 모습도 함께 있단다. 새 일을 시작하는 속도와 그 일을 이해하는 속도가 다르면 마음만 급해질 수 있어, 배울 시간이 같이 있어야 한다.'}[branchFamily],paths:[c.path],sources:['interaction']});
  const clashes=v.relations.filter(x=>x.kind==='clash'),unions=v.relations.filter(x=>x.kind==='union');
  if(clashes.length){
   const withDay=clashes.some(x=>x.positions.includes('day'));
   claims.push({id:`timing-clash-${withDay?'day':'other'}`,text:withDay
    ?'니가 태어난 날의 모습과는 서로 다른 쪽으로 움직이는 짝이 있구나. 가까운 사람과 시간을 쓰는 방식이나 약속을 맞추는 일이 이 이야기에서 더 중요해진다. 이것을 이별이나 사고가 생긴다는 말로 바꾸지는 않으마.'
    :'원래 지닌 모습과 다르게 움직이는 짝도 함께 있단다. 익숙한 방법과 새로운 요구가 어긋날 때, 예전 약속을 그대로 둘지 다시 나눌지가 문제가 될 수 있지. 변화가 반드시 생기거나 나쁜 일이 정해졌다는 뜻은 아니다.',paths:clashes.flatMap(x=>x.paths),sources:['branch']});
  } else if(unions.length)claims.push({id:'timing-union',text:'원래 지닌 글자와 함께 묶이는 짝도 있구나. 혼자 하던 일을 누군가와 맞추거나, 이미 맺은 약속을 오래 이어가는 쪽으로도 읽는다. 다만 함께한다는 이유로 싫은 몫까지 떠안으면 가까움이 짐이 될 수 있지.',paths:unions.flatMap(x=>x.paths),sources:['branch']});
  if(v.repeats.length)claims.push({id:'timing-repeat',text:'태어날 때의 풀이에 있던 글자 한 쌍이 다시 나타나는 때이기도 하단다. 익숙한 선택이 다시 눈에 들어오는 모습으로 읽을 수는 있어도, 예전에 겪은 사건이 그대로 반복된다고 정하지는 않는다.',paths:[...v.repeats.map(k=>`pillars.${k}`),c.path],sources:['interaction']});
  if(analysis.support.status==='limited'&&['wealth','authority'].includes(v.family))claims.push({id:'timing-demand-condition',text:'니 쪽을 받치는 모습이 적게 확인된 풀이에서는, 더 맡을 수 있다는 말보다 어디까지 맡아도 되는지가 먼저란다. 할 수 있음을 보여주려다 쉴 자리까지 잃으면 오래 이어가기 어렵지.',paths:[...all,c.path],sources:['roots']});
  const baseCount=base.split('\n\n').length;
  const bundles=[claims.slice(0,baseCount),...claims.slice(baseCount).map(claim=>[claim])];
  for(const bundle of bundles){
   const key=JSON.stringify(bundle.map(x=>x.text));
   if(!timingGroups.has(key))timingGroups.set(key,{claims:bundle,labels:[]});
   const group=timingGroups.get(key);group.labels.push(c.label);
   group.claims.forEach((claim,i)=>claim.paths=[...new Set([...claim.paths,...bundle[i].paths])]);
  }
 }
 let groupIndex=0;
 for(const group of timingGroups.values())timing.push(block(`timing-${groupIndex++}`,group.claims,[...new Set(group.labels)]));
 sections.push({id:'flow',title:TITLES[5],blocks:timing});
 sections.push({id:'basis',title:TITLES[6],blocks:[block('method',[{id:'method-limit',text:'월령 지장간과 투출 후보, 통근, 생조·설기·극의 구조, 천간합·지지육합·육충·완전삼합 후보 및 원국과 시기 간 관계를 기록합니다. 가중 점수로 신강약·용신·격국 성패나 합화를 확정하지 않습니다. 생활 문장은 전통 상징을 편집한 비유이며 전문가 감정·적중률 검증을 대신하지 않습니다.',paths:all,sources:Object.keys(analysis.sources)}]) ]});
 const order=['summary','money','work','love','strength','flow','basis'];
 sections.sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
 return {version:VERSION,title:'나의 사주 이야기',toc:TITLES,sections,preview:['summary','strength','love'].map(id=>sections.find(s=>s.id===id).blocks[0]),sample:sections.find(s=>s.id==='money').blocks[0],evidence,analysis,traces};
}
module.exports={...previous,generate,VERSION};
