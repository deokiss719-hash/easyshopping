const { PGlite } = require('@electric-sql/pglite');
async function testPool() {
  const db = new PGlite();
  await db.waitReady;
  // One embedded PostgreSQL connection; serialize checked-out transactions and ordinary queries.
  let tail = Promise.resolve();
  async function acquire() {
    let release;
    const next = new Promise((r) => (release = r)),
      prev = tail;
    tail = next;
    await prev;
    return release;
  }
  const query = async (q, args) => (args ? db.query(q, args) : (await db.exec(q)).at(-1));
  return {
    async query(q, args) {
      const release = await acquire();
      try {
        return await query(q, args);
      } finally {
        release();
      }
    },
    async connect() {
      const release = await acquire();
      return { query, release };
    },
    async end() {
      await tail;
      await db.close();
    },
  };
}
module.exports = { testPool };
