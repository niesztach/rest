import express from 'express';
import { db } from './db/db.js';
import usersRoutes from './routes/users.js';
import departmentsRoutes from './routes/departments.js';
//import departmentsRoutes from './routes/departments.js';
import { initSchema } from './db/initSchema.js';

const app = express();
app.use(express.json());



(async () => {
  await initSchema();

  app.use('/users', usersRoutes);

  app.use('/departments', departmentsRoutes);


})();

app.listen(1234, () => console.log('Server running on http://localhost:1234'));