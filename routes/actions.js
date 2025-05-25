
import { db } from '../db/db.js';
import express from 'express';
import { randomBytes, createHash } from 'node:crypto';


const router = express.Router();

  // --- ATOMIC ACTION: transfer user between departments ---
router.post('/transfer-user', async (req, res) => {
  const { userId, fromDept, toDept, testFail } = req.body;
  try {
    await db.transaction(async trx => {
      if (fromDept === toDept) throw new Error('SameDepartment');
      const user = await trx('users').where('id', userId).first();
      if (!user) throw new Error('UserNotFound');
      if (user.department_slug !== fromDept) throw new Error('BadSource');
      if (!await trx('departments').where('slug', toDept).first()) throw new Error('BadTarget');

      // SPRAWDŹ, CZY JEST AUTOREM JAKIEGOŚ TASKA
      const isAuthor = await trx('tasks').where('author_id', userId).first();
      if (isAuthor) throw new Error('UserIsAuthorOfTask');

      // Właściwy update
      await trx('users').where('id', userId).update({ department_slug: toDept });
    });
    res.json({ message: 'Transfer success' });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});


  // --- ATOMIC ACTION: transfer task between environments ---

  router.post('/transfer-task', async (req, res) => {
    const { taskId, fromEnv, toEnv} = req.body;
    const userId = req.header('User-ID');
    if (!userId) return res.status(400).send('Missing User-ID header');
  
    const user = await db('users').where('id', userId).first();
    if (!user) return res.status(404).send('User not found');
  
    // env_id in department
    const userEnvIds = await db('env_departments')
      .where('department_slug', user.department_slug)
      .pluck('env_id');
  
    if (!userEnvIds.includes(fromEnv) || !userEnvIds.includes(toEnv)) {
      return res.status(403).send('User does not have access to one of the environments');
    }
  
    // transfer
   try {
    await db.transaction(async trx => {
      if (fromEnv === toEnv) throw new Error('SameEnvironment');
      const task = await trx('tasks').where('id', taskId).first();
      if (!task) throw new Error('TaskNotFound');
      if (task.env_id !== fromEnv) throw new Error('BadSource');
      if (!await trx('envs').where('id', toEnv).first()) throw new Error('BadTarget');

      // update
      await trx('tasks')
        .where({ id: taskId })
        .update({
          env_id:     toEnv,
          author_id:  userId,
          status:     'moved',
          updated_at: Date.now()
        });

    });

    res.json({ message: 'Transfer success' });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

// transakcja łączenia dwóch działów

router.post('/merge-departments', async (req, res) => {
  const { fromDept, toDept } = req.body;
  try {
    await db.transaction(async trx => {
      if (fromDept === toDept) throw new Error('SameDepartment');
      const from = await trx('departments').where('slug', fromDept).first();
      const to = await trx('departments').where('slug', toDept).first();
      if (!from || !to) throw new Error('DepartmentNotFound');

      // check if any user is author of task
      const author = await trx('tasks').where('author_id', from.id).first();
      if (author) throw new Error('UserIsAuthorOfTask');

      // update users
      await trx('users')
        .where('department_slug', fromDept)
        .update({ department_slug: toDept });

      // delete old department
      await trx('departments').where('slug', fromDept).del();
    });
    res.json({ message: 'Merge success' });
  } catch (e) {
    res.status(400).json({ message: e.message });
  } 
}
);  


  export default router;