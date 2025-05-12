import express from 'express';
import { db } from './db/db.js';
import usersRoutes from './routes/users.js';
import departmentsRoutes from './routes/departments.js';
import envsRoutes from './routes/envs.js';
import actionsRoutes from './routes/actions.js';

//import departmentsRoutes from './routes/departments.js';
import { initSchema } from './db/initSchema.js';

const app = express();
app.use(express.json());



(async () => {
  await initSchema();

    // -------------- CLEANUP IDP KEYS ----------------
    const IDEMPOTENCY_TTL_MS = 10 * 1000;     // 30 sekund
    const CLEANUP_INTERVAL = 20 * 1000;      // co 60 sekund
  
    setInterval(async () => {
      const cutoff = new Date(Date.now() - IDEMPOTENCY_TTL_MS).toISOString();
      try {
        const count = await db('idempotency_keys')
          .where('created_at', '<', cutoff)
          .del();
        console.log(`Idempotency cleanup: usunięto ${count} kluczy starszych niż ${IDEMPOTENCY_TTL_MS/1000}s`);
      } catch (err) {
        console.error('Błąd podczas cleanup idempotency_keys:', err);
      }
    }, CLEANUP_INTERVAL);

  app.use('/users', usersRoutes);

  app.use('/departments', departmentsRoutes);

  app.use('/envs', envsRoutes);

  app.use('/actions', actionsRoutes);




})();

app.listen(1234, () => console.log('Server running on http://localhost:1234'));