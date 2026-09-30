'use strict';
// Explicit projection: masked text is decorative; locked prose never leaves the server.
function freeOffer(report, chart, scope = 3) {
  const money=report.sections.find(s=>s.id==='money').blocks[0];
  const parts=money.parts?.length ? money.parts : money.text.split(/(?<=[.!?。！？])\s+/u).map(text=>({text}));
  const opening=parts[0]?.text || '';
  const turn=(parts[1]?.text || '').match(/^.*?[.!?。！？](?:\s|$)/u)?.[0]?.trim() || '';
  const visible=[{text:opening}];
  if(scope===4 && turn)visible.push({text:turn});
  return {version:report.version,title:report.title,
    toc:['금전운 상세 이야기','직업운 상세 이야기','애정운과 관계 상세 이야기','시기별 흐름과 해석의 한계'],
    preview:[{id:money.id,title:'나의 금전운',parts:visible,text:visible.map(p=>p.text).join(' ')}],
    evidence:{}};
}
module.exports={freeOffer};
