// uruchamia migracje Knex-a w czasie działania aplikacji, dokładnie tak jak w terminalu
// npx knex migrate:latest
import { db } from './db.js';

export async function initSchema() {
  await db.migrate.latest();
}
