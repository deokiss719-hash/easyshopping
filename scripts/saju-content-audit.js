'use strict';
const fs=require('node:fs');
const {calculate}=require('../src/saju/calculator');
const {generate,selectors}=require('../src/saju/report');
const old=require('../src/saju/report-v3');
const terms=/일간|월간|월주|월지|일지|시주|지장간|십성|비견|겁재|식신|상관|편재|정재|편관|정관|편인|정인|경금|병화|갑목|을목|정화|무토|기토|신금|임수|계수/g;
const sentences=t=>t.split(/(?<=[.!?])\s+/u).map(s=>s.trim()).filter(s=>s.length>16);
function grams(s){s=s.replace(/\s|[.,!?·'"()]/g,'');return new Set(Array.from({length:Math.max(0,s.length-2)},(_,i)=>s.slice(i,i+3)));}
function similarity(a,b){const x=grams(a),y=grams(b);const same=[...x].filter(v=>y.has(v)).length;return same/(x.size+y.size-same || 1);}
function metrics(report){
 const blocks=report.sections.flatMap((s,i)=>s.blocks.map(b=>({...b,chapter:i})));
 const rows=blocks.flatMap(b=>sentences(b.text).map(text=>({text,chapter:b.chapter,id:b.id})));
 const repeated=[],near=[];
 for(let i=0;i<rows.length;i++) for(let j=i+1;j<rows.length;j++) if(rows[i].chapter!==rows[j].chapter){
  const a=rows[i],b=rows[j];
  if(a.text===b.text)repeated.push([a.id,b.id,a.text]);
  else if(similarity(a.text,b.text)>=0.68)near.push([a.id,b.id,a.text,b.text]);
 }
 return {openingTerms:(report.preview[0].text.match(terms)||[]).length,openingCharacters:report.preview[0].text.length,repeatPairs:repeated.length,nearPairs:near.length,repeated,near};
}
const dates=Array.from({length:10},(_,i)=>`1990-01-${String(i+1).padStart(2,'0')}`).concat(['1988-08-15','1990-03-02']);
function run(){
 const examples=dates.map(date=>{
  const input={date,calendar:'solar',timeType:'unknown',zone:'Asia/Seoul'};
  const chart=calculate(input),before=old.generate(chart),after=generate(chart);
  return {date,selected:selectors(chart),before,after,metricsBefore:metrics(before),metricsAfter:metrics(after)};
 });
 const esc=s=>s.replace(/\|/g,'／').replace(/\n/g,' ');
 let md='# 사주 무료 베타 v4 — 수정 전후 검증\n\n가상 입력, 양력·대한민국·출생시각 모름. 실제 고객 정보를 사용하지 않았습니다.\n\n';
 md+='## 운영 화면 점검\n\n2026-09-29 운영 브라우저에서 1990-01-01 결과를 생성했습니다. 첫 풀이에 일간·병화·월주·비견이 등장했고, 원국 상자가 본문 앞에 있었습니다. 무료 본문 뒤 6,900원·모의 승인·복구 저장 안내가 노출됐습니다. 금전과 직업은 한 장에 혼합돼 있었고, 업무 조언이 강점·재물·실행 계획·시기에서 반복됐습니다. 모든 문장이 질문으로 끝나는 것은 아니지만, 계산 설명과 “돌아보거라”류 요청이 구체적 판단을 대신하는 비중이 컸습니다.\n\n';
 md+='## 수치 비교\n\n전문 용어: 지정한 사주 용어의 첫 소개 본문 등장 횟수. 반복: 전체 장 본문을 문장 단위로 나누어 다른 장 사이의 동일 문장 쌍을 셉니다. 유사: 공백·문장부호 제거 후 문자 3-gram Jaccard ≥ 0.68. 의미 중복을 완벽히 판별하는 AI 지표가 아니라 편집 검토용 탐지기입니다.\n\n|가상 생일|첫 소개 용어 전→후|장 간 동일 문장 쌍 전→후|유사 문장 쌍 전→후|성격 / 돈 / 관계 선택|\n|---|---:|---:|---:|---|\n';
 for(const x of examples)md+=`|${x.date}|${x.metricsBefore.openingTerms} → ${x.metricsAfter.openingTerms}|${x.metricsBefore.repeatPairs} → ${x.metricsAfter.repeatPairs}|${x.metricsBefore.nearPairs} → ${x.metricsAfter.nearPairs}|${x.selected.personality} / ${x.selected.money} / ${x.selected.love}|\n`;
 md+='\n## 같은 입력의 문단 나란히 비교\n\n';
 for(const x of [examples[0],examples[3],examples[7]]){
 md+=`### ${x.date}\n\n|항목|이전 v3|변경 v4|\n|---|---|---|\n`;
 const before=[x.before.preview[0],x.before.sections[2].blocks[1],x.before.sections[4].blocks[1],x.before.sections[4].blocks[0],x.before.sections[3].blocks[0]];
 for(let i=0;i<5;i++)md+=`|${['첫 화면·성격','장단점','금전운','직업운','애정운'][i]}|${esc(before[i].text)}|${esc(x.after.sections[i].blocks[0].text)}|\n`;
 }
 md+='\n## 제목에 답하는지 확인\n\n- 성격: 판단·구체 장면·갈림 조건을 4문장으로 제시합니다.\n- 장단점: 성향의 이점과 비용이 생기는 조건을 나란히 표시합니다.\n- 금전: 수익 활동, 지출·확장 위험, 손익 판단 기준을 다룹니다. 수입액·투자 성과를 예언하지 않습니다.\n- 직업: 역할·권한·평가·조직 조건을 다룹니다. 직종을 운명처럼 지정하지 않습니다.\n- 애정: 표현 방식·갈등·관계 조건을 다룹니다. 상대 마음이나 결혼 시기를 단정하지 않습니다.\n- 시기: 동일 주제의 나이·연도를 묶어 반복 설명을 줄였습니다. 순행·역행을 확정하지 않습니다.\n\n## 한계\n\n고정된 십성별 편집 문구를 계산값으로 선택합니다. 같은 선택값을 가진 사람은 해당 문단이 같을 수 있습니다. 신강·신약·용신·합충을 종합한 감정은 아니며 과학적 성격 진단도 아닙니다. 유사도 탐지는 의미가 같은 모든 문장을 찾지 못하므로 대표 문단을 함께 검토해야 합니다. 기존 저장 결과는 수정하지 않고 새 분석부터 v4를 적용합니다.\n';
 fs.writeFileSync('docs/saju/BETA-v4-COMPARISON.md',md);
 fs.writeFileSync('docs/saju/BETA-v4-METRICS.json',JSON.stringify(examples.map(({date,selected,metricsBefore,metricsAfter})=>({date,selected,before:metricsBefore,after:metricsAfter})),null,2));
 console.log(examples.map(x=>({date:x.date,before:[x.metricsBefore.openingTerms,x.metricsBefore.repeatPairs,x.metricsBefore.nearPairs],after:[x.metricsAfter.openingTerms,x.metricsAfter.repeatPairs,x.metricsAfter.nearPairs]})));
 return examples;
}
if(require.main===module)run();
module.exports={metrics,similarity};
