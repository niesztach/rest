
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
    const { userId, fromDept, toDept } = req.body;
    try {
      await db.transaction(async trx => {
        if (fromDept === toDept) throw new Error('SameDepartment');
        const user = await trx('users').where('id', userId).first();
        if (!user) throw new Error('UserNotFound');
        if (user.department_slug !== fromDept) throw new Error('BadSource');
        if (!await trx('departments').where('slug', toDept).first()) throw new Error('BadTarget');
        await trx('users').where('id', userId).update({ department_slug: toDept });
      });
      res.json({ message: 'Transfer success' });
    } catch (e) {
      console.error(e);
      res.status(400).json({ message: e.message });
    }
  });

  export default router;