'use strict';
// Facts first; no random output, learned weights, automatic 합화 or invented hour.
const {god,pillar:makePillar}=require('./calculator');
const VERSION='whole-chart-rules-1';
const STEMS='甲乙丙丁戊己庚辛壬癸',ELEMENTS=['목','화','토','금','수'];
const FAMILY={비견:'peer',겁재:'peer',식신:'output',상관:'output',편재:'wealth',정재:'wealth',편관:'authority',정관:'authority',편인:'resource',정인:'resource'};
const KEYS=['year','month','day','hour'];
const CLASH=['子午','丑未','寅申','卯酉','辰戌','巳亥'];
const UNION=['子丑','寅亥','卯戌','辰酉','巳申','午未'];
const STEM_UNION=['甲己','乙庚','丙辛','丁壬','戊癸'];
const TRIPLES=[['申子辰','수'],['亥卯未','목'],['寅午戌','화'],['巳酉丑','금']];
const SOURCE={
 month:'https://donglishuzhai.net/chapter/3721.html',
 roots:'https://donglishuzhai.net/chapter/3719.html',
 interaction:'https://donglishuzhai.net/chapter/3722.html',
 mixedMonth:'https://www.donglishuzhai.net/chapter/3729.html',
 climate:'https://donglishuzhai.net/chapter/3727.html',
 stemUnion:'https://donglishuzhai.net/chapter/3718.html',
 branch:'https://zh.wikisource.org/zh-hant/三命通會/卷二',
};
const element=s=>ELEMENTS[Math.floor(STEMS.indexOf(s)/2)];
const matches=(pairs,a,b)=>pairs.some(pair=>pair.includes(a)&&pair.includes(b)&&a!==b);
function connections(entries){
 const result=[];
 for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){
  const a=entries[i],b=entries[j];
  const paths=[a.path,b.path];
  if(matches(CLASH,a.p.branch,b.p.branch))result.push({kind:'clash',positions:[a.key,b.key],paths,chars:a.p.branch+b.p.branch});
  if(matches(UNION,a.p.branch,b.p.branch))result.push({kind:'union',positions:[a.key,b.key],paths,chars:a.p.branch+b.p.branch});
  if(matches(STEM_UNION,a.p.stem,b.p.stem))result.push({kind:'stemUnion',positions:[a.key,b.key],paths,chars:a.p.stem+b.p.stem});
 }
 return result;
}
function analyzeCore(chart){
 const entries=KEYS.filter(k=>chart.pillars[k]).map(key=>({key,path:`pillars.${key}`,p:chart.pillars[key]}));
 const day=chart.pillars.day,month=chart.pillars.month;
 const hidden=entries.flatMap(({key,path,p})=>p.hiddenStems.map((h,index)=>({...h,element:element(h.stem),position:key,main:index===0,path:`${path}.hiddenStems.${index}`})));
 const visible=entries.filter(e=>e.key!=='day').map(({key,path,p})=>({stem:p.stem,tenGod:god(day.stem,p.stem),position:key,path:`${path}.stem`}));
 const rootPositions=entries.filter(({p})=>p.hiddenStems.some(h=>element(h.stem)===day.elementStem)).map(e=>e.key);
 const mainRootPositions=entries.filter(({p})=>element(p.hiddenStems[0].stem)===day.elementStem).map(e=>e.key);
 const exposures=hidden.filter(h=>visible.some(v=>v.stem===h.stem)).map(h=>({hiddenPath:h.path,visiblePaths:visible.filter(v=>v.stem===h.stem).map(v=>v.path),stem:h.stem,tenGod:h.tenGod,position:h.position,main:h.main}));
 const monthHidden=hidden.filter(h=>h.position==='month');
 const exposedMonth=monthHidden.filter(h=>visible.some(v=>v.stem===h.stem));
 // 月令藏干 + 透出; prefer main qi when it is exposed, otherwise first exposed stored stem.
 // Multiple exposed candidates are retained, not declared a definitive 格局/用神.
 const focus=month ? (exposedMonth.find(h=>h.main)||exposedMonth[0]||monthHidden[0]) : null;
 const groups=Object.fromEntries(['peer','output','wealth','authority','resource'].map(f=>[f,{
  visible:visible.filter(v=>FAMILY[v.tenGod]===f),
  hidden:hidden.filter(h=>FAMILY[h.tenGod]===f),
 }]));
 for(const [f,g] of Object.entries(groups))g.active=g.visible.length>0||monthHidden.some(h=>h.main&&FAMILY[h.tenGod]===f);
 const seasonalFamily=monthHidden.length?FAMILY[monthHidden[0].tenGod]:null;
 const seasonalSupport=seasonalFamily===null?null:['peer','resource'].includes(seasonalFamily);
 const supportVisible=groups.peer.visible.length+groups.resource.visible.length;
 const demandVisible=groups.output.visible.length+groups.wealth.visible.length+groups.authority.visible.length;
 // Conservative branch classification, not a numerical 身强弱 score or health/ability assessment.
 let support='mixed';
 if(!month)support='unknown';
 else if(seasonalSupport&&mainRootPositions.length>0&&supportVisible>=1)support='supported';
 else if(!seasonalSupport&&rootPositions.length===0&&supportVisible===0&&demandVisible>0)support='limited';
 const relations=connections(entries);
 const tripleCandidates=TRIPLES.filter(([chars])=>[...chars].every(c=>entries.some(e=>e.p.branch===c)))
  .map(([chars,to])=>({chars,element:to,paths:entries.filter(e=>chars.includes(e.p.branch)).map(e=>e.path),transformed:false}));
 const relationWithDay=relations.filter(r=>r.positions.includes('day')&&r.kind!=='stemUnion');
 const pattern=[];
 const pair=(a,b,id)=>{if(groups[a].active&&groups[b].active)pattern.push({id,families:[a,b],status:'co-presence-only',paths:[...groups[a].visible,...groups[b].visible,...monthHidden.filter(h=>h.main&&[a,b].includes(FAMILY[h.tenGod]))].map(x=>x.path)});};
 pair('output','wealth','making-to-money');pair('peer','wealth','sharing-money');
 pair('authority','resource','rules-and-learning');pair('output','authority','change-and-rules');
 pair('resource','output','learning-and-making');
 const climate=month?({亥:'cold',子:'cold',丑:'cold',巳:'hot',午:'hot',未:'hot'}[month.branch]||'transitional'):'unknown';
 return {version:VERSION,sources:SOURCE,focus:focus?{god:focus.tenGod,path:focus.path,exposed:exposedMonth.some(h=>h.path===focus.path)}:null,
  monthCandidates:exposedMonth.map(h=>({god:h.tenGod,path:h.path})),mixedMonth:!!month&&'辰戌丑未'.includes(month.branch),
  roots:{positions:rootPositions,mainPositions:mainRootPositions},visible,hidden,exposures,groups,
  support:{status:support,seasonalFamily,seasonalSupport,supportVisible,demandVisible,definitiveStrength:false},
  climate:{season:climate,firePresent:hidden.some(h=>h.element==='화')||visible.some(v=>element(v.stem)==='화'),waterPresent:hidden.some(h=>h.element==='수')||visible.some(v=>element(v.stem)==='수'),yongshin:null},
  relations,relationWithDay,tripleCandidates,patterns:pattern,
  certainty:{knownPositions:entries.map(e=>e.key),missingPositions:KEYS.filter(k=>!chart.pillars[k]),hourUsed:!!chart.pillars.hour,monthKnown:!!month},
  limits:['구조의 존재와 해석의 적합성은 다르다','강약·격국·용신·합화 최종 확정 아님','형·파·해·신살 및 조후용신 미판정','대운 방향은 두 가정, 동시에 적용하지 않음']};
}
function analyze(chart) {
 const a=analyzeCore(chart);
 a.sensitivity={hourAlternatives:0,focusMayChange:false,supportMayChange:false,patternsMayChange:false};
 if(!chart.pillars.hour && chart.pillars.month && chart.variants?.hour?.length) {
  const alternatives=chart.variants.hour.map(chars=>analyzeCore({...chart,pillars:{...chart.pillars,hour:makePillar(chars,chart.pillars.day.stem)}}));
  a.sensitivity={hourAlternatives:alternatives.length,
   focusMayChange:alternatives.some(x=>x.focus?.god!==a.focus?.god),
   supportMayChange:alternatives.some(x=>x.support.status!==a.support.status),
   patternsMayChange:alternatives.some(x=>JSON.stringify(x.patterns.map(p=>p.id))!==JSON.stringify(a.patterns.map(p=>p.id)))};
  if(a.sensitivity.supportMayChange) a.support.status='uncertain';
 }
 return a;
}
function comparePeriod(chart,pillar,path){
 const entries=KEYS.filter(k=>chart.pillars[k]).map(key=>({key,path:`pillars.${key}`,p:chart.pillars[key]}));
 const joined=connections([...entries,{key:'period',path,p:pillar}]).filter(r=>r.positions.includes('period'));
 return {path,stemGod:god(chart.pillars.day.stem,pillar.stem),branchGod:god(chart.pillars.day.stem,pillar.hiddenStems[0].stem),
  family:FAMILY[god(chart.pillars.day.stem,pillar.stem)],relations:joined,
  repeats:entries.filter(e=>e.p.chars===pillar.chars).map(e=>e.key),
  repeatsBranch:entries.filter(e=>e.p.branch===pillar.branch).map(e=>e.key),
  natalRootAdded:pillar.hiddenStems.some(h=>element(h.stem)===chart.pillars.day.elementStem)};
}
module.exports={analyze,comparePeriod,connections,FAMILY,SOURCE,VERSION,element};
