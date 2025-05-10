/** @type {import('knex').Knex} */
export async function up(knex) {
  await knex.schema.table('users', table => {
    table.string('email').nullable();
  });
}

/** @type {import('knex').Knex} */
export async function down(knex) {
  await knex.schema.table('users', table => {
    table.dropColumn('email');
  });
}
  