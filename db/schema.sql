CREATE TABLE IF NOT EXISTS deals (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  source_item_id TEXT NOT NULL,
  title TEXT NOT NULL,
  price_text TEXT,
  price_amount BIGINT CHECK (price_amount IS NULL OR price_amount >= 0),
  merchant TEXT,
  original_url TEXT NOT NULL,
  image_url TEXT,
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

CREATE INDEX IF NOT EXISTS deals_published_at_idx ON deals (published_at DESC);
CREATE INDEX IF NOT EXISTS deals_source_idx ON deals (source);
CREATE INDEX IF NOT EXISTS deals_active_idx ON deals (is_ended, published_at DESC);

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
