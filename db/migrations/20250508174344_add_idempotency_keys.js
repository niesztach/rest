/** @type {import('knex').Knex} */
export async function up(knex) {
    await knex.schema.createTable('idempotency_keys', table => {
      table.string('key').primary();
      table.integer('status').notNullable();
      table.text('body').notNullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }
  
  /** @type {import('knex').Knex} */
  export async function down(knex) {
    await knex.schema.dropTableIfExists('idempotency_keys');
  }
  