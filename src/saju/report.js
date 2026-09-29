'use strict';
const previous = require('./report-v4');
const VERSION = 'ko-story-5';
const titles = {
 '소신인가, 결정 지연인가':'소신이 힘이 될 때와 고집이 될 때',
 '내 실력으로 벌고, 비교 때문에 쓰나요':'내 실력으로 번 돈과 비교에 쓰는 돈',
 '가까워져도 내 공간은 필요한가':'가까운 사이에도 필요한 나의 공간',
 '승부욕은 어디까지 도움이 될까':'사람 사이에서 커지는 승부욕',
 '같이 벌 때 몫도 같이 정했나요':'함께 버는 돈에 따라오는 관계의 비용',
 '완성할 시간이 주어지는가':'끝까지 완성할 수 있는 환경',
 '챙겨주는 마음이 왜 안 전해질까':'챙겨주는 마음과 상대가 받는 마음',
 '맞는 말인데 왜 부딪칠까':'옳은 말이 부딪힘으로 바뀌는 순간',
 '질문을 허용하는 조직인가':'질문이 성과로 이어지는 조직',
 '밖을 보는 역할인가, 붙잡아두는 자리인가':'새로운 접점을 만드는 역할',
 '강한 책임감인가, 상시 비상근무인가':'책임감이 긴장을 놓지 못하게 할 때',
 '어려운 일을 맡았는데 보수도 달라졌나요':'어려운 일의 무게와 그에 맞는 대가',
 '언제 무엇을 살펴볼까요':'삶의 흐름에 담긴 주제',
 '어떤 기준으로 읽었나요':'풀이에 적용한 기준'
};
function prose(sentences) {
 if(sentences.length!==5) return sentences.length===4
  ? [sentences.slice(0,2).join(' '),sentences.slice(2).join(' ')] : sentences;
 const [judgment,scene,strength,weakness,response]=sentences;
 const sceneText=scene.replace(/장면이 어울립니다\.$/,'모습을 떠올릴 수 있습니다.')
  .replace(/장면입니다\.$/,'상황에서 그 성향이 드러날 수 있습니다.')
  .replace(/모습입니다\.$/,'모습에 가깝습니다.');
 return [`${judgment} ${sceneText} ${strength}`,`다만 ${weakness} 그래서 ${response}`];
}
function generate(chart, version=VERSION) {
 if(version!==VERSION)return previous.generate(chart,version);
 const report=previous.generate(chart);
 report.version=VERSION;
 const replacements=new Map();
 for(const [i,section] of report.sections.entries()) for(const b of section.blocks){
  b.title=titles[b.title] || b.title;
  if(i<6 && b.parts) {
   b.parts=prose(b.parts.map(p=>p.text)).map(text=>({text}));
   b.text=b.parts.map(p=>p.text).join(' ');
  }
  if(b.id==='rules') {
   b.parts=b.parts.map(p=>({...p,text:p.text.replaceAll('ko-pattern-4',VERSION)}));
   b.text=b.parts.map(p=>p.text).join(' ');
  }
  replacements.set(b.id,b);
 }
 report.preview=report.preview.map(b=>replacements.get(b.id));
 report.sample=replacements.get(report.sample.id);
 return report;
}
module.exports={...previous,generate,VERSION};
