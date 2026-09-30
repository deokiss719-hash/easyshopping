CREATE TABLE IF NOT EXISTS saju_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), price INTEGER NOT NULL DEFAULT 4900 CHECK(price BETWEEN 100 AND 1000000),
 report_version TEXT NOT NULL DEFAULT 'ko-evidence-1', free_sections INTEGER NOT NULL DEFAULT 3 CHECK(free_sections BETWEEN 3 AND 4), sales_enabled BOOLEAN NOT NULL DEFAULT FALSE
);
INSERT INTO saju_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS saju_reports (
 id TEXT PRIMARY KEY, payload TEXT, owner_hash TEXT NOT NULL, recovery_hash TEXT UNIQUE NOT NULL,
 link_hash TEXT UNIQUE, link_expires TIMESTAMPTZ, session_hash TEXT, session_expires TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL,
 paid BOOLEAN NOT NULL DEFAULT FALSE, deleted_at TIMESTAMPTZ, fingerprint TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS saju_reports_expiry ON saju_reports(expires_at);
CREATE TABLE IF NOT EXISTS saju_orders (
 id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES saju_reports(id), amount INTEGER NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('demo','test','live')), status TEXT NOT NULL DEFAULT 'pending',
 payment_key TEXT UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), paid_at TIMESTAMPTZ,
 refund_requested_at TIMESTAMPTZ, refunded_at TIMESTAMPTZ, receipt_url TEXT,
 terms_version TEXT NOT NULL DEFAULT '2026-09-29', expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '30 minutes'
);
CREATE UNIQUE INDEX IF NOT EXISTS saju_one_open_order ON saju_orders(report_id) WHERE status IN ('pending','confirming','paid','refund_requested','refunding');
CREATE TABLE IF NOT EXISTS saju_events (
 day DATE NOT NULL, event TEXT NOT NULL, mode TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(day,event,mode)
);
CREATE TABLE IF NOT EXISTS saju_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at TIMESTAMPTZ NOT NULL);

ALTER TABLE saju_reports ADD COLUMN IF NOT EXISTS owner_expires TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '1 hour';
ALTER TABLE saju_orders ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01';

-- Apply the new narrator default once; keep stored/purchased report snapshots intact.
CREATE TABLE IF NOT EXISTS saju_content_migrations (version TEXT PRIMARY KEY);
-- Change only the original launch price; preserve any price already chosen by the operator.
WITH first_apply AS (
 INSERT INTO saju_content_migrations(version) VALUES('saju-launch-price-4900')
 ON CONFLICT(version) DO NOTHING RETURNING version
)
UPDATE saju_settings SET price=4900
WHERE id=1 AND price=6900 AND EXISTS(SELECT 1 FROM first_apply);

-- Merchant-approved launch switch. Beta runtime still takes precedence until live keys are ready.
WITH first_apply AS (
 INSERT INTO saju_content_migrations(version) VALUES('saju-sales-launch-4900')
 ON CONFLICT(version) DO NOTHING RETURNING version
)
UPDATE saju_settings SET sales_enabled=TRUE
WHERE id=1 AND price=4900 AND EXISTS(SELECT 1 FROM first_apply);
WITH first_apply AS (
 INSERT INTO saju_content_migrations(version) VALUES('ko-grandmother-2')
 ON CONFLICT(version) DO NOTHING RETURNING version
)
UPDATE saju_settings SET report_version='ko-grandmother-2'
WHERE id=1 AND report_version='ko-evidence-1' AND EXISTS(SELECT 1 FROM first_apply);

WITH first_apply AS (
 INSERT INTO saju_content_migrations(version) VALUES('ko-depth-3')
 ON CONFLICT(version) DO NOTHING RETURNING version
)
UPDATE saju_settings SET report_version='ko-depth-3'
WHERE id=1 AND report_version IN ('ko-evidence-1','ko-grandmother-2') AND EXISTS(SELECT 1 FROM first_apply);

-- A new default only; never rewrite encrypted snapshots or existing orders.
WITH first_apply AS (
 INSERT INTO saju_content_migrations(version) VALUES('ko-pattern-4')
 ON CONFLICT(version) DO NOTHING RETURNING version
)
UPDATE saju_settings SET report_version='ko-pattern-4'
WHERE id=1 AND EXISTS(SELECT 1 FROM first_apply);

WITH first_apply AS (
 INSERT INTO saju_content_migrations(version) VALUES('ko-story-5')
 ON CONFLICT(version) DO NOTHING RETURNING version
)
UPDATE saju_settings SET report_version='ko-story-5'
WHERE id=1 AND EXISTS(SELECT 1 FROM first_apply);

WITH first_apply AS (
 INSERT INTO saju_content_migrations(version) VALUES('ko-grandmother-story-6')
 ON CONFLICT(version) DO NOTHING RETURNING version
)
UPDATE saju_settings SET report_version='ko-grandmother-story-6'
WHERE id=1 AND EXISTS(SELECT 1 FROM first_apply);

WITH first_apply AS (
 INSERT INTO saju_content_migrations(version) VALUES('ko-simple-story-7')
 ON CONFLICT(version) DO NOTHING RETURNING version
)
UPDATE saju_settings SET report_version='ko-simple-story-7'
WHERE id=1 AND EXISTS(SELECT 1 FROM first_apply);

-- New analysis only; encrypted reports/orders remain unchanged.
WITH first_apply AS (
 INSERT INTO saju_content_migrations(version) VALUES('ko-whole-chart-8')
 ON CONFLICT(version) DO NOTHING RETURNING version
)
UPDATE saju_settings SET report_version='ko-whole-chart-8'
WHERE id=1 AND EXISTS(SELECT 1 FROM first_apply);

-- New narrative revision; preserve previously saved reports and orders.
WITH first_apply AS (
 INSERT INTO saju_content_migrations(version) VALUES('ko-context-story-9')
 ON CONFLICT(version) DO NOTHING RETURNING version
)
UPDATE saju_settings SET report_version='ko-context-story-9'
WHERE id=1 AND EXISTS(SELECT 1 FROM first_apply);

-- Existing snapshots remain readable after a future paid rollout.
ALTER TABLE saju_reports ADD COLUMN IF NOT EXISTS beta_access BOOLEAN NOT NULL DEFAULT FALSE;
WITH first_apply AS (
 INSERT INTO saju_content_migrations(version) VALUES('beta-access-preservation-1')
 ON CONFLICT(version) DO NOTHING RETURNING version
)
UPDATE saju_reports SET beta_access=TRUE
WHERE EXISTS(SELECT 1 FROM first_apply)
AND NOT EXISTS(SELECT 1 FROM saju_orders WHERE report_id=saju_reports.id);

-- New reports use the revised narrator; no existing encrypted report is rewritten.
WITH first_apply AS (
 INSERT INTO saju_content_migrations(version) VALUES('ko-lived-story-10')
 ON CONFLICT(version) DO NOTHING RETURNING version
)
UPDATE saju_settings SET report_version='ko-lived-story-10'
WHERE id=1 AND EXISTS(SELECT 1 FROM first_apply);
