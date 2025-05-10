import express from 'express';
import { db } from './db/db.js';
import { initSchema } from './db/initSchema.js';
import { randomBytes, createHash } from 'node:crypto';

export const app = express();
app.use(express.json());

// Helpers
export const genId = () => randomBytes(8).toString('hex');
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

(async () => {
  // await initSchema();

  // --- USERS ---
  // GET /users?page & limit
  app.get('/users', async (req, res) => {
    const page = parseInt(req.query._page) || 1;
    const limit = parseInt(req.query._limit) || 10;
    const offset = (page - 1) * limit;
    const total = await db('users').count('* as cnt').first();
    const list = await db('users').select('*').limit(limit).offset(offset);
    res.set('X-Total-Count', total.cnt);
    res.json(list);
  });

  // GET single user
  app.get('/users/:id', async (req, res) => {
    const u = await db('users').where('id', req.params.id).first();
    if (!u) return res.status(404).send('User not found');
    res.set('ETag', genEtag(u));
    res.json(u);
  });

  // POST create user (idempotent)
  app.post('/users', async (req, res) => {
    const key = req.header('Idempotency-Key');
    if (key) {
      const existing = await getIdempotency(key);
      if (existing) return res.status(existing.status).json(JSON.parse(existing.body));
    }
    const { name, email } = req.body;
    if (!name) return res.status(400).json({ message: 'Name required' });
    const id = genId();
    await db('users').insert({ id, name, email, updated_at: Date.now() });
    const body = { id, name, email };
    if (key) await saveIdempotency(key, { status: 201, body });
    res.status(201).json(body);
  });

  // PUT update user (conditional)
  app.put('/users/:id', async (req, res) => {
    const ifMatch = req.header('If-Match');
    if (!ifMatch) return res.status(428).send('If-Match required');
    const u = await db('users').where('id', req.params.id).first();
    if (!u) return res.status(404).send('User not found');
    const etag = genEtag(u);
    if (ifMatch !== etag) return res.status(412).send('Precondition Failed');
    const { name, email } = req.body;
    await db('users').where('id', req.params.id).update({ name: name ?? u.name, email: email ?? u.email, updated_at: Date.now() });
    const updated = await db('users').where('id', req.params.id).first();
    res.set('ETag', genEtag(updated));
    res.json(updated);
  });

  // DELETE user
  app.delete('/users/:id', async (req, res) => {
    const deleted = await db('users').where('id', req.params.id).del();
    if (!deleted) return res.status(404).send('User not found');
    res.status(204).send();
  });

  // --- DEPARTMENTS ---
  app.get('/departments', async (req, res) => {
    const page = +req.query._page || 1;
    const limit = +req.query._limit || 10;
    const offset = (page - 1) * limit;
    const total = await db('departments').count('* as cnt').first();
    const list = await db('departments').select('*').limit(limit).offset(offset);
    res.set('X-Total-Count', total.cnt);
    res.json(list);
  });
  app.get('/departments/:id', async (req, res) => {
    const d = await db('departments').where('id', req.params.id).first();
    if (!d) return res.status(404).send('Department not found');
    res.set('ETag', genEtag(d));
    res.json(d);
  });
  app.post('/departments', async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'Name required' });
    const id = genId();
    await db('departments').insert({ id, name, updated_at: Date.now() });
    res.status(201).json({ id, name });
  });
  app.put('/departments/:id', async (req, res) => {
    const ifMatch = req.header('If-Match');
    if (!ifMatch) return res.status(428).send('If-Match required');
    const d = await db('departments').where('id', req.params.id).first();
    if (!d) return res.status(404).send();
    if (genEtag(d) !== ifMatch) return res.status(412).send();
    const { name } = req.body;
    await db('departments').where('id', req.params.id).update({ name: name ?? d.name, updated_at: Date.now() });
    const updated = await db('departments').where('id', req.params.id).first();
    res.set('ETag', genEtag(updated));
    res.json(updated);
  });
  app.delete('/departments/:id', async (req, res) => {
    const del = await db('departments').where('id', req.params.id).del();
    if (!del) return res.status(404).send();
    res.status(204).send();
  });

  // Nested users under dept
  app.get('/departments/:id/users', async (req, res) => {
    const users = await db('users').where('department_id', req.params.id);
    res.json(users);
  });
  app.put('/departments/:id/users/:userId', async (req, res) => {
    const upd = await db('users').where('id', req.params.userId).update({ department_id: req.params.id });
    if (!upd) return res.status(404).send();
    res.status(204).send();
  });
  app.delete('/departments/:id/users/:userId', async (req, res) => {
    const upd = await db('users').where('id', req.params.userId).update({ department_id: null });
    if (!upd) return res.status(404).send();
    res.status(204).send();
  });

  // --- ENVS and BOARDS ---
  app.get('/envs', async (req, res) => {
    const list = await db('envs').select('*');
    res.json(list);
  });
  app.post('/envs', async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'Name required' });
    const id = genId();
    await db('envs').insert({ id, name, updated_at: Date.now() });
    res.status(201).json({ id, name });
  });
  app.get('/envs/:id/boards', async (req, res) => {
    const boards = await db('boards').where('env_id', req.params.id);
    res.json(boards);
  });
  app.post('/envs/:id/boards', async (req, res) => {
    const { title } = req.body;
    if (!title) return res.status(400).json({ message: 'Title required' });
    const id = genId();
    await db('boards').insert({ id, env_id: req.params.id, title, updated_at: Date.now() });
    res.status(201).json({ id, env_id: req.params.id, title });
  });

  // --- ATOMIC ACTION: transfer user between departments ---
  app.post('/actions/transfer-user', async (req, res) => {
    const { userId, fromDept, toDept } = req.body;
    try {
      await db.transaction(async trx => {
        const u = await trx('users').where('id', userId).first();
        if (!u) throw new Error('UserNotFound');
        if (u.department_id !== fromDept) throw new Error('BadSource');
        await trx('users').where('id', userId).update({ department_id: toDept });
      });
      res.json({ message: 'Transfer success' });
    } catch (e) {
      console.error(e);
      res.status(400).json({ message: e.message });
    }
  });

    // GET all envs for a department
  app.get('/departments/:id/envs', async (req, res) => {
    const envs = await db('department_envs')
      .join('envs', 'envs.id', 'department_envs.env_id')
      .where('department_envs.department_id', req.params.id)
      .select('envs.*');
    res.json(envs);
  });

  // POST to associate department with env
  app.post('/departments/:depId/envs/:envId', async (req, res) => {
    await db('department_envs').insert({ department_id: req.params.depId, env_id: req.params.envId }).onConflict().ignore();
    res.status(204).send();
  });

  // DELETE association
  app.delete('/departments/:depId/envs/:envId', async (req, res) => {
    await db('department_envs')
      .where({ department_id: req.params.depId, env_id: req.params.envId })
      .del();
    res.status(204).send();
  });


  app.listen(1234, () => console.log('API listening on http://localhost:1234'));
})();
