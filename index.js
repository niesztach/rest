import express from 'express';
import { db } from './db/db.js';
import { initSchema } from './db/initSchema.js';
import { randomBytes, createHash } from 'node:crypto';

const genId = () => randomBytes(8).toString('hex');
const genEtag = obj =>
  `"${createHash('md5').update(JSON.stringify(obj)).digest('hex')}"`;

async function main() {
  // Utworzenie schematu (tabele) jeśli nie istnieją
  await initSchema();

  const app = express();
  app.use(express.json());

  // --- USERS CRUD ---

  // GET /users?_page&_limit
  app.get('/users', async (req, res) => {
    const page  = parseInt(req.query._page)  || 1;
    const limit = parseInt(req.query._limit)|| 10;
    const offset = (page - 1) * limit;

    const totalRow = await db('users').count('id as cnt').first();
    const users    = await db('users')
                          .select('*')
                          .orderBy('name')
                          .limit(limit)
                          .offset(offset);

    res.set('X-Total-Count', totalRow.cnt);
    res.json(users);
  });

  // GET /users/:userId
  app.get('/users/:userId', async (req, res) => {
    const u = await db('users').where('id', req.params.userId).first();
    if (!u) return res.status(404).send('User not found');
    res.set('ETag', genEtag(u));
    res.json(u);
  });

  // POST /users
  app.post('/users', async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'Name required' });

    const id  = genId();
    const now = Date.now();
    try {
      await db('users').insert({ id, name, updated_at: now });
      res.status(201).json({ id, name });
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: 'DB error' });
    }
  });

  // PUT /users/:userId
  app.put('/users/:userId', async (req, res) => {
    const clientEtag = req.get('If-Match');
    if (!clientEtag) return res.status(428).send('If-Match required');

    const u = await db('users').where('id', req.params.userId).first();
    if (!u) return res.status(404).send('User not found');

    const serverEtag = genEtag(u);
    if (clientEtag !== serverEtag) {
      return res.status(412).send('Precondition Failed');
    }

    const { name } = req.body;
    const now = Date.now();
    try {
      await db('users')
        .where('id', req.params.userId)
        .update({ name: name ?? u.name, updated_at: now });
      const updated = await db('users').where('id', req.params.userId).first();
      res.set('ETag', genEtag(updated));
      res.json(updated);
    } catch (e) {
      console.error(e);
      res.status(500).send('DB error');
    }
  });

  // DELETE /users/:userId
  app.delete('/users/:userId', async (req, res) => {
    const count = await db('users')
                        .where('id', req.params.userId)
                        .del();
    if (count === 0) return res.status(404).send('User not found');
    res.status(204).send();
  });

  // tutaj dodaj pozostałe route'y dla departments, envs, itp.

  app.listen(1234, () => console.log('Server running on http://localhost:1234'));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
