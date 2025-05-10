
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

  // --- ENVS and BOARDS ---
  router.get('/envs', async (req, res) => {
    const list = await db('envs').select('*');
    res.json(list);
  });
  router.post('/envs', async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'Name required' });
    const id = genId();
    await db('envs').insert({ id, name, updated_at: Date.now() });
    res.status(201).json({ id, name });
  });
  router.get('/envs/:id/boards', async (req, res) => {
    const boards = await db('boards').where('env_id', req.params.id);
    res.json(boards);
  });
  router.post('/envs/:id/boards', async (req, res) => {
    const { title } = req.body;
    if (!title) return res.status(400).json({ message: 'Title required' });
    const id = genId();
    await db('boards').insert({ id, env_id: req.params.id, title, updated_at: Date.now() });
    res.status(201).json({ id, env_id: req.params.id, title });
  });

export default router;