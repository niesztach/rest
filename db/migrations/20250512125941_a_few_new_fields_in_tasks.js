/** @type {import('knex').Knex} */
export async function up(knex) {
    await knex.schema.alterTable('tasks', table => {
      table.string('status').defaultTo('open');
      table.string('author_id').notNullable();
      table.foreign('author_id').references('users.id').onDelete('CASCADE');
    });
  }
  
  /** @type {import('knex').Knex} */
  export async function down(knex) {
    await knex.schema.alterTable('tasks', table => {
      table.dropForeign(['author_id']);
      table.dropColumn('author_id');
      table.dropColumn('status');
    });
  }
  