/** @type {import('knex').Knex} */
import slugify from 'slugify'; //do polskich znakow
export async function up(knex) {
    await knex.schema.alterTable('departments', table => {
      table.string('slug');        
      table.unique('name');
    });
  
    const rows = await knex('departments').select('id', 'name');
    for (const { id, name } of rows) {
      const slug = slugify(name, {
        lower: true,
        locale: 'pl',
        strict: true
      });
      await knex('departments')
        .where('id', id)
        .update({ slug });
    }
  
    await knex.schema.alterTable('departments', table => {
      table.unique('slug');
    });
  }
  
  export async function down(knex) {
    await knex.schema.alterTable('departments', table => {
      table.dropUnique(['slug']);
      table.dropColumn('slug');
      table.dropUnique(['name']);
    });
  }
  