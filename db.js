import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import knex from 'knex';
import config from '../knexfile.js';


// Otwarcie pliku bazy data.db (utworzy jeśli nie istnieje)
export async function makeDb() {
  const db = await open({
    filename: './data/data.db',
    driver: sqlite3.Database
  });

  // Ustaw tryb walidacji foreign key
  await db.exec('PRAGMA foreign_keys = ON');

  return db;
}

export const db = knex(config.development);