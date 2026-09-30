'use strict';
const {createHash}=require('node:crypto');
function metaConfig(env=process.env){
 const pixelId=env.SAJU_META_PIXEL_ID||'',accessToken=env.SAJU_META_ACCESS_TOKEN||'',version=env.SAJU_META_API_VERSION||'';
 return {pixelId,accessToken,version,enabled:env.SAJU_META_ENABLED==='true'&&/^\d{5,25}$/.test(pixelId)};
}
function context(input,ua){
 if(input?.consent!==true||!/^[-\w]{20,80}$/.test(input.anonymousId||''))return null;
 const data={external_id:[createHash('sha256').update(input.anonymousId).digest('hex')],client_user_agent:String(ua||'').slice(0,500)};
 for(const k of ['fbp','fbc'])if(/^fb\.\d\.\d{10,16}\.[\w.-]{1,250}$/.test(input[k]||''))data[k]=input[k];
 return data;
}
function purchase(order){return {event_name:'Purchase',event_id:'saju-purchase-'+order.id,event_time:Math.floor(new Date(order.paid_at).getTime()/1000),action_source:'website',event_source_url:'https://easyshoopping.com/saju',user_data:typeof order.meta_context==='string'?JSON.parse(order.meta_context):order.meta_context,custom_data:{value:order.amount,currency:'KRW',content_ids:['saju-basic'],content_type:'product'}};}
async function enqueue(db,order){
 if(order.mode!=='live'||!order.meta_context)return;
 const event=purchase(order);
 await db.query('INSERT INTO saju_meta_outbox(event_id,payload) VALUES($1,$2) ON CONFLICT(event_id) DO NOTHING',[event.event_id,JSON.stringify(event)]);
}
async function drain(pool,cfg,fetcher=fetch){
 if(!cfg.enabled||!cfg.accessToken||!/^v\d+\.\d+$/.test(cfg.version))return {disabled:true};
 const db=await pool.connect();let sent=0,failed=0;
 try{
 await db.query('BEGIN');
 const rows=(await db.query("SELECT * FROM saju_meta_outbox WHERE sent_at IS NULL AND attempts<8 AND next_attempt_at<=NOW() AND created_at>NOW()-INTERVAL '6 days' ORDER BY created_at LIMIT 5 FOR UPDATE SKIP LOCKED")).rows;
 for(const row of rows){
 try{
 const payload=typeof row.payload==='string'?JSON.parse(row.payload):row.payload;
 const response=await fetcher(`https://graph.facebook.com/${cfg.version}/${cfg.pixelId}/events`,{method:'POST',headers:{Authorization:`Bearer ${cfg.accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({data:[payload]}),signal:AbortSignal.timeout(8000)});
 const result=await response.json();
 if(!response.ok||result.events_received!==1)throw Error('meta_rejected');
 await db.query('UPDATE saju_meta_outbox SET sent_at=NOW(),attempts=attempts+1,payload=NULL WHERE event_id=$1',[row.event_id]);sent++;
 }catch{
 await db.query("UPDATE saju_meta_outbox SET attempts=attempts+1,next_attempt_at=NOW()+INTERVAL '15 minutes' WHERE event_id=$1",[row.event_id]);failed++;
 }
 }
 await db.query("DELETE FROM saju_meta_outbox WHERE created_at<NOW()-INTERVAL '30 days'");
 await db.query("UPDATE saju_orders SET meta_context=NULL WHERE meta_context IS NOT NULL AND created_at<NOW()-INTERVAL '7 days'");
 await db.query('COMMIT');return {sent,failed};
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
async function testEvent(cfg,testCode,value,fetcher=fetch){
 if(!cfg.accessToken||!/^v\d+\.\d+$/.test(cfg.version)||!/^TEST\d{3,20}$/.test(testCode)||!Number.isInteger(value)||value<100)throw new TypeError('Meta 테스트 코드와 서버 연결 설정을 확인해 주세요.');
 const id='saju-test-'+require('node:crypto').randomUUID();
 const data={event_name:'Purchase',event_id:id,event_time:Math.floor(Date.now()/1000),action_source:'website',event_source_url:'https://easyshoopping.com/saju',user_data:{external_id:[createHash('sha256').update(id).digest('hex')],client_user_agent:'Saju conversion test'},custom_data:{value,currency:'KRW',content_ids:['saju-basic'],content_type:'product'}};
 const r=await fetcher(`https://graph.facebook.com/${cfg.version}/${cfg.pixelId}/events`,{method:'POST',headers:{Authorization:`Bearer ${cfg.accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({data:[data],test_event_code:testCode}),signal:AbortSignal.timeout(12000)});
 const result=await r.json();if(!r.ok||result.events_received!==1)throw new TypeError('Meta가 테스트 이벤트를 수락하지 않았어요. 토큰·API 버전·테스트 코드를 확인해 주세요.');
 return {testOnly:true,eventId:id,received:result.events_received,value,currency:'KRW'};
}
module.exports={metaConfig,context,purchase,enqueue,drain,testEvent};
