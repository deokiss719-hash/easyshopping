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
  image_status TEXT NOT NULL DEFAULT 'missing_merchant_url',
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
ALTER TABLE deals ADD COLUMN IF NOT EXISTS image_status TEXT NOT NULL DEFAULT 'missing_merchant_url';
ALTER TABLE deals ADD COLUMN IF NOT EXISTS image_provider TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS image_failure_code TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS image_retry_at TIMESTAMPTZ;

UPDATE deals
SET image_status = 'ready'
WHERE image_url IS NOT NULL AND image_status = 'missing_merchant_url';

CREATE INDEX IF NOT EXISTS deals_published_at_idx ON deals (published_at DESC);
CREATE INDEX IF NOT EXISTS deals_source_idx ON deals (source);
CREATE INDEX IF NOT EXISTS deals_active_idx ON deals (is_ended, published_at DESC);
CREATE INDEX IF NOT EXISTS deals_image_backfill_idx ON deals (image_status, image_retry_at)
  WHERE image_url IS NULL AND merchant_url IS NOT NULL;

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
