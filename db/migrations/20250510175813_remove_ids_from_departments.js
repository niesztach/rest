/** @type {import('knex').Knex} */
export async function up(knex) {
    // FK w users->departments.id
    await knex.schema.alterTable('users', table => {
      table.dropForeign(['department_id']);
    });
  
    // slug jako nowy PK
    await knex.schema.alterTable('departments', table => {
      table.dropPrimary();      // usuniecie PK na id
      table.dropColumn('id');   // usuniecie id
      table.primary(['slug']);  // slug staje sie PK
    });
  
    // 3. FK w users->departments.slug
    await knex.schema.alterTable('users', table => {
      table
        .foreign('department_id')
        .references('departments.slug')
        .onDelete('SET NULL');
    });
  }
  
  export async function down(knex) {
    // rollback :
    await knex.schema.alterTable('users', table => {
      table.dropForeign(['department_id']);
    });
  
    // id z powrotem (jako string), ustawiamy PK
    await knex.schema.alterTable('departments', table => {
      table.string('id').primary();
      table.dropPrimary();           // usuń PK na slug
    });
  
    // ponownie FK do departments.id
    await knex.schema.alterTable('users', table => {
      table
        .foreign('department_id')
        .references('departments.id')
        .onDelete('SET NULL');
    });
  
    //  usuń slug
    await knex.schema.alterTable('departments', table => {
      table.dropColumn('slug');
      table.dropUnique(['name']);
    });
  }
  