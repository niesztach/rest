
import { db } from '../db/db.js';
import express from 'express';
import { randomBytes, createHash } from 'node:crypto';


const genId = () => randomBytes(8).toString('hex');
const genEtag = obj => `"${createHash('md5').update(JSON.stringify(obj)).digest('hex')}"`;
// Idempotency: store processed POST keys
async function getIdempotency(key) {
  return db('idempotency_keys').where({ key }).first();
}
async function saveIdempotency(key, response) {
  await db('idempotency_keys').insert({
    key,
    status: response.status,
    body: JSON.stringify(response.body),
    created_at: Date.now()
  });
}
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

      // Właściwy update
      await trx('users').where('id', userId).update({ department_slug: toDept });

      // Tutaj testujemy rollback, jeśli przyszła flaga
      if (testFail) {
        throw new Error('Simulated failure after user update');
      }
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
  
    // 1) Pobierz usera i jego department_slug
    const user = await db('users').where('id', userId).first();
    if (!user) return res.status(404).send('User not found');
  
    // 2) Lista env_id, do których ten department należy
    const userEnvIds = await db('env_departments')
      .where('department_slug', user.department_slug)
      .pluck('env_id');
  
    if (!userEnvIds.includes(fromEnv) || !userEnvIds.includes(toEnv)) {
      return res.status(403).send('User does not have access to one of the environments');
    }
  
    // 3) Atomowy transfer
   try {
    await db.transaction(async trx => {
      if (fromEnv === toEnv) throw new Error('SameEnvironment');
      const task = await trx('tasks').where('id', taskId).first();
      if (!task) throw new Error('TaskNotFound');
      if (task.env_id !== fromEnv) throw new Error('BadSource');
      if (!await trx('envs').where('id', toEnv).first()) throw new Error('BadTarget');

      // Właściwy update
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
  

  export default router;