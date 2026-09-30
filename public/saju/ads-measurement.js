'use strict';
window.SajuAds=(()=>{
 let pixel=null,allowed=false,anonymousId=null;
 const safePage=()=>['/saju','/saju/'].includes(location.pathname)&&!location.hash&&[...new URLSearchParams(location.search).keys()].every(k=>['fbclid','utm_source','utm_medium','utm_campaign','utm_content','utm_term'].includes(k));
 const cookie=k=>document.cookie.split('; ').find(v=>v.startsWith(k+'='))?.slice(k.length+1);
 const send=(name,standard=false,value)=>{
  if(!allowed||!safePage()||!window.fbq)return;
  const fields={content_ids:['saju-basic'],content_type:'product'};
  if(Number.isInteger(value)&&value>0){fields.value=value;fields.currency='KRW';}
  window.fbq(standard?'trackSingle':'trackSingleCustom',pixel,name,fields,{eventID:crypto.randomUUID()});
 };
 const start=()=>{
  if(allowed||!pixel||!safePage())return;
  allowed=true;anonymousId=sessionStorage.getItem('saju-ad-id')||crypto.randomUUID();sessionStorage.setItem('saju-ad-id',anonymousId);
  if(!window.fbq){const f=function(){f.callMethod?f.callMethod.apply(f,arguments):f.queue.push(arguments)};f.queue=[];f.push=f;f.loaded=true;f.version='2.0';window.fbq=f;window._fbq=f;
   const script=document.createElement('script');script.src='https://connect.facebook.net/en_US/fbevents.js';script.async=true;document.head.append(script);
  }
  fbq('consent','grant');fbq('set','autoConfig',false,pixel);fbq('init',pixel,{external_id:anonymousId});send('PageView',true);
 };
 function init(id){
  if(!id||!safePage())return;pixel=id;
  const box=document.createElement('aside');box.className='ad-consent';box.setAttribute('aria-label','광고 성과 측정 선택');
  const description=document.createElement('p');description.textContent='광고가 도움이 되었는지 알아보려 쿠키를 사용해도 되겠니? 동의하면 방문·입력 단계·구매 여부와 금액, 브라우저 정보를 Meta에 보내 광고 성과 측정과 맞춤 광고에 쓴단다. 이름·생년월일·사주 내용은 보내지 않아. 동의하지 않아도 풀이와 구매는 똑같이 할 수 있지.';
  const yes=document.createElement('button'),no=document.createElement('button');yes.type=no.type='button';yes.textContent='선택 동의';no.textContent='동의하지 않음';
  yes.onclick=()=>{sessionStorage.setItem('saju-ad-consent','yes');start();box.hidden=true;};
  no.onclick=()=>{sessionStorage.setItem('saju-ad-consent','no');box.hidden=true;};
  box.append(description,yes,no);document.querySelector('main').append(box);
  const choice=sessionStorage.getItem('saju-ad-consent');if(choice){box.hidden=true;if(choice==='yes')start();}
  const settings=document.createElement('button');settings.type='button';settings.className='text-button';settings.textContent='광고 측정 선택 변경';settings.onclick=()=>{
   allowed=false;
   const reportId=sessionStorage.getItem('saju-current');
   if(reportId)fetch('/api/saju/reports/'+encodeURIComponent(reportId)+'/ad-consent',{method:'DELETE',headers:{'X-Saju-Request':'1'}}).catch(()=>{});
   if(window.fbq)fbq('consent','revoke');
   sessionStorage.removeItem('saju-ad-consent');sessionStorage.removeItem('saju-ad-id');
   for(const k of ['_fbp','_fbc'])document.cookie=k+'=; Max-Age=0; Path=/; SameSite=Lax';
   box.hidden=false;box.scrollIntoView({block:'center'});
  };document.querySelector('main').append(settings);
 }
 return {init,event:send,context:()=>allowed?{consent:true,anonymousId,fbp:cookie('_fbp'),fbc:cookie('_fbc')}:null};
})();
