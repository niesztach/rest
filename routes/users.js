
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


  // PUT update user (conditional)
  router.put('/:id', async (req, res) => {
    // LOST UPDATE PROTECTION
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

//   // PATCH update user (unconditional)
//   router.patch('/:id', async (req, res) => {
//     const { name, email } = req.body;
//     await db('users').where('id', req.params.id).update({ name, email });
//     const updated = await db('users').where('id', req.params.id).first();
//     res.json(updated);
//   });

  //PATCH update user (department)
  router.patch('/:id', async (req, res) => {
  const ifMatch = req.header('If-Match');
  if (!ifMatch) return res.status(428).send('If-Match required');
  // Pobierz użytkownika z bazy danych
  const user = await db('users').where('id', req.params.id).first();
  if (!user) return res.status(404).send('User not found');
  // Wygeneruj ETag dla bieżącego stanu użytkownika
  const etag = genEtag(user);
  if (ifMatch !== etag) return res.status(412).send('Precondition Failed');
  // Pobierz department_id z body żądania
  const { department_id } = req.body;
  if (!department_id) return res.status(400).json({ message: 'Department ID required' });
  // Opcjonalnie: Sprawdź, czy department_id istnieje w tabeli departments
  const department = await db('departments').where('id', department_id).first();
  if (!department) return res.status(400).json({ message: 'Invalid Department ID' });
  // Zaktualizuj użytkownika w bazie danych
  await db('users').where('id', req.params.id).update({
    department_id,
    updated_at: Date.now()
  });

  // Pobierz zaktualizowanego użytkownika
  const updatedUser = await db('users').where('id', req.params.id).first();

  // Ustaw nowy ETag i zwróć zaktualizowanego użytkownika
  res.set('ETag', genEtag(updatedUser));
  res.json(updatedUser);
});

  // DELETE user
  router.delete('/:id', async (req, res) => {
    const deleted = await db('users').where('id', req.params.id).del();
    if (!deleted) return res.status(404).send('User not found');
    res.status(204).send();
  });

  export default router;