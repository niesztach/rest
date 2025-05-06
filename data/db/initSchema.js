import { makeDb } from '../../db.js';

export async function initSchema() {
  const db = await makeDb();

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      department_id TEXT,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(department_id) REFERENCES departments(id)
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  // ... pozostałe tabele ...
}

// Jeśli ktoś odpali `node src/db/initSchema.js` bezpośrednio:
if (import.meta.url === `file://${process.cwd()}/src/db/initSchema.js`) {
  initSchema()
    .then(() => { console.log('Schema initialized'); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
