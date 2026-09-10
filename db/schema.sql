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
  UNIQUE (source, source_item_id)
);

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT '기타';
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
