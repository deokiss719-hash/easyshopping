'use strict';
// Explicit projection: masked text is decorative; locked prose never leaves the server.
function freeOffer(report, chart, scope = 3) {
  const preview=['money','love'].map(id=>{
    const block=report.sections.find(s=>s.id===id).blocks[0];
    const parts=block.parts?.length ? block.parts : block.text.split(/(?<=[.!?。！？])\s+/u).map(text=>({text}));
    const visible=[{text:parts[0]?.text || ''}];
    const turn=(parts[1]?.text || '').match(/^.*?[.!?。！？](?:\s|$)/u)?.[0]?.trim();
    if(scope===4 && turn)visible.push({text:turn});
    return {id:block.id,title:id==='money'?'돈 이야기':'연애 이야기',parts:visible,text:visible.map(p=>p.text).join(' ')};
  });
  return {version:report.version,title:report.title,
    toc:['금전운 상세 이야기','직업운 상세 이야기','애정운과 관계 상세 이야기','시기별 흐름과 해석의 한계'],
    preview,
    evidence:{}};
}
module.exports={freeOffer};
