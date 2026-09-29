'use strict';
const previous=require('./report-v5');
const stories=require('./grandmother-stories');
const flows=require('./grandmother-flows');
const VERSION='ko-grandmother-story-6';
function setText(block,text,title=block.title){
 block.title=title;
 block.parts=text.split('\n\n').map(text=>({text}));
 block.text=block.parts.map(p=>p.text).join(' ');
}
function generate(chart,version=VERSION){
 if(version!==VERSION)return previous.generate(chart,version);
 const r=previous.generate(chart),chosen=previous.selectors(chart);
 r.version=VERSION;
 const kinds=['summary','strength','money','work','love'];
 const gods=[chosen.personality,chosen.strength,chosen.money,chosen.work,chosen.love];
 const missing=[
  ['한 가지 성격으로 묶지 않은 까닭','태어난 시간의 범위 안에서 기준이 달라지는구나. 이럴 때는 니 성향을 한쪽으로 묶어 말할 수 없단다. 모르는 자리에 그럴듯한 말을 채우면 이야기는 매끈해도 근거는 흐려지지. 확정된 부분만 이 풀이에 남겨두었단다.'],
  ['장점과 약점의 경계가 흐린 자리','환경에 대응하는 방식을 읽을 글자가 하나로 정해지지 않았구나. 어느 쪽에나 맞을 만한 칭찬으로 이 자리를 메우지는 않으마. 장점과 약점을 짝지으려면 먼저 같은 성향을 가리키는 기준이 분명해야 하는 게다.'],
  ['돈의 방식을 하나로 정하지 않은 자리','이번 입력에서는 수익 활동의 중심을 잡을 값이 확정되지 않았단다. 독립해서 버는 쪽인지 차근차근 관리하는 쪽인지, 니 돈의 방식을 여기서 고르지는 않으마. 흐린 근거를 분명한 돈 이야기처럼 꾸미지는 않는 게 맞지.'],
  ['일터의 방향을 남겨둔 까닭','출생 범위 안에서 일의 역할을 읽는 기준이 바뀌는구나. 이번 결과만으로 니가 자율적인 곳에 맞는지 규칙적인 곳에 맞는지 결론내릴 수는 없단다. 어느 환경에서도 잘한다는 말로 대신하는 것도 니게 도움이 되지 않지.'],
  ['관계의 성향을 채우지 않은 자리','가까운 관계를 읽을 기준이 확인되지 않았구나. 이 자리에서 니가 어떤 말을 하고 어떤 갈등을 겪는지 만들어낼 수는 없단다. 상대의 마음까지 대신 짐작하면 더 멀리 어긋나게 되는 게다.']
 ];
 for(let i=0;i<5;i++){
  const [title,body]=gods[i] ? stories[gods[i]][kinds[i]] : missing[i];
  setText(r.sections[i].blocks[0],body,title);
 }
 for(const b of r.sections[5].blocks){
  if(b.id==='flow-guide')setText(b,
   `여기 담긴 나이와 연도는 어떤 사건이 꼭 생기는 때가 아니라, 전통 풀이에서 읽는 삶의 주제란다. 같은 주제가 돌아오는 구간은 한데 모아두었지. 실제로 그 주제가 어떤 모습이 되는지는 니가 놓인 환경과 선택에 달려 있다.\n\n성별을 받지 않아 대운의 방향은 하나로 정하지 않았단다. 순행과 역행은 서로 다른 가정이지, 둘을 동시에 겪는다는 뜻도 마음에 드는 쪽이 맞다는 뜻도 아니다. 시작 나이는 근사 범위이고, 연도별 흐름은 ${chart.referenceYear}년부터 5년을 담았단다.`, '삶의 흐름에 담긴 이야기');
  else setText(b,flows[b.id.slice(5)]);
 }
 const technical=r.sections[6].blocks;
 setText(technical[0],`달력에서 글자를 구하는 일과 그 글자로 사람의 경향을 읽는 일은 구별해야 한단다. 계산은 ${chart.version}, 이야기 버전은 ${VERSION}을 썼지. 성격·장단점·일은 월간과 일간의 관계, 인연은 일지 본기, 돈은 드러난 재성과 월간을 기준으로 문장을 골랐단다.\n\n이야기에 자신 있는 말투를 썼다고 니가 실제로 한 행동을 본 것은 아니란다. 전통 상징을 현실의 장면으로 옮긴 풀이이지, 과학적 성격 진단이나 미래의 증명은 아니지. 신강·신약·격국·용신·합화까지 종합한 감정은 아니며, 같은 선택 기준이면 일부 문단은 같을 수 있단다.`, '이 이야기를 읽은 기준');
 setText(technical[1],'원국과 오행, 음양, 십성, 대운·세운의 값은 아래 계산표와 문단별 근거에 남겨두었단다. 오행은 확정된 겉글자의 수를 센 것이지, 지장간까지 더한 힘의 점수는 아니지.\n\n연주는 입춘, 월주는 절입, 일주는 출생지의 자정을 기준으로 했단다. 역사적 표준시와 서머타임은 적용하지만 진태양시 보정은 하지 않으니, 다른 만세력과 기준에 따른 차이가 날 수 있다.', '이야기 뒤에 남긴 계산값');
 setText(technical[2],(chart.pillars.hour
  ? '태어난 시각으로 시주는 계산했지만, 이번 이야기의 생활 성향 문단을 고를 때는 그 값을 쓰지 않았단다. 같은 날 같은 월주에서 시각만 달라지면 생활 이야기는 같을 수 있지.'
  : '태어난 시각을 모르니 시주를 만들어 넣지 않았단다. 자녀나 말년처럼 그 자리에 기대는 결론도 쓰지 않았지. 확정되지 않은 기둥은 오행의 개수에도 넣지 않는 게다.')+
 '\n\n절기 경계나 시간 범위 때문에 달라지는 값은 한쪽으로 정하지 않았단다. 오래된 표준시와 음력 변환에는 정해둔 계산 기준을 적용했지. 건강이나 재산의 크기, 결혼과 사건의 날짜를 이 이야기만으로 확정할 수는 없단다. 같은 글자를 지녀도 살아가는 조건과 선택은 다르기 때문이지.', '알 수 없는 것은 남겨두었단다');
 technical.forEach(b=>b.collapsed=true);
 const byId=new Map(r.sections.flatMap(s=>s.blocks).map(b=>[b.id,b]));
 r.preview=r.preview.map(b=>byId.get(b.id));r.sample=byId.get(r.sample.id);
 return r;
}
module.exports={...previous,generate,VERSION};
