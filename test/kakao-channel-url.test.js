const test = require('node:test');
const assert = require('node:assert/strict');
const {newDb} = require('pg-mem');
const {migrate} = require('../src/deal-store');
const {createAdminStore} = require('../src/admin/admin-store');
const {normalizeKakaoChannelUrl: normalize} = require('../src/kakao-channel-url');
test('channel home, chat and share URLs normalize to canonical chat link', () => {
 for (const url of ['https://pf.kakao.com/_abc123',' https://pf.kakao.com/_abc123/chat ','https://pf.kakao.com/_abc123/','http://pf.kakao.com/_abc123/friend?from=qr','pf.kakao.com/_abc123?foo=bar']) assert.equal(normalize(url),'https://pf.kakao.com/_abc123/chat');
 assert.equal(normalize(' '),'');
 for (const url of ['https://open.kakao.com/o/group','https://evil.example/_abc','https://pf.kakao.com.evil.example/_abc','https://user@pf.kakao.com/_abc','javascript:alert(1)','https://pf.kakao.com/_abc/posts/123']) assert.throws(()=>normalize(url),TypeError);
});
test('both settings write paths persist normalized URL and allow removal',async()=>{
 const {Pool}=newDb().adapters.createPg();const pool=new Pool();await migrate(pool);const store=createAdminStore(pool);
 await store.setSettings({phone_consultation_url:'https://pf.kakao.com/_abc123'});
 assert.equal((await store.getPublicSettings()).phone_consultation_url,'https://pf.kakao.com/_abc123/chat');
 await store.setSetting('phone_consultation_url','pf.kakao.com/_xyz');
 assert.equal((await store.getPublicSettings()).phone_consultation_url,'https://pf.kakao.com/_xyz/chat');
 await assert.rejects(store.setSettings({phone_consultation_url:'https://open.kakao.com/o/group'}),/오픈채팅방/);
 await store.setSetting('phone_consultation_url','');assert.equal((await store.getPublicSettings()).phone_consultation_url,'');await pool.end();
});
