const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

test('애플리케이션 시작 migration은 기존 인덱스를 매번 삭제하거나 재생성하지 않는다', () => {
  assert.doesNotMatch(schema, /DROP INDEX/i);
  assert.match(schema, /CREATE INDEX IF NOT EXISTS deals_source_image_backfill_idx/i);
});
