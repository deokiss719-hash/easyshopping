'use strict';
const previous=require('./report-v6');
const stories=require('./simple-stories');
const flows=require('./simple-flows');
const VERSION='ko-simple-story-7';
function setText(b,value){b.parts=value.split('\n\n').map(text=>({text}));b.text=b.parts.map(p=>p.text).join(' ');}
function generate(chart,version=VERSION){
 if(version!==VERSION)return previous.generate(chart,version);
 const r=previous.generate(chart),s=previous.selectors(chart);
 r.version=VERSION;
 const keys=['summary','strength','money','work','love'];
 const gods=[s.personality,s.strength,s.money,s.work,s.love];
 const missing=[
 '태어난 시간에 따라 계산이 달라져서 니 성격을 한쪽으로 말하기 어렵구나. 모르는 부분은 꾸며 넣지 않고, 확실히 계산된 것만 남겨두었단다.',
 '이번에는 장점과 약점을 읽는 데 필요한 값이 하나로 정해지지 않았구나. 어느 쪽이라고 말할 수 없어 이 부분은 남겨두었단다.',
 '돈을 대하는 모습을 읽는 데 필요한 값이 아직 분명하지 않구나. 어떤 방식으로 버는 것이 맞는지 이번 결과만으로 정하지는 않으마.',
 '태어난 시간의 범위 안에서 계산이 바뀌는구나. 어떤 일터가 니게 맞는지 한쪽으로 말할 수 없어 이 부분은 비워두었단다.',
 '가까운 사람을 대하는 모습을 읽을 값이 확실하지 않구나. 니가 어떤 말을 하고 다투는지 그럴듯하게 꾸며 말하지는 않으마.'
 ];
 for(let i=0;i<5;i++){
  const b=r.sections[i].blocks[0];setText(b,gods[i]?stories[gods[i]][keys[i]][1]:missing[i]);
  b.title='';b.hideHeading=true;
 }
 for(const b of r.sections[5].blocks){
  setText(b,b.id==='flow-guide'
   ? `여기서는 나이와 해에 따라 어떤 이야기를 읽는지 들려주마. 그때 꼭 무슨 일이 생긴다는 뜻은 아니란다. 같은 풀이여도 살아가는 곳과 선택에 따라 삶은 달라지지.\n\n지금은 긴 흐름을 한 방향으로 정할 정보가 없어 두 가지 계산을 함께 남겼단다. 둘 다 겪는다는 뜻은 아니지. 자세한 계산은 아래에서 볼 수 있고, 해마다의 이야기는 ${chart.referenceYear}년부터 5년을 담았단다.`
   :flows[b.id.slice(5)]);
  b.hideHeading=true;
 }
 // Detailed calculation language stays in the folded evidence, unchanged.
 r.sections[6].blocks[0].text=r.sections[6].blocks[0].text.replaceAll(previous.VERSION,VERSION);
 r.sections[6].blocks[0].parts.forEach(p=>p.text=p.text.replaceAll(previous.VERSION,VERSION));
 const byId=new Map(r.sections.flatMap(s=>s.blocks).map(b=>[b.id,b]));
 r.preview=r.preview.map(b=>byId.get(b.id));r.sample=byId.get(r.sample.id);
 return r;
}
module.exports={...previous,generate,VERSION};
