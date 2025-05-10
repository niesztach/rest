/** @type {import('knex').Knex} */
export async function up(knex) {
    await knex.schema.alterTable('users', table => {
      // usuń stare FK
      table.dropForeign('department_id');
      table.renameColumn('department_id', 'department_slug');
      // FK: users.department_slug -> departments.slug
      table
        .foreign('department_slug')
        .references('departments.slug')
        .onDelete('SET NULL');
    });
  }
  
  export async function down(knex) {
    await knex.schema.alterTable('users', table => {
      table.dropForeign('department_slug');
      table.renameColumn('department_slug', 'department_id');
      table
        .foreign('department_id')
        .references('departments.id')
        .onDelete('SET NULL');
    });
  }
  