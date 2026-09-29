'use strict';
const fs=require('node:fs');
const {calculate}=require('../src/saju/calculator');
const {generate}=require('../src/saju/report');
const old=require('../src/saju/report-v8');
const inputs=[['1990-01-09','02:00'],['1990-01-09','12:00'],['1990-01-09',null],['1988-08-15','04:00'],['1975-11-21','19:30'],['2000-04-17','08:00'],['1996-07-12','16:00'],['1985-03-21','10:30'],['1970-12-12','07:00'],['1992-09-18','20:00'],['2001-06-03','15:00'],['1990-01-05',null]];
const jargon=/순행|역행|입춘|통근|월령|지장간|정관|편재|신강|신약|격국|용신/g;
const questions=/[?？]|보거라|확인해|떠올려|해보렴|기록해/g;
const lookup=(o,p)=>p.split('.').reduce((v,k)=>v?.[k],o);
const rows=inputs.map(([date,time])=>{
 const c=calculate({date,calendar:'solar',zone:'Asia/Seoul',timeType:time?'exact':'unknown',...(time?{time}:{})});
 const before=old.generate(c),after=generate(c);
 const body=after.sections.filter(s=>s.id!=='basis').flatMap(s=>s.blocks.map(b=>b.text)).join(' ');
 const unresolved=Object.values(after.traces).flatMap(t=>t.flatMap(x=>x.paths)).filter(p=>lookup(c,p)===undefined);
 const sentences=after.sections.slice(0,5).flatMap(s=>s.blocks.flatMap(b=>b.parts.flatMap(p=>p.text.split(/(?<=[.!?])\s+/u))));
 const duplicate=[...new Set(sentences.filter((v,i)=>sentences.indexOf(v)!==i))];
 const flow=after.sections.find(s=>s.id==='flow').blocks.flatMap(b=>b.parts.map(p=>p.text));
 return {date,time,chart:c,before,after,checks:{jargon:(body.match(jargon)||[]).length,questions:(body.match(questions)||[]).length,unresolved:unresolved.length,duplicateMainSentences:duplicate,duplicateFlowParagraphs:flow.length-new Set(flow).size}};
});
const unique=version=>[0,2,3,4].map(n=>new Set(rows.map(x=>x[version].sections[n].blocks[0].text)).size);
let md='# 원국 관계 종합 풀이 v9 — 12개 가상 입력 비교\n\n검사일: 2026-09-29. 실제 고객 정보가 아닌 테스트 생일입니다. 기존 v8의 계산값과 저장 결과는 바꾸지 않습니다. 이 비교는 적중률·심리 진단 검사가 아닙니다.\n\n';
md+=`서로 다른 본문 수(성격/돈/일/관계): v8 ${unique('before').join('/')} → v9 ${unique('after').join('/')}. 문장이 다르다는 사실 자체가 정확도 향상을 증명하지 않습니다.\n\n`;
md+='|입력|시각|달의 바탕 선택|보조 조건|모르는 시각의 영향|용어/질문/미해결 근거|중복 본문 문장/시기 문단|\n|---|---|---|---|---|---|---|\n';
for(const x of rows){const a=x.after.analysis;md+=`|${x.date}|${x.time||'모름'}|${a.focus?.god||'보류'}|${a.support.status}, ${a.patterns.map(p=>p.id).join(',')}|${JSON.stringify(a.sensitivity)}|${x.checks.jargon}/${x.checks.questions}/${x.checks.unresolved}|${x.checks.duplicateMainSentences.length}/${x.checks.duplicateFlowParagraphs}|\n`;}
for(const x of rows){md+=`\n## ${x.date} ${x.time||'시각 모름'}\n\n${Object.entries(x.chart.pillars).map(([k,p])=>`${k}: ${p?.chars||'미확정'}`).join(' / ')}\n`;
 for(const n of [0,2,3,4])md+=`\n### ${x.after.sections[n].title}\n\n이전:\n\n${x.before.sections[n].blocks[0].text}\n\n수정:\n\n${x.after.sections[n].blocks[0].parts.map(p=>p.text).join('\n\n')}\n\n규칙: ${x.after.sections[n].blocks[0].ruleIds.join(', ')}\n`;
}
md+='\n## 해석 한계\n\n- 월령·투출 후보와 전체 확인된 기둥의 관계를 읽는 결정 규칙입니다. 같은 구조에는 일부 동일 문장이 쓰입니다.\n- 고전의 현대생활 비유는 편집적 해석이며 전문가 검수나 예측 정확도 검증이 아닙니다.\n- 신강약·격국·용신·합화 성립을 최종 확정하지 않습니다. 형파해·신살·정밀 조후 용신은 다루지 않습니다.\n- 시주 미상 민감도는 가능한 시주가 중심/보조분류/관계조합을 바꿀 수 있는지 검사합니다. 가상 시주를 실제 원국에 넣지 않습니다. 절기일 월주 미확정은 선택을 보류합니다.\n- 대운 방향은 정보 부족으로 두 가정을 유지하고, 세운은 기존 2026~2030 범위입니다.\n- 질문/중복 탐지로 모든 의미 반복이나 독해 난이도를 증명할 수는 없습니다.\n';
fs.writeFileSync('docs/saju/WHOLE-CHART-v9-COMPARISON.md',md);
fs.writeFileSync('docs/saju/WHOLE-CHART-v9-METRICS.json',JSON.stringify({uniqueBefore:unique('before'),uniqueAfter:unique('after'),rows:rows.map(x=>({date:x.date,time:x.time,checks:x.checks,focus:x.after.analysis.focus,support:x.after.analysis.support.status,sensitivity:x.after.analysis.sensitivity}))},null,2));
console.log(JSON.stringify({uniqueBefore:unique('before'),uniqueAfter:unique('after'),rows:rows.map(x=>({date:x.date,time:x.time,...x.checks}))},null,2));
