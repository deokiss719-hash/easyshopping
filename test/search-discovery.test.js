const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {createSajuRouter}=require('../src/saju/routes');
const {sitemapXml}=require('../src/seo-pages');
test('only clean saju landing is indexable; private, payment and query URLs stay excluded',async t=>{
 const app=express();app.use(createSajuRouter({store:{},env:{}}).router);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 for(const path of ['/saju','/saju/','/saju?report=example','/saju/success','/saju/fail','/saju/recover','/saju/admin']){
 const r=await fetch(`http://127.0.0.1:${server.address().port}${path}`);
 assert.equal(r.headers.get('x-robots-tag'),['/saju','/saju/'].includes(path)?'index, follow':'noindex, nofollow',path);
 }
});
test('sitemap discovers public services without invented last-modified dates or private paths',()=>{
 const xml=sitemapXml([]);
 for(const path of ['/phone.html','/saju','/community'])assert.ok(xml.includes(`https://easyshoopping.com${path}</loc>`));
 assert.doesNotMatch(xml,/recover|success|admin|report=/);
 for (const entry of xml.matchAll(/<url>(.*?)<\/url>/g)) {
   if (!entry[1].includes('/guides/')) assert.doesNotMatch(entry[1], /<lastmod>/);
 }
});
