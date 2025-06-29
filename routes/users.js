
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


  // POST create user (idempotent)
  router.post('/', async (req, res) => {
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

  // GET single user
  router.get('/:id', async (req, res) => {
    const u = await db('users').where('id', req.params.id).first();
    if (!u) return res.status(404).send('User not found');
    res.set('ETag', genEtag(u));
    res.json(u);
  });

  // GET /users?page & limit
  router.get('/', async (req, res) => {
    const page = parseInt(req.query._page) || 1;
    const limit = parseInt(req.query._limit) || 10;
    const offset = (page - 1) * limit;
    const total = await db('users').count('* as cnt').first();
    const list = await db('users').select('*').limit(limit).offset(offset);
    res.set('X-Total-Count', total.cnt);
    res.json(list);
  });


  // PUT update user (ETag)
  router.put('/:id', async (req, res) => {
    // LOST UPDATE PROTECTION
    const ifMatch = req.header('If-Match');
    if (!ifMatch) return res.status(428).send('If-Match required');
    // check if user exists
    const u = await db('users').where('id', req.params.id).first();
    if (!u) return res.status(404).send('User not found');
    // check etag
    const etag = genEtag(u);
    if (ifMatch !== etag) return res.status(412).send('Precondition Failed');
    // get item from request body
    const { name, email } = req.body;
    await db('users').where('id', req.params.id).update({ name: name ?? u.name, email: email ?? u.email, updated_at: Date.now() });
    const updated = await db('users').where('id', req.params.id).first();
    res.set('ETag', genEtag(updated));
    res.json(updated);
  });

//   //PATCH update user (department)
//   router.patch('/:id', async (req, res) => {
//   const ifMatch = req.header('If-Match');
//   if (!ifMatch) return res.status(428).send('If-Match required');
//   // get user from db
//   const user = await db('users').where('id', req.params.id).first();
//   if (!user) return res.status(404).send('User not found');
//   // does he have any tasks?
//   const author = await db('tasks').where('author_id', req.params.id).first();
//   if (author) return res.status(409).json({ message: 'User is author of task' });
//   // check etag
//   const etag = genEtag(user);
//   if (ifMatch !== etag) return res.status(412).send('Precondition Failed');
//   // get department slug from request body
//   const { slug } = req.body;
//   if (!slug) return res.status(400).json({ message: 'Department name required' });
//   // check if department exists
//   const department = await db('departments').where('slug', slug).first();
//   if (!department) return res.status(400).json({ message: 'Invalid Department name' });
//   // update
//   await db('users').where('id', req.params.id).update({
//     department_slug: slug,
//     updated_at: Date.now()
//   });
//   // generate new etag
//   const updatedUser = await db('users').where('id', req.params.id).first();
//   res.set('ETag', genEtag(updatedUser));

//   res.json(updatedUser);
// });

  // DELETE user
  router.delete('/:id', async (req, res) => {
  // does he have any tasks?
  const author = await db('tasks').where('author_id', req.params.id).first();
  if (author) return res.status(409).json({ message: 'User is author of task' });

  // check if user exists
  const deleted = await db('users').where('id', req.params.id).del();
  if (!deleted) return res.status(404).send('User not found');
  res.status(204).send();
  });

  export default router;