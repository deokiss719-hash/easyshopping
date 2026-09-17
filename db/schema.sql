CREATE TABLE IF NOT EXISTS deals (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  source_item_id TEXT NOT NULL,
  title TEXT NOT NULL,
  price_text TEXT,
  price_amount BIGINT CHECK (price_amount IS NULL OR price_amount >= 0),
  merchant TEXT,
  original_url TEXT NOT NULL,
  merchant_url TEXT,
  source_image_url TEXT,
  image_url TEXT,
  image_status TEXT NOT NULL DEFAULT 'pending',
  image_provider TEXT,
  image_failure_code TEXT,
  image_retry_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMPTZ,
  is_ended BOOLEAN NOT NULL DEFAULT FALSE,
  raw_hash TEXT,
  category TEXT NOT NULL DEFAULT '기타',
  badge TEXT,
  description TEXT,
  UNIQUE (source, source_item_id)
);

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT '기타';
ALTER TABLE deals ADD COLUMN IF NOT EXISTS badge TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS merchant_url TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS source_image_url TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS image_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE deals ADD COLUMN IF NOT EXISTS image_provider TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS image_failure_code TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS image_retry_at TIMESTAMPTZ;

UPDATE deals
SET image_status = 'ready'
WHERE image_url IS NOT NULL AND image_status = 'missing_merchant_url';

ALTER TABLE deals ALTER COLUMN image_status SET DEFAULT 'pending';

UPDATE deals
SET image_status = 'pending', image_retry_at = NULL
WHERE image_url IS NULL AND image_status = 'missing_merchant_url';

CREATE INDEX IF NOT EXISTS deals_published_at_idx ON deals (published_at DESC);
CREATE INDEX IF NOT EXISTS deals_source_idx ON deals (source);
CREATE INDEX IF NOT EXISTS deals_active_idx ON deals (is_ended, published_at DESC);
CREATE INDEX IF NOT EXISTS deals_source_image_backfill_idx ON deals (image_status, image_retry_at)
  WHERE image_url IS NULL AND is_ended = FALSE;

CREATE TABLE IF NOT EXISTS collection_runs (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  fetched_count INTEGER NOT NULL DEFAULT 0,
  upserted_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS collection_runs_source_status_idx
  ON collection_runs (source, status, finished_at DESC, started_at DESC);

CREATE TABLE IF NOT EXISTS image_backfill_control (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  cooldown_until TIMESTAMPTZ,
  failure_code TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (username = LOWER(username))
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id BIGSERIAL PRIMARY KEY,
  admin_user_id BIGINT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  csrf_hash VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS admin_sessions_expires_idx ON admin_sessions (expires_at);

CREATE TABLE IF NOT EXISTS manual_deals (
  id BIGSERIAL PRIMARY KEY,
  deal_id BIGINT UNIQUE REFERENCES deals(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  product_url TEXT NOT NULL,
  image_url TEXT,
  merchant TEXT,
  price_amount BIGINT CHECK (price_amount IS NULL OR price_amount >= 0),
  original_price_amount BIGINT CHECK (original_price_amount IS NULL OR original_price_amount >= 0),
  description TEXT,
  badge TEXT,
  category TEXT NOT NULL DEFAULT '디지털/가전',
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  show_on_home BOOLEAN NOT NULL DEFAULT FALSE,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE manual_deals
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT '디지털/가전';
CREATE INDEX IF NOT EXISTS manual_deals_public_idx
  ON manual_deals (is_published, show_on_home, priority DESC);

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS advertising_inquiries (
  id BIGSERIAL PRIMARY KEY,
  company_name VARCHAR(120) NOT NULL,
  contact_name VARCHAR(80) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  email VARCHAR(254) NOT NULL,
  ad_type VARCHAR(40) NOT NULL CHECK (ad_type IN ('banner', 'deal', 'partnership', 'other')),
  message TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'done')),
  admin_note VARCHAR(1000) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS advertising_inquiries_status_created_idx
  ON advertising_inquiries (status, created_at DESC);

CREATE TABLE IF NOT EXISTS traffic_daily (
  day DATE PRIMARY KEY,
  page_views BIGINT NOT NULL DEFAULT 0 CHECK (page_views >= 0),
  detail_records INTEGER NOT NULL DEFAULT 0 CHECK (detail_records >= 0)
);

ALTER TABLE traffic_daily ADD COLUMN IF NOT EXISTS detail_records INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS traffic_daily_visitors (
  day DATE NOT NULL REFERENCES traffic_daily(day) ON DELETE CASCADE,
  visitor_hash VARCHAR(64) NOT NULL,
  insert_marker CHAR(32) NOT NULL,
  source TEXT NOT NULL DEFAULT 'direct' CHECK (source IN ('direct', 'internal', 'search', 'social', 'referral')),
  domain VARCHAR(253) NOT NULL DEFAULT '',
  search_term VARCHAR(200) NOT NULL DEFAULT '',
  referrer_url VARCHAR(2048) NOT NULL DEFAULT '',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (day, visitor_hash)
);
ALTER TABLE traffic_daily_visitors ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'direct';
ALTER TABLE traffic_daily_visitors ADD COLUMN IF NOT EXISTS domain VARCHAR(253) NOT NULL DEFAULT '';
ALTER TABLE traffic_daily_visitors ADD COLUMN IF NOT EXISTS search_term VARCHAR(200) NOT NULL DEFAULT '';
ALTER TABLE traffic_daily_visitors ADD COLUMN IF NOT EXISTS referrer_url VARCHAR(2048) NOT NULL DEFAULT '';
ALTER TABLE traffic_daily_visitors ADD COLUMN IF NOT EXISTS insert_marker CHAR(32) NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS traffic_daily_referrers (
  day DATE NOT NULL REFERENCES traffic_daily(day) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('direct', 'internal', 'search', 'social', 'referral')),
  domain VARCHAR(253) NOT NULL DEFAULT '',
  visitors BIGINT NOT NULL DEFAULT 0 CHECK (visitors >= 0),
  PRIMARY KEY (day, source, domain)
);

-- Public ranking metadata and first-party, daily-deduplicated product clicks.
ALTER TABLE deals ADD COLUMN IF NOT EXISTS toss_rank INTEGER;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS review_score NUMERIC;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS review_count INTEGER;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS is_popular BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS deal_clicks (
  deal_id BIGINT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  visitor_hash TEXT NOT NULL,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (deal_id, visitor_hash)
);
CREATE INDEX IF NOT EXISTS deal_clicks_time_idx ON deal_clicks(clicked_at);
CREATE TABLE IF NOT EXISTS toss_web_links (
  source_item_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'uncertain')),
  short_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE deal_clicks ADD COLUMN IF NOT EXISTS insert_marker TEXT;

CREATE TABLE IF NOT EXISTS deal_impressions (
  day DATE NOT NULL,
  deal_id BIGINT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  visitor_hash TEXT NOT NULL,
  section VARCHAR(32) NOT NULL,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (day, deal_id, visitor_hash, section)
);
CREATE INDEX IF NOT EXISTS deal_impressions_time_idx ON deal_impressions(seen_at);

CREATE TABLE IF NOT EXISTS deal_daily_metrics (
  day DATE NOT NULL,
  deal_id BIGINT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  section VARCHAR(32) NOT NULL,
  impressions BIGINT NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  clicks BIGINT NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  PRIMARY KEY (day, deal_id, section)
);
CREATE INDEX IF NOT EXISTS deal_daily_metrics_day_idx ON deal_daily_metrics(day);

CREATE TABLE IF NOT EXISTS cta_daily_events (
  day DATE NOT NULL,
  visitor_hash TEXT NOT NULL,
  placement VARCHAR(16) NOT NULL CHECK (placement IN ('hero', 'middle', 'mobile')),
  event VARCHAR(16) NOT NULL CHECK (event IN ('impression', 'click')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (day, visitor_hash, placement, event)
);
CREATE INDEX IF NOT EXISTS cta_daily_events_day_idx ON cta_daily_events(day);

-- Operator choices survive subsequent source refreshes.
CREATE TABLE IF NOT EXISTS deal_moderation (
  deal_id BIGINT PRIMARY KEY REFERENCES deals(id) ON DELETE CASCADE,
  is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  is_ended BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS automation_status (
  name TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Anonymous community. Public identities are random cookie tokens; only their
-- server-side HMAC values are persisted.
CREATE TABLE IF NOT EXISTS community_categories (
  id BIGSERIAL PRIMARY KEY,
  slug VARCHAR(48) NOT NULL UNIQUE,
  name VARCHAR(60) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO community_categories(slug,name,sort_order) VALUES
  ('phone','휴대폰 질문',10),
  ('deal-report','핫딜 제보',20),
  ('review','구매후기',30),
  ('free','자유',40)
ON CONFLICT(slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS community_posts (
  id BIGSERIAL PRIMARY KEY,
  category_id BIGINT NOT NULL REFERENCES community_categories(id),
  title VARCHAR(160) NOT NULL,
  body TEXT NOT NULL,
  nickname VARCHAR(24) NOT NULL DEFAULT 'ㅇㅇ',
  author_hash VARCHAR(64) NOT NULL,
  edit_password_hash TEXT,
  answer_requested BOOLEAN NOT NULL DEFAULT FALSE,
  answered_at TIMESTAMPTZ,
  views BIGINT NOT NULL DEFAULT 0 CHECK (views >= 0),
  upvotes INTEGER NOT NULL DEFAULT 0,
  downvotes INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0 CHECK (comment_count >= 0),
  is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS community_posts_list_idx ON community_posts(is_hidden,is_deleted,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS community_posts_category_idx ON community_posts(category_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS community_posts_answer_idx ON community_posts(answer_requested,answered_at,created_at DESC);
CREATE INDEX IF NOT EXISTS community_posts_title_idx ON community_posts(title);

CREATE TABLE IF NOT EXISTS community_comments (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  parent_comment_id BIGINT REFERENCES community_comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  nickname VARCHAR(24) NOT NULL DEFAULT 'ㅇㅇ',
  author_hash VARCHAR(64) NOT NULL,
  edit_password_hash TEXT,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  upvotes INTEGER NOT NULL DEFAULT 0,
  downvotes INTEGER NOT NULL DEFAULT 0,
  is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS community_comments_post_idx ON community_comments(post_id,created_at,id);

CREATE TABLE IF NOT EXISTS community_votes (
  target_type VARCHAR(12) NOT NULL CHECK (target_type IN ('post','comment')),
  target_id BIGINT NOT NULL,
  voter_hash VARCHAR(64) NOT NULL,
  value SMALLINT NOT NULL CHECK (value IN (-1,1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(target_type,target_id,voter_hash)
);
CREATE INDEX IF NOT EXISTS community_votes_target_idx ON community_votes(target_type,target_id);

CREATE TABLE IF NOT EXISTS community_post_views (
  post_id BIGINT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  viewer_hash VARCHAR(64) NOT NULL,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(post_id,viewer_hash)
);

CREATE TABLE IF NOT EXISTS community_reports (
  id BIGSERIAL PRIMARY KEY,
  target_type VARCHAR(12) NOT NULL CHECK (target_type IN ('post','comment')),
  target_id BIGINT NOT NULL,
  reporter_hash VARCHAR(64) NOT NULL,
  reason VARCHAR(300) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(target_type,target_id,reporter_hash)
);
CREATE INDEX IF NOT EXISTS community_reports_status_idx ON community_reports(status,created_at DESC);

CREATE TABLE IF NOT EXISTS community_banned_words (
  id BIGSERIAL PRIMARY KEY,
  word VARCHAR(100) NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS community_blocks (
  author_hash VARCHAR(64) PRIMARY KEY,
  reason VARCHAR(300) NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS community_settings (
  key VARCHAR(80) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO community_settings(key,value) VALUES
  ('rank_upvote_weight','8'),
  ('rank_downvote_weight','5'),
  ('rank_comment_weight','4'),
  ('rank_view_weight','0.125'),
  ('rank_age_power','0.55'),
  ('consultation_url','')
ON CONFLICT(key) DO NOTHING;
