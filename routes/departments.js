
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

// --- DEPARTMENTS ---
  router.get('/', async (req, res) => {
    const page = +req.query._page || 1;
    const limit = +req.query._limit || 10;
    const offset = (page - 1) * limit;
    const total = await db('departments').count('* as cnt').first();
    const list = await db('departments').select('*').limit(limit).offset(offset);
    res.set('X-Total-Count', total.cnt);
    res.json(list);
  });
  router.get('/id', async (req, res) => {
    const d = await db('departments').where('id', req.params.id).first();
    if (!d) return res.status(404).send('Department not found');
    res.set('ETag', genEtag(d));
    res.json(d);
  });

  router.post('/', async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'Name required' });
    const id = genId();
    await db('departments').insert({ id, name, updated_at: Date.now() });
    res.status(201).json({ id, name });
  });
  
  router.put('/id', async (req, res) => {
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
  router.delete('/id', async (req, res) => {
    const del = await db('departments').where('id', req.params.id).del();
    if (!del) return res.status(404).send();
    res.status(204).send();
  });

  // Nested users under dept
  router.get('/id/users', async (req, res) => {
    const users = await db('users').where('department_id', req.params.id);
    res.json(users);
  });
  router.put('/id/users/:userId', async (req, res) => {
    const upd = await db('users').where('id', req.params.userId).update({ department_id: req.params.id });
    if (!upd) return res.status(404).send();
    res.status(204).send();
  });
  router.delete('/id/users/:userId', async (req, res) => {
    const upd = await db('users').where('id', req.params.userId).update({ department_id: null });
    if (!upd) return res.status(404).send();
    res.status(204).send();
  });

export default router;