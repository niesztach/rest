
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

  // Get /departments?page & limit
  router.get('/', async (req, res) => {
    const page = +req.query._page || 1;
    const limit = +req.query._limit || 10;
    const offset = (page - 1) * limit;
    const total = await db('departments').count('* as cnt').first();
    const list = await db('departments').select('*').limit(limit).offset(offset);
    res.set('X-Total-Count', total.cnt);
    res.json(list);
  });

  // Get single department 
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
    const slug = slugify(name, { lower: true, locale: 'pl', strict: true });
    await db('departments').insert({ slug, name, updated_at: Date.now() });
    const body = { slug, name };
    if (key) await saveIdempotency(key, { status: 201, body });
    res.status(201).json(body);
  });
  

  // DELETE department
  router.delete('/:slug', async (req, res) => {
    const count = await db('users').where('department_slug', req.params.slug).count('* as cnt').first();
    if (count.cnt > 0) return res.status(409).json({ message: 'Department not empty' });
    const del = await db('departments').where('slug', req.params.slug).del();
    if (!del) return res.status(404).send();
    res.status(204).send();
  });

  // GET nested users under dept
  router.get('/:slug/users', async (req, res) => {
    const d = await db('departments').where('slug', req.params.slug).first();
    if (!d) return res.status(404).send('Department not found');
    // get users in department
    const users = await db('users').where('department_slug', req.params.slug).select('*');
    res.json(users);
  });

  // POST user to department
  router.post('/:slug/users/:userId', async (req, res) => {
    // does he have any tasks?
    const author = await db('tasks').where('author_id', req.params.userId).first();
    if (author) return res.status(409).json({ message: 'User is author of task' });
    // update user department
    const upd = await db('users').where('id', req.params.userId).update({ department_slug: req.params.slug });
    if (!upd) return res.status(404).send();
    res.status(204).send();
  });

  // DELETE user from department
  router.delete('/:slug/users/:userId', async (req, res) => {
     // does he have any tasks?
    const author = await db('tasks').where('author_id', req.params.userId).first();
    if (author) return res.status(409).json({ message: 'User is author of task' });
    const upd = await db('users').where('id', req.params.userId).update({ department_slug: null });
    if (!upd) return res.status(404).send();
    res.status(204).send();
  });

  // Redirect to users/:userId
  router.get('/:slug/users/:userId', (req, res) => {
      res.redirect(307, `/users/${req.params.userId}`);
  });
  

  // routes/departments.js

router.get('/:slug/envs', async (req, res) => {
    const { slug } = req.params;
  
    const envs = await db('envs')
      .join('env_departments', 'envs.id', 'env_departments.env_id')
      .where('env_departments.department_slug', slug)
      .select('envs.*', 'env_departments.role');
  
    res.json(envs);
  });
  

export default router;