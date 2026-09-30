'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const token = () => crypto.randomBytes(32).toString('base64url');
const hash = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
function encryption(secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw Error('saju encryption key required');
  const key = crypto
    .createHash('sha256')
    .update('saju-encryption-v1:' + secret)
    .digest();
  return {
    seal(value) {
      const iv = crypto.randomBytes(12),
        c = crypto.createCipheriv('aes-256-gcm', key, iv);
      return Buffer.concat([
        iv,
        c.update(JSON.stringify(value)),
        c.final(),
        c.getAuthTag(),
      ]).toString('base64');
    },
    open(value) {
      const b = Buffer.from(value, 'base64'),
        d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
      d.setAuthTag(b.subarray(-16));
      return JSON.parse(Buffer.concat([d.update(b.subarray(12, -16)), d.final()]).toString());
    },
  };
}
async function createStore(pool, secret) {
  await pool.query(await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8'));
  const crypt = encryption(secret);
  const one = async (q, args = []) => (await pool.query(q, args)).rows[0];
  async function event(name, mode = 'demo') {
    if (
      !['visit', 'input_start', 'input_complete', 'preview', 'checkout', 'paid', 'refund'].includes(
        name,
      )
    )
      return;
    await pool.query(
      "INSERT INTO saju_events(day,event,mode,count) VALUES((NOW() AT TIME ZONE 'Asia/Seoul')::date,$1,$2,1) ON CONFLICT(day,event,mode) DO UPDATE SET count=saju_events.count+1",
      [name, mode],
    );
  }
  return {
    pool,
    crypt,
    one,
    event,
    async settings() {
      return one('SELECT * FROM saju_settings WHERE id=1');
    },
    async updateSettings(s) {
      if (
        !Number.isInteger(s.price) ||
        s.price < 100 ||
        s.price > 1000000 ||
        !['ko-evidence-1', 'ko-grandmother-2', 'ko-depth-3', 'ko-pattern-4', 'ko-story-5', 'ko-grandmother-story-6', 'ko-simple-story-7', 'ko-whole-chart-8', 'ko-context-story-9', 'ko-lived-story-10', 'ko-easy-story-11'].includes(s.report_version) ||
        ![3, 4].includes(s.free_sections) ||
        typeof s.sales_enabled !== 'boolean'
      )
        throw new TypeError('설정값을 확인해 주세요.');
      return one(
        'UPDATE saju_settings SET price=$1,report_version=$2,free_sections=$3,sales_enabled=$4 WHERE id=1 RETURNING *',
        [s.price, s.report_version, s.free_sections, s.sales_enabled],
      );
    },
    async limit(key, max = 20, seconds = 600) {
      const k = crypto.createHmac('sha256', secret).update(key).digest('hex');
      const row = await one(
        "INSERT INTO saju_limits(key,count,expires_at) VALUES($1,1,NOW()+$2 * INTERVAL '1 second') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN saju_limits.expires_at<NOW() THEN 1 ELSE saju_limits.count+1 END, expires_at=CASE WHEN saju_limits.expires_at<NOW() THEN EXCLUDED.expires_at ELSE saju_limits.expires_at END RETURNING count",
        [k, seconds],
      );
      return row.count <= max;
    },
    async create(payload, owner, { betaAccess = false } = {}) {
      const id = crypto.randomUUID(),
        recovery = token(),
        link = token();
      const fingerprint = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(payload))
        .digest('hex');
      await pool.query(
        "INSERT INTO saju_reports(id,payload,owner_hash,recovery_hash,link_hash,link_expires,expires_at,fingerprint,beta_access) VALUES($1,$2,$3,$4,$5,NOW()+INTERVAL '7 days',NOW()+INTERVAL '7 days',$6,$7)",
        [id, crypt.seal(payload), hash(owner), hash(recovery), hash(link), fingerprint, betaAccess],
      );
      return { id, recovery, link };
    },
    async authorized(id, owner, session) {
      return one(
        'SELECT * FROM saju_reports WHERE id=$1 AND deleted_at IS NULL AND expires_at>NOW() AND ((owner_hash=$2 AND owner_expires>NOW()) OR (session_hash=$3 AND session_expires>NOW()))',
        [id, hash(owner || ''), hash(session || '')],
      );
    },
    async recover(code, isLink) {
      const session = token(),
        link = token();
      const row = await one(
        `UPDATE saju_reports SET owner_hash='',session_hash=$2,session_expires=NOW()+INTERVAL '1 hour',link_hash=$3,link_expires=NOW()+INTERVAL '7 days' WHERE ${isLink ? 'link_hash' : 'recovery_hash'}=$1 ${isLink ? 'AND link_expires>NOW()' : ''} AND expires_at>NOW() AND deleted_at IS NULL RETURNING id`,
        [hash(code), hash(session), hash(link)],
      );
      return row ? { id: row.id, session, link } : null;
    },
    async reissue(id) {
      const link = token();
      await pool.query(
        "UPDATE saju_reports SET link_hash=$2,link_expires=NOW()+INTERVAL '7 days' WHERE id=$1",
        [id, hash(link)],
      );
      return link;
    },
    async order(report, amount, mode) {
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        const active = (
          await db.query(
            'SELECT id FROM saju_reports WHERE id=$1 AND deleted_at IS NULL AND expires_at>NOW() FOR UPDATE',
            [report.id],
          )
        ).rows[0];
        if (!active) throw new TypeError('보고서가 만료되었어요.');
        let current = (
          await db.query(
            "SELECT * FROM saju_orders WHERE report_id=$1 AND status IN ('pending','confirming','paid','refund_requested','refunding')",
            [report.id],
          )
        ).rows[0];
        if (!current) {
          const id = 'saju_' + crypto.randomUUID();
          current = (
            await db.query(
              'INSERT INTO saju_orders(id,report_id,amount,mode) VALUES($1,$2,$3,$4) RETURNING *',
              [id, report.id, amount, mode],
            )
          ).rows[0];
        }
        await db.query('COMMIT');
        return current;
      } catch (e) {
        await db.query('ROLLBACK');
        throw e;
      } finally {
        db.release();
      }
    },
    async erase(id) {
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        await db.query('SELECT id FROM saju_reports WHERE id=$1 FOR UPDATE', [id]);
        const blocked = (
          await db.query(
            "SELECT id FROM saju_orders WHERE report_id=$1 AND status IN ('confirming','refund_requested','refunding') FOR UPDATE",
            [id],
          )
        ).rows[0];
        if (blocked) throw new TypeError('결제·환불 확인이 끝난 뒤 삭제할 수 있어요.');
        await db.query(
          "UPDATE saju_orders SET status='failed' WHERE report_id=$1 AND status='pending'",
          [id],
        );
        await db.query(
          "UPDATE saju_reports SET payload=NULL,deleted_at=NOW(),owner_hash='',session_hash=NULL,link_hash=NULL WHERE id=$1",
          [id],
        );
        await db.query('COMMIT');
      } catch (e) {
        await db.query('ROLLBACK');
        throw e;
      } finally {
        db.release();
      }
    },
    async purge() {
      await pool.query("UPDATE saju_orders SET meta_context=NULL WHERE meta_context IS NOT NULL AND created_at<NOW()-INTERVAL '7 days'");
      await pool.query("DELETE FROM saju_meta_outbox WHERE created_at<NOW()-INTERVAL '7 days'");
      await pool.query(
        'UPDATE saju_reports SET payload=NULL,deleted_at=NOW(),session_hash=NULL,link_hash=NULL WHERE expires_at<NOW() AND payload IS NOT NULL',
      );
      await pool.query('DELETE FROM saju_limits WHERE expires_at<NOW()');
      await pool.query(
        "DELETE FROM saju_orders WHERE (mode<>'live' AND created_at<NOW()-INTERVAL '30 days') OR (mode='live' AND created_at<NOW()-INTERVAL '5 years')",
      );
      await pool.query(
        'DELETE FROM saju_reports r WHERE r.deleted_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM saju_orders o WHERE o.report_id=r.id)',
      );
      await pool.query("DELETE FROM saju_events WHERE day<CURRENT_DATE-INTERVAL '2 years'");
    },
    async dashboard() {
      return {
        settings: await this.settings(),
        orders: (
          await pool.query(
            'SELECT id,amount,mode,status,created_at,paid_at,refund_requested_at,refunded_at FROM saju_orders ORDER BY created_at DESC LIMIT 200',
          )
        ).rows,
        events: (
          await pool.query(
            "SELECT day,event,mode,count FROM saju_events WHERE day>=CURRENT_DATE-INTERVAL '30 days' ORDER BY day DESC,event",
          )
        ).rows,
      };
    },
  };
}
module.exports = { createStore, encryption, token, hash };
