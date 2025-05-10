
import { db } from '../db/db.js';
import express from 'express';
import { randomBytes, createHash } from 'node:crypto';
import slugify from 'slugify';


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

  router.get('/:slug', async (req, res) => {
    const d = await db('departments').where('slug', req.params.slug).first();
    if (!d) return res.status(404).send('Department not found');
    res.set('ETag', genEtag(d));
    res.json(d);
  });

  //POST create department (idempotent)
  router.post('/', async (req, res) => {
    const key = req.header('Idempotency-Key');
    if (key) {
      const existing = await getIdempotency(key);
      if (existing) return res.status(existing.status).json(JSON.parse(existing.body));
    }
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'Name required' });
    const id = genId();
    const slug = slugify(name, { lower: true, locale: 'pl', strict: true });
    await db('departments').insert({ slug, name, updated_at: Date.now() });
    const body = { slug, name };
    if (key) await saveIdempotency(key, { status: 201, body });
    res.status(201).json(body);
  });
  

  router.delete('/:slug', async (req, res) => {
    const count = await db('users').where('department_slug', req.params.slug).count('* as cnt').first();
    if (count.cnt > 0) return res.status(409).json({ message: 'Department not empty' });
    const del = await db('departments').where('slug', req.params.slug).del();
    if (!del) return res.status(404).send();
    res.status(204).send();
  });

  // Nested users under dept
  router.get('/:slug/users', async (req, res) => {
    const users = await db('users').where('department_slug', req.params.slug);
    res.json(users);
  });

  router.put('/:slug/users/:userId', async (req, res) => {
    const upd = await db('users').where('id', req.params.userId).update({ department_slug: req.params.slug });
    if (!upd) return res.status(404).send();
    res.status(204).send();
  });

  router.delete('/:slug/users/:userId', async (req, res) => {
    const upd = await db('users').where('id', req.params.userId).update({ department_slug: null });
    if (!upd) return res.status(404).send();
    res.status(204).send();
  });

export default router;