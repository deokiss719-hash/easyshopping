const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const SHA256_HASH = /^[a-f0-9]{64}$/;
const { isCategory } = require('../deal-category');

const SITE_SETTING_DEFINITIONS = Object.freeze({
  home_manual_limit: { public: true, validate: (value) => Number.isInteger(value) && value >= 0 && value <= 20 },
  recommended_searches: { public: true, validate: (value) => Array.isArray(value) && value.length <= 12 && value.every((item) => typeof item === 'string' && item.trim().length >= 1 && item.length <= 30) },
  main_copy: { public: true, validate: (value) => typeof value === 'string' && value.trim().length >= 1 && value.length <= 300 },
  phone_section_title: { public: true, validate: (value) => typeof value === 'string' && value.trim().length >= 1 && value.length <= 100 },
  admin_note: { public: false, validate: (value) => typeof value === 'string' && value.length <= 500 },
});

function integer(value, name, { nullable = true } = {}) {
  if (value == null && nullable) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a safe non-negative integer`);
  return value;
}

function httpsUrl(value, name, { nullable = false } = {}) {
  if ((value == null || value === '') && nullable) return null;
  let url;
  try { url = new URL(String(value)); } catch { throw new TypeError(`${name} must be a valid HTTPS URL`); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new TypeError(`${name} must be a valid HTTPS URL using the default port`);
  return url.href;
}

function normalizeManualDeal(input) {
  const title = String(input?.title || '').trim();
  if (!title || title.length > 300) throw new TypeError('title is required and must be at most 300 characters');
  const priority = Number(input.priority ?? 0);
  if (!Number.isSafeInteger(priority) || priority < -100000 || priority > 100000) throw new TypeError('priority is invalid');
  const category = input.category == null || input.category === '' ? '디지털/가전' : String(input.category).trim();
  if (!isCategory(category)) throw new TypeError('category is not supported');
  return {
    title,
    productUrl: httpsUrl(input.productUrl, 'productUrl'),
    imageUrl: httpsUrl(input.imageUrl, 'imageUrl', { nullable: true }),
    merchant: input.merchant == null ? null : String(input.merchant).trim().slice(0, 200) || null,
    priceAmount: integer(input.priceAmount, 'priceAmount'),
    originalPriceAmount: integer(input.originalPriceAmount, 'originalPriceAmount'),
    description: input.description == null ? null : String(input.description).trim().slice(0, 2000) || null,
    badge: input.badge == null ? null : String(input.badge).trim().slice(0, 50) || null,
    category,
    isPublished: input.isPublished === true,
    showOnHome: input.showOnHome === true,
    priority,
  };
}

function safeNumber(value) {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new RangeError('database integer is outside JavaScript safe range');
  return number;
}

function mapManual(row) {
  return {
    id: String(row.id), dealId: row.deal_id == null ? null : String(row.deal_id), title: row.title,
    productUrl: row.product_url, imageUrl: row.image_url, merchant: row.merchant,
    priceAmount: safeNumber(row.price_amount), originalPriceAmount: safeNumber(row.original_price_amount),
    description: row.description, badge: row.badge, category: row.category, isPublished: row.is_published,
    showOnHome: row.show_on_home, priority: row.priority, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function manualValues(deal) {
  return [deal.title, deal.productUrl, deal.imageUrl, deal.merchant, deal.priceAmount,
    deal.originalPriceAmount, deal.description, deal.badge, deal.category, deal.isPublished, deal.showOnHome, deal.priority];
}

function createAdminStore(pool) {
  async function inTransaction(worker) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await worker(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  function validatedSettings(values) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new TypeError('site settings must be an object');
    return Object.entries(values).map(([key, value]) => {
      const definition = SITE_SETTING_DEFINITIONS[key];
      if (!definition) throw new TypeError('site setting is not allowed');
      if (!definition.validate(value)) throw new TypeError('site setting value is invalid');
      return [key, value];
    });
  }

  return {
    async bootstrapAdmin(username, passwordHash) {
      const normalized = String(username || '').trim().toLowerCase();
      if (!/^[a-z0-9_.-]{1,64}$/.test(normalized)) throw new TypeError('admin username is invalid');
      if (!BCRYPT_HASH.test(String(passwordHash || ''))) throw new TypeError('ADMIN_PASSWORD_HASH must be a bcrypt hash');
      const result = await pool.query(
        `INSERT INTO admin_users(username,password_hash) VALUES($1,$2)
         ON CONFLICT(username) DO UPDATE SET password_hash=EXCLUDED.password_hash,is_active=TRUE,updated_at=CURRENT_TIMESTAMP
         RETURNING id,username,is_active`, [normalized, passwordHash],
      );
      return { id: String(result.rows[0].id), username: result.rows[0].username, isActive: result.rows[0].is_active };
    },
    async findAdmin(username) {
      const result = await pool.query('SELECT * FROM admin_users WHERE username=$1', [String(username || '').trim().toLowerCase()]);
      const row = result.rows[0];
      return row ? { id: String(row.id), username: row.username, passwordHash: row.password_hash, isActive: row.is_active } : null;
    },
    async recordLogin(id) { await pool.query('UPDATE admin_users SET last_login_at=CURRENT_TIMESTAMP WHERE id=$1', [id]); },
    async createSession({ userId, tokenHash, csrfHash, expiresAt }) {
      if (!SHA256_HASH.test(tokenHash) || !SHA256_HASH.test(csrfHash)) throw new TypeError('session hashes must be SHA-256 hex');
      await pool.query('INSERT INTO admin_sessions(admin_user_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,$4)', [userId, tokenHash, csrfHash, expiresAt]);
    },
    async getSession(tokenHash, now = new Date()) {
      if (!SHA256_HASH.test(String(tokenHash))) return null;
      const result = await pool.query(
        `SELECT s.id,s.admin_user_id,s.csrf_hash,s.expires_at,u.username,u.is_active
         FROM admin_sessions s JOIN admin_users u ON u.id=s.admin_user_id
         WHERE s.token_hash=$1 AND s.expires_at>$2 AND u.is_active=TRUE`, [tokenHash, now.toISOString()],
      );
      return result.rows[0] || null;
    },
    async deleteSession(tokenHash) { return (await pool.query('DELETE FROM admin_sessions WHERE token_hash=$1', [tokenHash])).rowCount > 0; },
    async purgeExpiredSessions(now = new Date()) { return (await pool.query('DELETE FROM admin_sessions WHERE expires_at<=$1', [now.toISOString()])).rowCount; },

    async createManualDeal(input) {
      const deal = normalizeManualDeal(input);
      return inTransaction(async (client) => {
        const inserted = await client.query(
          `INSERT INTO manual_deals(title,product_url,image_url,merchant,price_amount,original_price_amount,description,badge,category,is_published,show_on_home,priority)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, manualValues(deal),
        );
        const id = inserted.rows[0].id;
        const projected = await client.query(
          `INSERT INTO deals(source,source_item_id,title,price_text,price_amount,merchant,original_url,source_image_url,image_status,published_at,is_ended,ended_at,category)
           VALUES('manual',$1,$2,$3,$4,$5,$6,$7,$8,CURRENT_TIMESTAMP,$9,CASE WHEN $9 THEN CURRENT_TIMESTAMP ELSE NULL END,$10) RETURNING id`,
          [String(id), deal.title, deal.priceAmount == null ? null : `${deal.priceAmount}원`, deal.priceAmount, deal.merchant, deal.productUrl, deal.imageUrl,
            deal.imageUrl ? 'pending' : 'missing_merchant_url', !deal.isPublished, deal.category],
        );
        const result = await client.query('UPDATE manual_deals SET deal_id=$1 WHERE id=$2 RETURNING *', [projected.rows[0].id, id]);
        return mapManual(result.rows[0]);
      });
    },
    async updateManualDeal(id, input) {
      if (!/^\d+$/.test(String(id))) throw new TypeError('manual deal id is invalid');
      const deal = normalizeManualDeal(input);
      return inTransaction(async (client) => {
        const current = await client.query('SELECT deal_id FROM manual_deals WHERE id=$1 FOR UPDATE', [id]);
        if (!current.rows[0]) return null;
        const result = await client.query(
          `UPDATE manual_deals SET title=$1,product_url=$2,image_url=$3,merchant=$4,price_amount=$5,original_price_amount=$6,description=$7,badge=$8,category=$9,is_published=$10,show_on_home=$11,priority=$12,updated_at=CURRENT_TIMESTAMP WHERE id=$13 RETURNING *`,
          [...manualValues(deal), id],
        );
        await client.query(
          `UPDATE deals SET title=$1,price_text=$2,price_amount=$3,merchant=$4,original_url=$5,source_image_url=$6,
           image_status=CASE WHEN $6::text IS NULL THEN 'missing_merchant_url' ELSE 'pending' END,
           is_ended=$7,ended_at=CASE WHEN $7 THEN CURRENT_TIMESTAMP ELSE NULL END,last_seen_at=CURRENT_TIMESTAMP,category=$8
           WHERE id=$9 AND source='manual'`,
          [deal.title, deal.priceAmount == null ? null : `${deal.priceAmount}원`, deal.priceAmount, deal.merchant, deal.productUrl, deal.imageUrl, !deal.isPublished, deal.category, current.rows[0].deal_id],
        );
        return mapManual(result.rows[0]);
      });
    },
    async deleteManualDeal(id) {
      if (!/^\d+$/.test(String(id))) throw new TypeError('manual deal id is invalid');
      return inTransaction(async (client) => {
        const result = await client.query('DELETE FROM manual_deals WHERE id=$1 RETURNING deal_id', [id]);
        if (!result.rows[0]) return false;
        await client.query("DELETE FROM deals WHERE id=$1 AND source='manual'", [result.rows[0].deal_id]);
        return true;
      });
    },
    async listManualDeals() { return (await pool.query('SELECT * FROM manual_deals ORDER BY priority DESC,id DESC')).rows.map(mapManual); },
    async listPublicManualDeals({ homeOnly = false, limit = 100 } = {}) {
      const safeLimit = Math.max(1, Math.min(100, Number.isInteger(limit) ? limit : 100));
      const result = await pool.query(
        `SELECT d.*,m.original_price_amount AS manual_original_price_amount,
           m.description AS manual_description,m.badge AS manual_badge,
           m.show_on_home AS manual_show_on_home,m.priority AS manual_priority,m.id AS manual_id
         FROM deals d JOIN manual_deals m ON m.deal_id=d.id
         WHERE d.source='manual' AND d.is_ended=FALSE AND m.is_published=TRUE AND ($1::boolean=FALSE OR m.show_on_home=TRUE)
         ORDER BY m.priority DESC,m.updated_at DESC LIMIT $2`, [homeOnly, safeLimit],
      );
      return result.rows.map((row) => ({
        id: String(row.id), manualId: String(row.manual_id), source: row.source, title: row.title,
        priceAmount: safeNumber(row.price_amount), originalPriceAmount: safeNumber(row.manual_original_price_amount),
        merchant: row.merchant, originalUrl: row.original_url, imageUrl: row.image_url,
        category: row.category, description: row.manual_description, badge: row.manual_badge,
        showOnHome: row.manual_show_on_home, priority: row.manual_priority, publishedAt: row.published_at,
      }));
    },
    async getPublishedManualImage(id) {
      if (!/^\d+$/.test(String(id))) return null;
      const result = await pool.query(
        `SELECT image_url FROM manual_deals
         WHERE id=$1 AND is_published=TRUE AND image_url IS NOT NULL`,
        [id],
      );
      return result.rows[0] ? { imageUrl: result.rows[0].image_url } : null;
    },
    async setSetting(key, value) {
      validatedSettings({ [key]: value });
      const result = await pool.query(
        `INSERT INTO site_settings(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=CURRENT_TIMESTAMP RETURNING key,value`,
        [key, JSON.stringify(value)],
      );
      return { key: result.rows[0].key, value: result.rows[0].value };
    },
    async setSettings(values) {
      const entries = validatedSettings(values);
      return inTransaction(async (client) => {
        const saved = {};
        for (const [key, value] of entries) {
          const result = await client.query(
            `INSERT INTO site_settings(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=CURRENT_TIMESTAMP RETURNING key,value`,
            [key, JSON.stringify(value)],
          );
          saved[result.rows[0].key] = result.rows[0].value;
        }
        return saved;
      });
    },
    async getSettings() {
      const result = await pool.query('SELECT key,value FROM site_settings ORDER BY key');
      return Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
    },
    async getPublicSettings() {
      const all = await this.getSettings();
      return Object.fromEntries(Object.entries(all).filter(([key]) => SITE_SETTING_DEFINITIONS[key]?.public));
    },
  };
}

module.exports = { createAdminStore, SITE_SETTING_DEFINITIONS, normalizeManualDeal };
