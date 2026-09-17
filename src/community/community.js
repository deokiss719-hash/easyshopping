const express = require('express');
const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const bcrypt = require('bcryptjs');

const COOKIE = 'ehd_anon';
const PHONE_PATTERN = /(?:01[016789])[- .]?\d{3,4}[- .]?\d{4}/;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const URL_PATTERN = /https?:\/\//gi;
const rateBuckets = new Map();

function safeText(value, max, fallback = '') {
  const text = String(value ?? '').replace(/\u0000/g, '').trim();
  if (!text && fallback) return fallback;
  if (!text || text.length > max) throw new TypeError(`1~${max}자로 입력해 주세요.`);
  return text;
}

function parseCookies(header = '') {
  return String(header).split(';').map((part) => part.trim()).filter(Boolean).reduce((out, part) => {
    const index = part.indexOf('=');
    if (index > 0) out[part.slice(0, index)] = decodeURIComponent(part.slice(index + 1));
    return out;
  }, {});
}

function hmac(secret, value) {
  return createHmac('sha256', secret).update(String(value)).digest('hex');
}

function anonymousIdentity(req, res, secret, production = false) {
  const cookies = parseCookies(req.headers.cookie);
  let token = cookies[COOKIE];
  if (!/^[A-Za-z0-9_-]{32,80}$/.test(token || '')) {
    token = randomBytes(32).toString('base64url');
    res.append('Set-Cookie', `${COOKIE}=${token}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${production ? '; Secure' : ''}`);
  }
  return hmac(secret, token);
}

function sameOrigin(req) {
  const origin = req.get('origin');
  if (!origin) return true;
  try { return new URL(origin).host === req.get('host'); } catch { return false; }
}

function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const current = rateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

function postRow(row, viewerHash) {
  if (!row) return null;
  return {
    id: String(row.id), categoryId: String(row.category_id), categorySlug: row.category_slug, categoryName: row.category_name,
    title: row.title, body: row.body, nickname: row.nickname, answerRequested: row.answer_requested,
    answered: Boolean(row.answered_at), views: Number(row.views || 0), upvotes: Number(row.upvotes || 0),
    downvotes: Number(row.downvotes || 0), commentCount: Number(row.comment_count || 0),
    createdAt: row.created_at, updatedAt: row.updated_at, isAuthor: Boolean(viewerHash && row.author_hash === viewerHash),
  };
}

function commentRow(row, postAuthorHash, viewerHash) {
  return {
    id: String(row.id), postId: String(row.post_id), parentCommentId: row.parent_comment_id ? String(row.parent_comment_id) : null,
    body: row.is_deleted ? '삭제된 댓글입니다.' : row.body,
    nickname: row.is_admin ? '이지핫딜 관리자' : row.nickname,
    isAdmin: row.is_admin, isPostAuthor: !row.is_admin && row.author_hash === postAuthorHash,
    isAuthor: Boolean(viewerHash && row.author_hash === viewerHash), upvotes: Number(row.upvotes || 0),
    downvotes: Number(row.downvotes || 0), deleted: row.is_deleted, createdAt: row.created_at,
  };
}

function createCommunityStore(pool) {
  async function banned(text) {
    const { rows } = await pool.query('SELECT word FROM community_banned_words WHERE is_active=TRUE');
    const lower = text.toLowerCase();
    return rows.find((row) => lower.includes(String(row.word).toLowerCase()))?.word || null;
  }
  async function blocked(authorHash) {
    const { rowCount } = await pool.query('SELECT 1 FROM community_blocks WHERE author_hash=$1 AND (expires_at IS NULL OR expires_at>$2)', [authorHash, new Date()]);
    return rowCount > 0;
  }
  async function categories({ all = false } = {}) {
    const { rows } = await pool.query(`SELECT * FROM community_categories ${all ? '' : 'WHERE is_active=TRUE'} ORDER BY sort_order,name`);
    return rows.map((r) => ({ id: String(r.id), slug: r.slug, name: r.name, sortOrder: r.sort_order, active: r.is_active }));
  }
  async function listPosts({ category, q, scope = 'title', sort = 'latest', page = 1, size = 30, answer } = {}, viewerHash) {
    const params = [];
    const where = ['p.is_hidden=FALSE', 'p.is_deleted=FALSE', 'c.is_active=TRUE'];
    if (category && category !== 'all') { params.push(category); where.push(`c.slug=$${params.length}`); }
    if (q) {
      params.push(`%${String(q).trim().slice(0,100)}%`);
      where.push(scope === 'all' ? `(p.title ILIKE $${params.length} OR p.body ILIKE $${params.length})` : `p.title ILIKE $${params.length}`);
    }
    if (answer === 'unanswered') where.push('p.answer_requested=TRUE AND p.answered_at IS NULL');
    if (answer === 'answered') where.push('p.answer_requested=TRUE AND p.answered_at IS NOT NULL');
    const safeSize = Math.max(1, Math.min(50, Number(size) || 30));
    const safePage = Math.max(1, Number(page) || 1);
    const countParams = [...params];
    const count = await pool.query(`SELECT COUNT(*) total FROM community_posts p JOIN community_categories c ON c.id=p.category_id WHERE ${where.join(' AND ')}`, countParams);
    params.push(safeSize, (safePage - 1) * safeSize);
    const ranking = '(p.upvotes*8-p.downvotes*5+p.comment_count*4+p.views/8)';
    const order = sort === 'popular' ? `${ranking} DESC,p.created_at DESC` : 'p.created_at DESC,p.id DESC';
    const sql = `SELECT p.*,c.slug category_slug,c.name category_name FROM community_posts p JOIN community_categories c ON c.id=p.category_id WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT $${params.length-1} OFFSET $${params.length}`;
    const { rows } = await pool.query(sql, params);
    return { posts: rows.map((r) => postRow(r, viewerHash)), total: Number(count.rows[0]?.total || 0), page: safePage, size: safeSize };
  }
  async function getPost(id, viewerHash, countView = false) {
    if (countView && viewerHash) {
      const inserted = await pool.query('INSERT INTO community_post_views(post_id,viewer_hash) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING post_id', [id, viewerHash]);
      if (inserted.rowCount) await pool.query('UPDATE community_posts SET views=views+1 WHERE id=$1', [id]);
    }
    const { rows } = await pool.query(`SELECT p.*,c.slug category_slug,c.name category_name FROM community_posts p JOIN community_categories c ON c.id=p.category_id WHERE p.id=$1 AND p.is_hidden=FALSE AND p.is_deleted=FALSE`, [id]);
    if (!rows[0]) return null;
    const comments = await pool.query('SELECT * FROM community_comments WHERE post_id=$1 AND is_hidden=FALSE ORDER BY created_at,id', [id]);
    return { post: postRow(rows[0], viewerHash), comments: comments.rows.map((r) => commentRow(r, rows[0].author_hash, viewerHash)) };
  }
  async function createPost(input, authorHash) {
    if (await blocked(authorHash)) throw Object.assign(new Error('blocked'), { status: 403 });
    const title = safeText(input.title, 160); const body = safeText(input.body, 10000); const nickname = safeText(input.nickname || 'ㅇㅇ', 24, 'ㅇㅇ');
    if ((await banned(`${title} ${body} ${nickname}`))) throw new TypeError('사용할 수 없는 표현이 포함되어 있어요.');
    if ((`${title} ${body}`.match(URL_PATTERN) || []).length > 3) throw new TypeError('링크는 최대 3개까지 등록할 수 있어요.');
    if ((PHONE_PATTERN.test(`${title} ${body}`) || EMAIL_PATTERN.test(`${title} ${body}`)) && input.confirmPrivacy !== true) throw Object.assign(new Error('privacy_warning'), { status: 409, code: 'privacy_warning' });
    const category = await pool.query('SELECT id FROM community_categories WHERE id=$1 AND is_active=TRUE', [input.categoryId]);
    if (!category.rows[0]) throw new TypeError('카테고리를 확인해 주세요.');
    const passwordHash = input.password ? await bcrypt.hash(safeText(input.password, 32), 10) : null;
    const { rows } = await pool.query(`INSERT INTO community_posts(category_id,title,body,nickname,author_hash,edit_password_hash,answer_requested) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [input.categoryId,title,body,nickname,authorHash,passwordHash,input.answerRequested === true]);
    return getPost(rows[0].id, authorHash, false);
  }
  async function canEdit(row, authorHash, password) {
    if (row.author_hash === authorHash) return true;
    return Boolean(password && row.edit_password_hash && await bcrypt.compare(String(password), row.edit_password_hash));
  }
  async function updatePost(id, input, authorHash) {
    const found = await pool.query('SELECT * FROM community_posts WHERE id=$1 AND is_deleted=FALSE', [id]); const row = found.rows[0];
    if (!row) return null; if (!(await canEdit(row, authorHash, input.password))) throw Object.assign(new Error('forbidden'), { status: 403 });
    const title = safeText(input.title ?? row.title,160); const body = safeText(input.body ?? row.body,10000); const nickname = safeText(input.nickname ?? row.nickname,24);
    if (await banned(`${title} ${body} ${nickname}`)) throw new TypeError('사용할 수 없는 표현이 포함되어 있어요.');
    await pool.query('UPDATE community_posts SET title=$1,body=$2,nickname=$3,updated_at=CURRENT_TIMESTAMP WHERE id=$4',[title,body,nickname,id]);
    return getPost(id, authorHash, false);
  }
  async function deletePost(id, authorHash, password) {
    const found = await pool.query('SELECT * FROM community_posts WHERE id=$1 AND is_deleted=FALSE',[id]); const row=found.rows[0];
    if (!row) return false; if (!(await canEdit(row,authorHash,password))) throw Object.assign(new Error('forbidden'),{status:403});
    await pool.query("UPDATE community_posts SET is_deleted=TRUE,title='삭제된 글',body='',updated_at=CURRENT_TIMESTAMP WHERE id=$1",[id]); return true;
  }
  async function createComment(postId,input,authorHash,{ admin = false }={}) {
    if (!admin && await blocked(authorHash)) throw Object.assign(new Error('blocked'),{status:403});
    const body=safeText(input.body,3000); const nickname=admin?'이지핫딜 관리자':safeText(input.nickname||'ㅇㅇ',24,'ㅇㅇ');
    if (!admin && await banned(`${body} ${nickname}`)) throw new TypeError('사용할 수 없는 표현이 포함되어 있어요.');
    if ((body.match(URL_PATTERN)||[]).length>2) throw new TypeError('댓글 링크는 최대 2개까지 등록할 수 있어요.');
    if ((PHONE_PATTERN.test(body)||EMAIL_PATTERN.test(body)) && input.confirmPrivacy!==true) throw Object.assign(new Error('privacy_warning'),{status:409,code:'privacy_warning'});
    const post=await pool.query('SELECT * FROM community_posts WHERE id=$1 AND is_hidden=FALSE AND is_deleted=FALSE',[postId]); if(!post.rows[0]) return null;
    let parent=null; if(input.parentCommentId){ const p=await pool.query('SELECT id,parent_comment_id FROM community_comments WHERE id=$1 AND post_id=$2',[input.parentCommentId,postId]); if(!p.rows[0]||p.rows[0].parent_comment_id) throw new TypeError('답글은 한 단계까지만 작성할 수 있어요.'); parent=p.rows[0].id; }
    const passwordHash=!admin&&input.password?await bcrypt.hash(safeText(input.password,32),10):null;
    const inserted=await pool.query('INSERT INTO community_comments(post_id,parent_comment_id,body,nickname,author_hash,edit_password_hash,is_admin) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[postId,parent,body,nickname,authorHash,passwordHash,admin]);
    await pool.query('UPDATE community_posts SET comment_count=comment_count+1, answered_at=CASE WHEN $2=TRUE AND answer_requested=TRUE THEN COALESCE(answered_at,CURRENT_TIMESTAMP) ELSE answered_at END WHERE id=$1',[postId,admin]);
    return commentRow(inserted.rows[0],post.rows[0].author_hash,authorHash);
  }
  async function deleteComment(id,authorHash,password){ const found=await pool.query('SELECT * FROM community_comments WHERE id=$1 AND is_deleted=FALSE',[id]); const row=found.rows[0]; if(!row)return false; if(!(await canEdit(row,authorHash,password)))throw Object.assign(new Error('forbidden'),{status:403}); await pool.query("UPDATE community_comments SET is_deleted=TRUE,body='',updated_at=CURRENT_TIMESTAMP WHERE id=$1",[id]); return true; }
  async function vote(targetType,targetId,authorHash,value){ if(!['post','comment'].includes(targetType)||![-1,1].includes(value))throw new TypeError('투표 값을 확인해 주세요.'); const table=targetType==='post'?'community_posts':'community_comments'; const found=await pool.query(`SELECT id FROM ${table} WHERE id=$1 AND is_hidden=FALSE AND is_deleted=FALSE`,[targetId]); if(!found.rows[0])return null; const old=await pool.query('SELECT value FROM community_votes WHERE target_type=$1 AND target_id=$2 AND voter_hash=$3',[targetType,targetId,authorHash]); await pool.query('INSERT INTO community_votes(target_type,target_id,voter_hash,value) VALUES($1,$2,$3,$4) ON CONFLICT(target_type,target_id,voter_hash) DO UPDATE SET value=EXCLUDED.value,updated_at=CURRENT_TIMESTAMP',[targetType,targetId,authorHash,value]); const before=Number(old.rows[0]?.value||0); const upDelta=(value===1?1:0)-(before===1?1:0); const downDelta=(value===-1?1:0)-(before===-1?1:0); const updated=await pool.query(`UPDATE ${table} SET upvotes=upvotes+$2,downvotes=downvotes+$3 WHERE id=$1 RETURNING upvotes,downvotes`,[targetId,upDelta,downDelta]); return {upvotes:Number(updated.rows[0].upvotes),downvotes:Number(updated.rows[0].downvotes),value}; }
  async function report(targetType,targetId,authorHash,reason){ if(!['post','comment'].includes(targetType))throw new TypeError('신고 대상을 확인해 주세요.'); const table=targetType==='post'?'community_posts':'community_comments'; const target=await pool.query(`SELECT id FROM ${table} WHERE id=$1 AND is_hidden=FALSE AND is_deleted=FALSE`,[targetId]); if(!target.rows[0])return null; const text=safeText(reason,300); await pool.query('INSERT INTO community_reports(target_type,target_id,reporter_hash,reason) VALUES($1,$2,$3,$4) ON CONFLICT(target_type,target_id,reporter_hash) DO NOTHING',[targetType,targetId,authorHash,text]); return {ok:true}; }
  async function settings(){ const {rows}=await pool.query('SELECT key,value FROM community_settings'); return Object.fromEntries(rows.map((row)=>[row.key,row.value])); }
  async function publicSettings(){ const values=await settings(); return {consultationUrl:String(values.consultation_url||'')}; }
  async function popular(period='realtime',limit=5){
    const periods={realtime:6,today:24,week:168}; const hours=periods[period]||periods.realtime; const since=new Date(Date.now()-hours*60*60*1000);
    const [{rows},config]=await Promise.all([
      pool.query(`SELECT p.*,c.slug category_slug,c.name category_name FROM community_posts p JOIN community_categories c ON c.id=p.category_id WHERE p.is_hidden=FALSE AND p.is_deleted=FALSE AND c.is_active=TRUE AND p.created_at >= $1 ORDER BY p.created_at DESC LIMIT 500`,[since]),
      settings(),
    ]);
    const weights={up:Number(config.rank_upvote_weight)||8,down:Number(config.rank_downvote_weight)||5,comment:Number(config.rank_comment_weight)||4,view:Number(config.rank_view_weight)||0.125,age:Number(config.rank_age_power)||0.55};
    return rows.map((row)=>{const ageHours=Math.max(0,(Date.now()-new Date(row.created_at).getTime())/3600000);const score=(Number(row.upvotes||0)*weights.up-Number(row.downvotes||0)*weights.down+Number(row.comment_count||0)*weights.comment+Math.min(Number(row.views||0),500)*weights.view)/Math.pow(2+ageHours,weights.age);return {row,score};}).sort((a,b)=>b.score-a.score||new Date(b.row.created_at)-new Date(a.row.created_at)).slice(0,Math.max(1,Math.min(20,Number(limit)||5))).map(({row})=>postRow(row));
  }
  async function adminListPosts({q='',answer='',page=1,size=50}={}){ const params=[]; const where=['1=1']; if(q){params.push(`%${String(q).trim().slice(0,100)}%`);where.push(`(p.title ILIKE $${params.length} OR p.body ILIKE $${params.length})`);} if(answer==='unanswered')where.push('p.answer_requested=TRUE AND p.answered_at IS NULL'); if(answer==='answered')where.push('p.answer_requested=TRUE AND p.answered_at IS NOT NULL'); const safeSize=Math.max(1,Math.min(100,Number(size)||50)); const safePage=Math.max(1,Number(page)||1); const countParams=[...params]; const count=await pool.query(`SELECT COUNT(*) total FROM community_posts p JOIN community_categories c ON c.id=p.category_id WHERE ${where.join(' AND ')}`,countParams); params.push(safeSize,(safePage-1)*safeSize); const {rows}=await pool.query(`SELECT p.*,c.slug category_slug,c.name category_name FROM community_posts p JOIN community_categories c ON c.id=p.category_id WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC,p.id DESC LIMIT $${params.length-1} OFFSET $${params.length}`,params); return {posts:rows.map((r)=>({...postRow(r),hidden:r.is_hidden,deleted:r.is_deleted,authorKey:r.author_hash.slice(0,12),authorHash:r.author_hash})),total:Number(count.rows[0]?.total||0),page:safePage,size:safeSize}; }
  async function adminModeratePost(id,input){ const allowed=['show','hide','delete','restore']; if(!allowed.includes(input.action))throw new TypeError('처리 방식을 확인해 주세요.'); const map={show:['FALSE','FALSE'],hide:['TRUE','FALSE'],delete:['TRUE','TRUE'],restore:['FALSE','FALSE']}; const [hidden,deleted]=map[input.action]; const {rows}=await pool.query(`UPDATE community_posts SET is_hidden=${hidden},is_deleted=${deleted},updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING id,is_hidden,is_deleted`,[id]); return rows[0]||null; }
  async function adminComments(postId){ const post=await pool.query('SELECT author_hash FROM community_posts WHERE id=$1',[postId]); if(!post.rows[0])return []; const {rows}=await pool.query('SELECT * FROM community_comments WHERE post_id=$1 ORDER BY created_at,id',[postId]); return rows.map((r)=>({...commentRow(r,post.rows[0].author_hash),hidden:r.is_hidden,authorKey:r.author_hash.slice(0,12)})); }
  async function adminModerateComment(id,input){ const hidden=input.hidden===true; const deleted=input.deleted===true; const {rows}=await pool.query('UPDATE community_comments SET is_hidden=$2,is_deleted=$3,updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING id,is_hidden,is_deleted',[id,hidden,deleted]); return rows[0]||null; }
  async function adminReply(postId,input){ return createComment(postId,input,'admin',{admin:true}); }
  async function adminReports(){ const {rows}=await pool.query('SELECT id,target_type,target_id,reason,status,created_at FROM community_reports ORDER BY CASE WHEN status=\'open\' THEN 0 ELSE 1 END,created_at DESC LIMIT 200'); return rows.map((r)=>({id:String(r.id),targetType:r.target_type,targetId:String(r.target_id),reason:r.reason,status:r.status,createdAt:r.created_at})); }
  async function adminUpdateReport(id,status){ if(!['open','resolved','dismissed'].includes(status))throw new TypeError('신고 상태를 확인해 주세요.'); const {rows}=await pool.query('UPDATE community_reports SET status=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING id,status',[id,status]); return rows[0]||null; }
  async function adminSaveCategory(input){ const name=safeText(input.name,60); const slug=safeText(input.slug,48).toLowerCase().replace(/[^a-z0-9-]/g,'-').replace(/^-+|-+$/g,''); if(!slug)throw new TypeError('카테고리 영문 식별자를 입력해 주세요.'); if(input.id){ const {rows}=await pool.query('UPDATE community_categories SET slug=$2,name=$3,sort_order=$4,is_active=$5,updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *',[input.id,slug,name,Number(input.sortOrder)||0,input.active!==false]); return rows[0]; } const {rows}=await pool.query('INSERT INTO community_categories(slug,name,sort_order,is_active) VALUES($1,$2,$3,$4) RETURNING *',[slug,name,Number(input.sortOrder)||0,input.active!==false]); return rows[0]; }
  async function adminBannedWords(){ const {rows}=await pool.query('SELECT id,word,is_active FROM community_banned_words ORDER BY word'); return rows.map((r)=>({id:String(r.id),word:r.word,active:r.is_active})); }
  async function adminAddBannedWord(word){ const text=safeText(word,100); const {rows}=await pool.query('INSERT INTO community_banned_words(word) VALUES($1) ON CONFLICT(word) DO UPDATE SET is_active=TRUE RETURNING id,word,is_active',[text]); return {id:String(rows[0].id),word:rows[0].word,active:rows[0].is_active}; }
  async function adminDeleteBannedWord(id){ return (await pool.query('DELETE FROM community_banned_words WHERE id=$1',[id])).rowCount>0; }
  async function adminBlock(input){ const authorHash=safeText(input.authorHash,64); if(!/^[a-f0-9]{64}$/.test(authorHash))throw new TypeError('사용자 식별값을 확인해 주세요.'); const reason=String(input.reason||'').trim().slice(0,300); const expiresAt=input.expiresAt||null; await pool.query('INSERT INTO community_blocks(author_hash,reason,expires_at) VALUES($1,$2,$3) ON CONFLICT(author_hash) DO UPDATE SET reason=EXCLUDED.reason,expires_at=EXCLUDED.expires_at',[authorHash,reason,expiresAt]); return {ok:true}; }
  async function adminBlocks(){ const {rows}=await pool.query('SELECT author_hash,reason,expires_at,created_at FROM community_blocks ORDER BY created_at DESC LIMIT 200'); return rows.map((row)=>({authorHash:row.author_hash,authorKey:row.author_hash.slice(0,12),reason:row.reason,expiresAt:row.expires_at,createdAt:row.created_at})); }
  async function adminDeleteBlock(authorHash){ return (await pool.query('DELETE FROM community_blocks WHERE author_hash=$1',[authorHash])).rowCount>0; }
  async function adminSaveSettings(input){ const allowed=new Set(['rank_upvote_weight','rank_downvote_weight','rank_comment_weight','rank_view_weight','rank_age_power','consultation_url']); for(const [key,value] of Object.entries(input||{})){ if(!allowed.has(key))continue; const text=String(value??'').trim(); if(key!=='consultation_url'&&(!Number.isFinite(Number(text))||Number(text)<0||Number(text)>100))throw new TypeError('랭킹 설정값을 확인해 주세요.'); if(key==='consultation_url'&&text){ let url; try{url=new URL(text);}catch{throw new TypeError('상담 URL을 확인해 주세요.');} if(url.protocol!=='https:')throw new TypeError('상담 URL은 https 주소만 사용할 수 있어요.'); } await pool.query('INSERT INTO community_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=CURRENT_TIMESTAMP',[key,text]); } return settings(); }
  async function sitemapPosts(limit=5000){ const {rows}=await pool.query('SELECT id,updated_at FROM community_posts WHERE is_hidden=FALSE AND is_deleted=FALSE ORDER BY updated_at DESC LIMIT $1',[Math.max(1,Math.min(5000,Number(limit)||5000))]); return rows.map((row)=>({id:String(row.id),updatedAt:row.updated_at})); }
  return { categories,listPosts,getPost,createPost,updatePost,deletePost,createComment,deleteComment,vote,report,popular,publicSettings,sitemapPosts,adminListPosts,adminModeratePost,adminComments,adminModerateComment,adminReply,adminReports,adminUpdateReport,adminSaveCategory,adminBannedWords,adminAddBannedWord,adminDeleteBannedWord,adminBlock,adminBlocks,adminDeleteBlock,settings,adminSaveSettings };
}

function communityError(error,res,next){ if(error?.code==='privacy_warning')return res.status(409).json({error:'privacy_warning',message:'전화번호로 보이는 정보가 포함되어 있어요. 공개 게시판에 올려도 되는지 확인해 주세요.'}); if(error?.status)return res.status(error.status).json({error:error.message}); if(error instanceof TypeError)return res.status(400).json({error:'invalid_request',message:error.message}); return next(error); }

function createCommunityRouter({store,secret,production=false,consultationUrl=''}){
  if(!store||!secret)throw new TypeError('community store and secret are required'); const router=express.Router();
  router.use((req,res,next)=>{ req.communityAuthorHash=anonymousIdentity(req,res,secret,production); next(); });
  const mutation=(req,res,next)=>{ if(!sameOrigin(req))return res.status(403).json({error:'origin_mismatch'}); if(!rateLimit(`${req.communityAuthorHash}:${req.path}`,30,60000))return res.status(429).json({error:'rate_limited'}); next(); };
  router.get('/api/community/categories',async(req,res,next)=>{try{res.json({categories:await store.categories()});}catch(e){next(e)}});
  router.get('/api/community/posts',async(req,res,next)=>{try{res.json(await store.listPosts(req.query,req.communityAuthorHash));}catch(e){communityError(e,res,next)}});
  router.get('/api/community/posts/:id',async(req,res,next)=>{try{const value=await store.getPost(req.params.id,req.communityAuthorHash,true);if(!value)return res.status(404).json({error:'not_found'});const configured=await store.publicSettings();return res.json({...value,consultationUrl:configured.consultationUrl||consultationUrl});}catch(e){communityError(e,res,next)}});
  router.post('/api/community/posts',mutation,async(req,res,next)=>{try{if(!rateLimit(`post:${req.communityAuthorHash}`,3,10*60000))return res.status(429).json({error:'rate_limited'}); res.status(201).json(await store.createPost(req.body||{},req.communityAuthorHash));}catch(e){communityError(e,res,next)}});
  router.patch('/api/community/posts/:id',mutation,async(req,res,next)=>{try{const value=await store.updatePost(req.params.id,req.body||{},req.communityAuthorHash);return value?res.json(value):res.status(404).json({error:'not_found'});}catch(e){communityError(e,res,next)}});
  router.delete('/api/community/posts/:id',mutation,async(req,res,next)=>{try{return await store.deletePost(req.params.id,req.communityAuthorHash,req.body?.password)?res.sendStatus(204):res.status(404).json({error:'not_found'});}catch(e){communityError(e,res,next)}});
  router.post('/api/community/posts/:id/comments',mutation,async(req,res,next)=>{try{if(!rateLimit(`comment:${req.communityAuthorHash}`,10,10*60000))return res.status(429).json({error:'rate_limited'}); const value=await store.createComment(req.params.id,req.body||{},req.communityAuthorHash);return value?res.status(201).json(value):res.status(404).json({error:'not_found'});}catch(e){communityError(e,res,next)}});
  router.delete('/api/community/comments/:id',mutation,async(req,res,next)=>{try{return await store.deleteComment(req.params.id,req.communityAuthorHash,req.body?.password)?res.sendStatus(204):res.status(404).json({error:'not_found'});}catch(e){communityError(e,res,next)}});
  router.post('/api/community/votes',mutation,async(req,res,next)=>{try{const value=await store.vote(req.body?.targetType,req.body?.targetId,req.communityAuthorHash,Number(req.body?.value));return value?res.json(value):res.status(404).json({error:'not_found'});}catch(e){communityError(e,res,next)}});
  router.post('/api/community/reports',mutation,async(req,res,next)=>{try{const value=await store.report(req.body?.targetType,req.body?.targetId,req.communityAuthorHash,req.body?.reason);return value?res.status(201).json(value):res.status(404).json({error:'not_found'});}catch(e){communityError(e,res,next)}});
  router.get('/api/community/popular',async(req,res,next)=>{try{res.json({period:['realtime','today','week'].includes(req.query.period)?req.query.period:'realtime',posts:await store.popular(req.query.period,Number(req.query.limit)||5)});}catch(e){next(e)}});
  return router;
}

function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function detailHtml(post){const title=`${escapeHtml(post.title)} | 이지핫딜 커뮤니티`; const desc=escapeHtml(post.body.slice(0,140)); const canonical=`https://easyshoopping.com/community/posts/${post.id}`; return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="description" content="${desc}"><link rel="canonical" href="${canonical}"><meta property="og:title" content="${title}"><meta property="og:description" content="${desc}"><meta property="og:url" content="${canonical}"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/community.css"></head><body data-community-post-id="${post.id}"><header class="community-top"><a href="/" class="community-brand">EASY HOT DEAL</a><a href="/community">커뮤니티</a></header><main class="community-shell"><div id="post-detail" class="community-detail"><h1>${escapeHtml(post.title)}</h1><p>게시글을 불러오는 중...</p></div></main><script src="/community.js" defer></script></body></html>`;}

function createCommunityPagesRouter({store,publicDir}){const router=express.Router(); router.get('/community',(_req,res)=>res.sendFile(`${publicDir}/community.html`)); router.get('/community/posts/:id',async(req,res,next)=>{try{const value=await store.getPost(req.params.id,null,false); if(!value)return next(); res.type('html').send(detailHtml(value.post));}catch(e){next(e)}}); return router;}

function createCommunityAdminRouter({store,auth}){ if(!store||!auth?.requireAuth||!auth?.requireMutationProtection)throw new TypeError('community admin auth is required'); const router=express.Router(); router.use(auth.requireAuth); const asyncRoute=(fn)=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next); router.get('/posts',asyncRoute(async(req,res)=>res.json(await store.adminListPosts(req.query)))); router.patch('/posts/:id',auth.requireMutationProtection,asyncRoute(async(req,res)=>{const row=await store.adminModeratePost(req.params.id,req.body||{});return row?res.json(row):res.status(404).json({error:'not_found'});})); router.get('/posts/:id/comments',asyncRoute(async(req,res)=>res.json({comments:await store.adminComments(req.params.id)}))); router.post('/posts/:id/reply',auth.requireMutationProtection,asyncRoute(async(req,res)=>{const value=await store.adminReply(req.params.id,req.body||{});return value?res.status(201).json(value):res.status(404).json({error:'not_found'});})); router.patch('/comments/:id',auth.requireMutationProtection,asyncRoute(async(req,res)=>{const row=await store.adminModerateComment(req.params.id,req.body||{});return row?res.json(row):res.status(404).json({error:'not_found'});})); router.get('/reports',asyncRoute(async(_req,res)=>res.json({reports:await store.adminReports()}))); router.patch('/reports/:id',auth.requireMutationProtection,asyncRoute(async(req,res)=>{const row=await store.adminUpdateReport(req.params.id,req.body?.status);return row?res.json(row):res.status(404).json({error:'not_found'});})); router.get('/categories',asyncRoute(async(_req,res)=>res.json({categories:await store.categories({all:true})}))); router.post('/categories',auth.requireMutationProtection,asyncRoute(async(req,res)=>res.status(201).json(await store.adminSaveCategory(req.body||{})))); router.put('/categories/:id',auth.requireMutationProtection,asyncRoute(async(req,res)=>res.json(await store.adminSaveCategory({...req.body,id:req.params.id})))); router.get('/banned-words',asyncRoute(async(_req,res)=>res.json({words:await store.adminBannedWords()}))); router.post('/banned-words',auth.requireMutationProtection,asyncRoute(async(req,res)=>res.status(201).json(await store.adminAddBannedWord(req.body?.word)))); router.delete('/banned-words/:id',auth.requireMutationProtection,asyncRoute(async(req,res)=>await store.adminDeleteBannedWord(req.params.id)?res.sendStatus(204):res.status(404).json({error:'not_found'}))); router.get('/blocks',asyncRoute(async(_req,res)=>res.json({blocks:await store.adminBlocks()}))); router.post('/blocks',auth.requireMutationProtection,asyncRoute(async(req,res)=>res.status(201).json(await store.adminBlock(req.body||{})))); router.delete('/blocks/:authorHash',auth.requireMutationProtection,asyncRoute(async(req,res)=>await store.adminDeleteBlock(req.params.authorHash)?res.sendStatus(204):res.status(404).json({error:'not_found'}))); router.get('/settings',asyncRoute(async(_req,res)=>res.json({settings:await store.settings()}))); router.put('/settings',auth.requireMutationProtection,asyncRoute(async(req,res)=>res.json({settings:await store.adminSaveSettings(req.body||{})}))); router.use((error,_req,res,next)=>{if(error instanceof TypeError)return res.status(400).json({error:'invalid_request',message:error.message});return next(error)}); return router; }

module.exports={createCommunityStore,createCommunityRouter,createCommunityPagesRouter,createCommunityAdminRouter,detailHtml};
