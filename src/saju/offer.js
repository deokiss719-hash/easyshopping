'use strict';
// Explicit server-side projection: never send hidden sections/analysis/traces before purchase.
function freeOffer(report, chart, scope = 3) {
  const sections=report.sections;
  const extract=(section,limit)=>{
    const b=section.blocks[0],parts=b.parts||[{text:b.text}];
    const visible=limit?parts.slice(0,limit):parts;
    return {id:b.id,title:section.title,parts:visible.map(p=>({text:p.text})),text:visible.map(p=>p.text).join(' ')};
  };
  // A useful, short opening; detailed life areas stay behind server authorization.
  const preview=[extract(sections[0], scope === 4 ? 3 : 2)];
  const money=sections.find(s=>s.id==='money').blocks[0];
  const sampleText=(money.parts?.at(-1)||{text:money.text}).text;
  return {version:report.version,title:report.title,
    toc:['금전운 상세 이야기','직업운 상세 이야기','애정운과 관계 상세 이야기','시기별 흐름과 해석의 한계'],
    preview,sample:{id:'paid-sample',title:'금전운 상세 풀이 중',parts:[{text:sampleText}],text:sampleText},evidence:{}};
}
module.exports={freeOffer};
