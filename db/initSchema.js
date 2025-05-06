// src/db/initSchema.js
import { db } from './db.js';

export async function initSchema() {
  await db.migrate.latest();
}
