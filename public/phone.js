(() => {
 const form=document.querySelector('#phone-form'), method=document.querySelector('#phone-method'), result=document.querySelector('#phone-result'); let kakao='';
 form.elements.model.value=(new URLSearchParams(location.search).get('model')||'').slice(0,300);
 const node=(tag,text,cls)=>{const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;};
 method.addEventListener('change',()=>{for(const id of ['phone-contact','phone-time']){const label=document.getElementById(id);label.hidden=method.value==='kakao';label.querySelector('input').required=method.value==='phone';}});
 async function load(){
  const grid=document.querySelector('#phone-offers');
  try{const r=await fetch('/api/live-deals?source=manual&page=1&size=20');if(!r.ok)throw Error();const data=await r.json();grid.replaceChildren();
   for(const d of data.deals||[]){const card=node('article','','phone-offer'); if(d.imageUrl){const img=document.createElement('img');img.src=d.imageUrl;img.alt='';img.loading='lazy';card.append(img);}card.append(node('h2',d.title),node('p',d.price==null?'가격 상담':Number(d.price).toLocaleString('ko-KR')+'원','phone-price'),node('p',d.description||'요금제·유지 기간·부가서비스 등 적용 조건은 상담에서 확인해 주세요.'));const b=node('button','이 상품으로 상담 신청');b.type='button';b.onclick=()=>{form.elements.model.value=d.title;document.querySelector('#consult').scrollIntoView({behavior:'smooth'});form.elements.carrier.focus();};card.append(b);grid.append(card);}
   if(!grid.children.length)grid.append(node('p','등록된 특가를 준비 중이에요. 원하는 기종으로 먼저 상담을 신청할 수 있어요.'));
  }catch{grid.textContent='특가를 불러오지 못했어요. 아래에서 원하는 기종으로 상담을 신청할 수 있어요.';}
  try{const r=await fetch('/api/site-settings');if(!r.ok)return;const data=await r.json();const value=(data.settings||data).phone_consultation_url;if(/^https:\/\/pf\.kakao\.com\/_[A-Za-z0-9]+\/chat$/.test(value)){kakao=value;const option=document.querySelector('#kakao-option');option.disabled=false;option.hidden=false;}}catch{}
 }
 form.addEventListener('submit',async e=>{e.preventDefault();if(!form.reportValidity())return;const b=document.querySelector('#phone-submit');b.disabled=true;result.textContent='접수하고 있어요.';const body=Object.fromEntries(new FormData(form));body.privacyConsent=form.elements.privacyConsent.checked;
  try{const r=await fetch('/api/phone-inquiries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.message||'접수하지 못했어요. 잠시 후 다시 시도해 주세요.');form.hidden=true;result.replaceChildren(node('h3','상담 신청이 접수됐어요'),node('p','견적번호: '+data.id));
   if(body.method==='kakao'&&kakao){result.append(node('p','아래에서 견적번호를 복사하고 카카오채널 채팅방에 직접 보내주세요. 메시지를 보내야 카카오 상담을 시작할 수 있어요.'));const copy=node('button','견적번호 복사');copy.type='button';copy.onclick=async()=>{try{await navigator.clipboard.writeText(data.id);copy.textContent='복사했어요';}catch{copy.textContent='위 견적번호를 선택해 복사해 주세요';}};const link=node('a','카카오채널에서 상담 시작','phone-action');link.href=kakao;link.target='_blank';link.rel='noopener noreferrer';result.append(copy,link);}else result.append(node('p','남겨주신 통화 가능 시간을 확인해 연락드릴게요.'));
  }catch(err){result.textContent=err.message;}finally{b.disabled=false;}
 });load();
})();