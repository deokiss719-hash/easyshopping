'use strict';
const fs=require('node:fs');
const {calculate}=require('../src/saju/calculator');
const {generate,selectors}=require('../src/saju/report');
const {metrics}=require('./saju-content-audit');
const forbidden=/[?？]|보거라|떠올려|확인해|적어보|적어 보|기록해|물어보|물어 보|(?<![가-힣])답해|해보세요|해 보세요|너는 어떠|니는 어떠|하렴|해라/g;
const jargon=/경금|정관|편재|월주|월간|지장간|일간|십성/g;
const dates=['1990-01-01','1990-01-02','1990-01-03','1990-01-06','1990-01-07','1990-01-08','1990-01-09','1990-01-10','1988-08-15'];
function inspect(r){const body=r.sections.flatMap(s=>s.blocks).map(b=>b.title+' '+b.text).join(' ');const m=metrics(r);return {forbidden:(body.match(forbidden)||[]),introJargon:(r.sections[0].blocks[0].text.match(jargon)||[]).length,repeatPairs:m.repeatPairs,nearPairs:m.nearPairs,near:m.near};}
function run(){
 const rows=dates.map(date=>{const chart=calculate({date,calendar:'solar',timeType:'unknown',zone:'Asia/Seoul'});const report=generate(chart);return {date,selected:selectors(chart),chart,report,check:inspect(report)};});
 let md='# 할머니 이야기형 v6 — 실제 생성 비교\n\n모두 가상 입력이며 양력·대한민국·출생시각 모름입니다. 원국 계산은 그대로 두고 선택된 십성에 연결하는 이야기 전체를 새로 집필했습니다.\n\n## 점검 결과\n\n질문부호·독자 질문·확인/회상/기록/답변 과제를 탐지하고, 장 사이 동일 문장과 문자 3-gram Jaccard ≥0.68 유사 문장을 점검했습니다. 이 탐지기는 의미의 일반성이나 모든 유사 조언을 완벽하게 판단하지는 못하므로 아래 생성 문단도 직접 비교했습니다.\n\n|생일|성격 / 돈 / 관계의 선택 기준|질문·과제|첫 문단 용어|장 간 반복|고유사 문장|\n|---|---|---:|---:|---:|---:|\n';
 for(const x of rows)md+=`|${x.date}|${x.selected.personality} / ${x.selected.money} / ${x.selected.love}|${x.check.forbidden.length}|${x.check.introJargon}|${x.check.repeatPairs}|${x.check.nearPairs}|\n`;
 md+='\n## 계산별로 달라진 실제 이야기\n';
 for(const x of rows){md+=`\n### ${x.date}\n\n원국(확정된 값): ${Object.entries(x.chart.pillars).map(([k,p])=>`${k}: ${p?.chars || '미확정'}`).join(' / ')}\n`;for(const i of [0,2,3,4]){const b=x.report.sections[i].blocks[0];md+=`\n#### ${x.report.sections[i].title} — ${b.title}\n\n${b.parts.map(p=>p.text).join('\n\n')}\n`;}}
 md+='\n## 편집 검토와 한계\n\n- 자율형은 결정권과 비교 소비, 협력형은 공동 정산과 관계 비용, 탐구형은 학습 지출과 실행 지연, 대응형은 책임 비용과 권한, 관리형은 유지 비용과 경직, 확장형은 매출·현금흐름과 약속의 일관성을 서로 다른 갈등으로 썼습니다. 책임감 이야기를 모든 유형에 넣지 않았습니다.\n- 연애는 월간을 복사하지 않고 일지 본기 기준을 그대로 사용합니다. 같은 관계 선택값이면 그 문단은 재사용되며, 출생 정보가 달라도 모든 문장이 고유해지는 구조는 아닙니다.\n- 일간 강약·용신·합충 등을 추가로 계산한 것은 아닙니다. 현재의 제한된 규칙으로 읽는 경향이며, 실제 행동 기록이나 과학적 성격 진단이 아닙니다.\n- 시각 미상은 시주 미확정. 본문은 시주에 의존하지 않습니다. 계산 근거는 접힌 영역으로 두고 구입이나 과제를 요구하지 않습니다.\n- 기존 저장 보고서를 덮어쓰지 않습니다. 신규 생성부터 v6를 사용합니다.\n';
 fs.writeFileSync('docs/saju/GRANDMOTHER-v6-EXAMPLES.md',md);
 fs.writeFileSync('docs/saju/GRANDMOTHER-v6-METRICS.json',JSON.stringify(rows.map(x=>({date:x.date,selected:x.selected,check:x.check})),null,2));
 console.log(rows.map(x=>({date:x.date,...x.check})));
}
if(require.main===module)run();
module.exports={inspect};
