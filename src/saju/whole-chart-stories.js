'use strict';
// Original modern-life analogies, editorial mappings rather than quotations or proven predictions.
const basic=require('./simple-stories');
const {FAMILY}=require('./whole-chart');
function compose(chart,a,domain){
 const rules=[];
 const all=a.certainty.knownPositions.map(k=>`pillars.${k}`);
 const add=(id,text,paths=all,sources=['month','roots','interaction'])=>rules.push({id,text,paths,sources});
 const pick=(family)=>a.groups[family].visible[0]?.tenGod||a.hidden.find(h=>h.position==='month'&&h.main&&FAMILY[h.tenGod]===family)?.tenGod;
 const has=id=>a.patterns.some(p=>p.id===id);
 let selected=a.focus?.god;
 if(domain==='money')selected=pick('wealth')||pick('output')||selected;
 if(domain==='love')selected=chart.pillars.day.hiddenStems[0].tenGod;
 if(!selected){
  add(`${domain}-uncertain`,{
   summary:'태어난 날 안에서도 계산이 바뀌는 때가 있어 니 모습을 한쪽으로 정하지 않았단다. 확실하지 않은 자리를 그럴듯한 성격 이야기로 채우지는 않으마.',
   strength:'장점과 약점을 읽는 중심이 하나로 정해지지 않았구나. 같은 말도 어떤 조건에서는 힘이 되고 다른 조건에서는 짐이 되니, 지금은 한쪽을 골라 말하기 어렵다.',
   money:'돈을 대하는 모습을 읽는 데 필요한 값이 아직 나뉘어 있구나. 크게 벌 사람인지 아껴 모을 사람인지 지금 정보만으로 정하지는 않으마.',
   work:'어떤 일을 맡을 때 힘이 나는지 한쪽으로 말하기 어려운 입력이란다. 출생 시각에 따라 중심이 달라질 수 있어 여기서는 일터를 골라주지 않으마.',
  }[domain]);return rules;
 }
 basic[selected][domain][1].split('\n\n').forEach((t,i)=>add(`${domain}-base-${selected}-${i}`,t,domain==='love'?['pillars.day']:all,['month']));
 const support=a.support.status;
 if(domain==='summary'){
  if(has('change-and-rules'))add('summary-two-wishes','그런데 니 안에는 고치고 싶은 마음과 제대로 인정받고 싶은 마음이 함께 있구나. 잘못된 규칙에는 한마디 하고 싶으면서도, 그 말 때문에 믿음을 잃는 것은 싫은 게다. 생각을 내는 시간과 정한 일을 지키는 시간이 나뉘어 있으면 두 마음이 서로 발목을 잡지 않는다.');
  else if(has('learning-and-making'))add('summary-study-and-action','가만히 배우고 싶은 마음만 있는 것은 아니구나. 배운 것을 니 방식으로 만들어 보여주려는 마음도 함께 읽힌다. 설명을 들을 때는 조용해도 직접 해볼 차례가 오면 의견이 또렷해질 수 있지. 준비만 시키거나, 배울 틈 없이 결과만 재촉하는 곳에서는 둘 중 한쪽이 답답해진다.');
  else if(has('rules-and-learning'))add('summary-reliable-learning','니가 정한 답만 밀어붙이는 모습으로 끝나지는 않는구나. 잘 아는 사람에게 배우고, 배운 것을 제대로 지키려는 마음도 함께 있다. 처음에는 조심스럽다가 방법을 익힌 뒤에 더 단단해질 수 있지. 다만 윗사람이 말했다는 이유만으로 틀린 약속까지 지킬 필요는 없단다.');
  else if(has('sharing-money'))add('summary-own-and-shared','혼자 정하고 싶은 마음과 사람을 통해 일을 넓히려는 마음이 함께 보이는구나. 도와주는 사람이 많아도 니 뜻대로 못하면 답답할 수 있지. 서로 맡을 몫을 정한 뒤에는 각자의 방법을 인정하는 사이가 잘 맞는다.');
  else if(support==='supported')add('summary-support','다른 글자까지 함께 보면, 마음먹은 것을 붙들 바탕도 여러 곳에서 받쳐주는구나. 주변 반응에 바로 흔들리기보다 니가 정한 길을 이어가려는 쪽으로 읽는다. 다만 잘 버틴다는 것이 언제나 옳다는 뜻은 아니지. 틀린 길에서도 오래 버티면 돌아오는 데 더 큰 수고가 든다.');
  else if(support==='limited')add('summary-demand','겉으로 맡는 일에 비해 니 쪽을 받쳐주는 모습은 확인된 글자에서 적게 보이는구나. 그래서 많은 일을 해낼 때의 모습만 보고 늘 괜찮은 사람이라고 읽지는 않으마. 부탁을 받을 때는 움직여도 혼자 쉬는 시간까지 없어지면 오래 이어가기 어렵다는 쪽에 무게를 둔다.');
  else add('summary-mixed','한 가지 모습으로만 밀고 가는 풀이는 아니란다. 니 편을 들어주는 모습과 니 힘을 바깥으로 쓰게 하는 모습이 함께 있다. 익숙한 자리에서는 단단해도 낯선 요구가 겹치면 망설일 수 있지. 그래서 잘하는 일이 있다는 것과 어떤 상황에서도 편하다는 것은 따로 보는 게다.');
 }
 if(domain==='strength'){
  if(support==='supported')add('strength-supported','니가 잘하는 것을 오래 밀고 갈 바탕이 있다는 쪽으로 읽는단다. 여러 사람이 흔들려도 이미 익힌 일은 계속 이어갈 수 있지. 하지만 도움을 줄 사람이 있는데도 혼자 해야 마음이 놓이면, 니 실력이 주변 사람의 자랄 자리를 막을 수 있다. 혼자 해낸 양보다 함께 오래 갈 수 있는지가 중요해지는 게다.');
  else if(support==='limited')add('strength-limited','좋은 점을 쓰려면 얼마나 맡는지가 먼저 맞아야 하는 구성이구나. 범위가 작은 일에서는 세심하게 해내도, 부탁이 겹치면 그 장점이 조급함으로 바뀔 수 있지. 못하는 사람이라서가 아니라 잘하는 것을 쓸 틈이 없어지는 것이다. 감당할 양을 정할 수 있는 자리가 필요하단다.');
  else if(a.roots.positions.length)add('strength-roots','처음부터 모든 일에 자신 있는 모습보다는, 손에 익힌 것이 생긴 뒤 버티는 힘이 붙는 쪽도 함께 읽힌다. 남이 서두른다고 배우던 것을 버리기보다 익숙한 바탕에서 넓혀갈 때 덜 흔들리지. 다만 이미 잘하는 것만 골라 하면 새로 배울 자리가 줄어드는 약점도 있다.');
  else add('strength-no-roots','눈에 띄는 말이나 행동만큼 속을 받칠 준비도 필요한 쪽으로 읽는단다. 시작할 때의 기세만 보고 일을 더 얹으면, 마무리할 때 쓸 힘이 모자랄 수 있지. 아직 익숙하지 않은 일을 작게 끝내본 경험이 쌓일 수 있어야 첫마음도 오래 남는다.');
  if(a.monthCandidates.length>1)add('strength-multiple','또 하나만 잘하는 사람으로 좁힐 수는 없구나. 태어난 달에서 읽는 여러 모습이 겉으로 함께 드러나기 때문이다. 서로 다른 일을 모두 잘하려다 어느 쪽도 놓지 못하면 바빠지기 쉽고, 함께 쓸 수 있는 역할을 맡으면 오히려 재주가 넓어진다.', ['pillars.month',...a.visible.map(v=>v.path)],['mixedMonth']);
 }
 if(domain==='money'){
  if(has('making-to-money'))add('money-making-chain',support==='limited'
   ?'만드는 힘과 값을 받는 힘은 함께 보이지만, 맡는 양을 늘리는 쪽으로만 읽지는 않으마. 주문이 많아도 니 시간과 몸이 먼저 모자라면 싼값에 바쁘기만 해질 수 있지. 같은 일을 더 많이 하는 것보다 한 번 맡을 때 남는 돈과 쓸 시간을 맞추는 쪽이 중요하단다.'
   :'다른 글자를 함께 보면, 니가 만들어낸 것을 실제로 원하는 사람에게 전하는 길이 연결되는구나. 손재주든 설명이든 잘한 것을 보여주고 그에 맞는 값을 받는 방식이지. 다만 만들기만 좋아하고 값 말하기를 미루면 연결이 끊긴다. 잘 만든 것과 팔고 남는 돈이 함께 이어져야 한다.');
  else if(has('sharing-money'))add('money-peer-chain','돈을 챙기는 모습 옆에 함께 움직이고 나눠 쓰는 모습도 있구나. 여럿이 하면 일은 빨리 커질 수 있지만, 누가 한 일을 누구 돈으로 계산할지가 흐려지기 쉽지. 친구와 하는 작은 장사라도 친한 마음과 돈 계산이 따로 서 있어야 함께 번 돈 때문에 사이가 무너지지 않는다.');
  else if(has('rules-and-learning'))add('money-trust-chain','이번 구성을 돈으로 읽을 때는 모르는 곳에 급히 돈을 넣는 이야기보다, 배운 것을 믿고 맡길 만한 일로 만드는 쪽이 더 이어진다. 자격만 늘어나는 것과 실제로 일을 맡아 돈을 받는 것은 다르지. 배운 뒤 맡을 일이 없으면 준비 비용이 쌓일 수 있단다.');
  else if(!a.groups.wealth.active)add('money-not-prominent','확인된 글자에서는 돈을 직접 챙기는 모습이 앞에 강하게 드러나지는 않는구나. 그렇다고 돈이 없을 사주라는 뜻은 아니란다. 일을 잘 끝내거나 사람을 도운 뒤에도 값과 받는 날짜는 따로 정해져야 한다는 쪽으로 읽는다. 보람이 곧 생활비가 되지는 않으니까.');
  else add('money-capacity',support==='supported'
   ?'돈을 맡고 챙기는 모습에 니 쪽을 받치는 바탕도 함께 있구나. 그래서 작은 것을 모으는 일에서 끝내기보다 맡은 돈을 스스로 관리하는 쪽도 살펴볼 만하다. 다만 자신 있게 정하는 힘이 손해를 인정하지 않는 고집으로 바뀌면 작은 손실이 오래 남을 수 있지.'
   :'돈에 관한 선택은 보이지만, 그 선택을 모두 한꺼번에 맡을 만큼 편한 구성이라고 단정하지는 않으마. 들어올 돈만 보고 미리 약속한 지출이 많아지면 마음이 급해질 수 있지. 받을 돈이 실제로 들어온 뒤에 다음 일을 정할 수 있어야 니 판단도 덜 흔들린다.');
 }
 if(domain==='work'){
  if(has('change-and-rules'))add('work-change-rules','일을 고치는 마음과 정해진 약속을 지키는 마음이 한자리에 있구나. 그래서 모두 시키는 대로만 하는 자리도, 매일 말이 바뀌는 자리도 편하지 않을 수 있다. 정한 것을 지키되 잘못된 점은 고칠 수 있는 일이 잘 맞지. 말을 꺼낸 사람이 뒷일도 맡을 수 있어야 불평으로 끝나지 않는다.');
  else if(has('rules-and-learning'))add('work-rules-learning','배우는 모습과 책임을 맡는 모습이 이어지는구나. 처음부터 혼자 알아서 하라는 곳보다, 방법을 익힌 뒤 맡는 범위를 넓혀주는 곳에서 힘이 붙는다. 반대로 계속 보조만 시키고 직접 정할 일은 주지 않으면 아는 것에 비해 자신감이 자라기 어렵지.');
  else if(has('learning-and-making'))add('work-learning-making','자료를 이해하는 일과 직접 만들어 보는 일이 함께 이어질 때 좋다는 쪽으로 읽는다. 설명서만 읽는 것도, 이유를 모른 채 반복하는 것도 오래 하면 답답할 수 있지. 작은 것을 만들어 반응을 받고 다시 고치는 일이 있는 곳에서 배운 것이 니 실력으로 남는다.');
  else if(has('making-to-money'))add('work-making-value','만드는 일과 쓰는 사람의 반응이 이어져야 힘이 나는 모습도 함께 있구나. 무엇을 잘했는지 손님이나 동료에게서 바로 알 수 있으면 다음에 고칠 곳도 보이지. 열심히 했다는 말만 있고 실제로 누가 쓰는지 모르면 일할 재미가 줄어들 수 있다.');
  else add('work-support-condition',support==='limited'
   ?'어려운 일을 해낼 수 있다는 말만으로 자꾸 일을 더 얹는 곳은 맞지 않는 쪽으로 읽는다. 혼자 버틸 수 있는지를 시험하는 자리보다 막힐 때 물을 사람과 쉬어갈 시간이 있는 자리가 필요하지. 니가 하는 일의 크기를 니가 조절할 수 있어야 한다.'
   :'다른 사람의 지시를 받아 시작했더라도, 익힌 뒤에는 니가 정할 몫이 생겨야 힘을 오래 쓸 수 있겠구나. 책임은 늘어나는데 방법은 하나도 바꿀 수 없다면 잘하던 일도 답답해진다. 경험이 쌓인 만큼 맡기는 방식도 달라지는 곳이 어울린다.');
 }
 if(domain==='love'){
  const clashes=a.relationWithDay.filter(x=>x.kind==='clash'),unions=a.relationWithDay.filter(x=>x.kind==='union');
  if(clashes.length&&unions.length)add('love-both','가까워지려는 모습과 서로 다른 쪽으로 움직이려는 모습이 함께 잡히는구나. 좋아할수록 다 맞추려다가 갑자기 혼자 있고 싶어질 수 있다는 쪽으로 읽는다. 이것을 헤어질 운이라고 정하지는 않으마. 함께 정할 일과 각자 정할 일이 나뉘어 있어야 가까움이 답답함으로 바뀌지 않는다.',a.relationWithDay.flatMap(x=>x.paths),['branch']);
  else if(clashes.length)add('love-clash',clashes.some(x=>x.positions.includes('month'))
   ?'일이나 집 밖의 약속과 둘이 보내는 시간이 부딪히는 모습도 함께 읽히는구나. 밖에서는 맡은 일을 잘해도 가까운 사람에게는 늘 마지막 순서가 될 수 있지. 이것만으로 사이가 나빠진다고 정하는 것은 아니란다. 바쁜 사정을 서로 알고도 함께할 시간이 실제로 남아 있어야 서운함이 쌓이지 않는다.'
   :'가까운 사이에서 원하는 속도가 서로 달라지는 모습도 살펴야겠구나. 한쪽은 바로 정하고 싶은데 다른 쪽은 기다리고 싶으면 작은 일도 다툼이 될 수 있지. 글자가 부딪힌다고 이별이 정해진 것은 아니란다. 둘의 속도가 다른 것을 잘못으로 몰지 않는 사이여야 오래 편하다.',clashes.flatMap(x=>x.paths),['branch']);
  else if(unions.length)add('love-union','가까운 사람과 맞추고 함께 묶이는 모습이 더해지는구나. 함께 정한 일을 오래 이어가는 데에는 도움이 될 수 있지. 다만 마음이 가깝다고 모든 취향까지 같아야 하는 것은 아니란다. 싫은 것도 말할 수 있어야 맞춰주는 마음이 나중에 억울함으로 돌아오지 않는다.',unions.flatMap(x=>x.paths),['branch']);
  else add('love-no-direct','가까운 관계를 읽는 자리에서, 다른 자리와 바로 부딪히거나 묶이는 짝은 확인되지 않았단다. 그래서 정해진 갈등이나 반드시 붙잡히는 인연 이야기를 덧붙이지는 않으마. 위에서 읽은 표현 방식이 서로에게 어떻게 전해지는지를 중심으로 보는 게 맞다.',all,['branch']);
 }
 return rules;
}
module.exports={compose};
