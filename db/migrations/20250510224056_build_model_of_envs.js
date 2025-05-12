/** @type {import('knex').Knex} */
export async function up(knex) {
    // tabele envs
    await knex.schema.createTable('envs', table => {
      table.string('id').primary();
      table.string('name').notNullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  
    // tabela wiele do wielu
    await knex.schema.createTable('env_departments', table => {
      table.string('env_id').notNullable();
      table.string('department_slug').notNullable();
      table.enu('role', ['owner','reporter','member'], { useNative: true, enumName: 'env_dept_roles' })
           .notNullable();
      table.timestamp('added_at').defaultTo(knex.fn.now());
      table.primary(['env_id', 'department_slug']); //unikalny klucz
      table.foreign('env_id').references('envs.id').onDelete('CASCADE');
      table.foreign('department_slug').references('departments.slug').onDelete('CASCADE');
    });
  
    // 3) Tasks table
    await knex.schema.createTable('tasks', table => {
      table.string('id').primary();
      table.string('env_id').notNullable();
      table.string('title').notNullable();
      table.text('description');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.foreign('env_id').references('envs.id').onDelete('CASCADE');
    });
  }
  
  /** @type {import('knex').Knex} */
  export async function down(knex) {
    await knex.schema.dropTableIfExists('tasks');
    await knex.schema.dropTableIfExists('env_departments');
    await knex.schema.dropTableIfExists('envs');
    await knex.raw('DROP TYPE IF EXISTS env_dept_roles');
  }