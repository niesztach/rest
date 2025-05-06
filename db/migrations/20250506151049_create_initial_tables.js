/** @type {import('knex').Knex} */
export async function up(knex) {
    await knex.schema
      .createTable('users', table => {
        table.string('id').primary();
        table.string('name').notNullable();
        table.string('department_id').references('departments.id');
        table.timestamp('updated_at').defaultTo(knex.fn.now());
      })
      .createTable('departments', table => {
        table.string('id').primary();
        table.string('name').notNullable();
        table.timestamp('updated_at').defaultTo(knex.fn.now());
      });
    // … kolejne tabele …
  }
  
  /** @type {import('knex').Knex} */
  export async function down(knex) {
    await knex.schema
      .dropTableIfExists('department_envs')
      .dropTableIfExists('envs')
      .dropTableIfExists('departments')
      .dropTableIfExists('users');
  }