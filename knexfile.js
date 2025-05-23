// Update with your config settings.

/**
 * @type { Object.<string, import("knex").Knex.Config> }
 */
const config = {
  development: {
    client: 'sqlite3',
    connection: {
      filename: './data/data.db' // Zmieniono ścieżkę do pliku SQLite
    },
    useNullAsDefault: true // Dodano, aby uniknąć ostrzeżeń SQLite
  },

  staging: {
    client: 'postgresql',
    connection: {
      database: 'my_db',
      user:     'username',
      password: 'password'
    },
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      tableName: 'knex_migrations'
    }
  },

  production: {
    client: 'postgresql',
    connection: {
      database: 'my_db',
      user:     'username',
      password: 'password'
    },
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      tableName: 'knex_migrations'
    }
  }
};

export default {
  development: {
    client: 'sqlite3',
    connection: {
      // Jedno wywołanie: plik bazy będzie w folderze data
      filename: './data/data.db'
    },
    useNullAsDefault: true,
    migrations: {
      // Tutaj Knex będzie szukał migracji
      directory: './db/migrations'
    }
  }
};
