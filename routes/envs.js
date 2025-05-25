import { db } from '../db/db.js';
import express from 'express';
import { randomBytes } from 'node:crypto';

const genId = () => randomBytes(8).toString('hex');

// Idempotency helpers
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

export const router = express.Router();

// Create env
router.post('/', async (req, res) => {
  const id = genId();
  const key = req.header('Idempotency-Key');
  if (!key) return res.status(400).json({ message: 'Idempotency-Key header required' });
  const existing = await getIdempotency(key);
  if (existing) return res.status(existing.status).json(JSON.parse(existing.body));

  const { name, ownerDept } = req.body;
  if (!name || !ownerDept) return res.status(400).json({ message: 'Name and ownerDept required' });

  const isDept = await db('departments').where('slug', ownerDept).first();
  if (!isDept) return res.status(404).json({ message: 'Department not found' });

  try {
    await db.transaction(async trx => {
      await trx('envs').insert({ id, name });
      await trx('env_departments').insert({ env_id: id, department_slug: ownerDept, role: 'owner' });
      // throw new Error('Simulated failure after env creation'); // symulacja błędu
      await trx('idempotency_keys').insert({
        key,
        status: 201,
        body: JSON.stringify({ id, name }),
        created_at: Date.now()
      });
    });
    res.status(201).json({ id, name });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

// Get departments for env
router.get('/:envId/departments', async (req, res) => {
  const { envId } = req.params;
  const envs = await db('env_departments')
    .join('departments', 'env_departments.department_slug', 'departments.slug')
    .where('env_departments.env_id', envId)
    .select('departments.*', 'env_departments.role');
  return res.json(envs);
});

// Get envs, optionally filtered by department
router.get('/', async (req, res) => {
  const deptSlug = req.header('Department-Slug');
  if (deptSlug) {
    const envs = await db('envs')
      .join('env_departments', 'envs.id', 'env_departments.env_id')
      .where('env_departments.department_slug', deptSlug)
      .select('envs.*', 'env_departments.role');
    return res.json(envs);
  } else {
    const envs = await db('envs').select('*');
    return res.json(envs);
  }
});


// teoretycznie tez mogloby byc put
// Add department to env
router.post('/:envId/departments', async (req, res) => {
  const requesterDept = req.header('Owner-Slug');
  const { envId } = req.params;
  const { deptSlug, role } = req.body;

  if (!requesterDept) return res.status(400).json({ message: 'Missing Owner-Slug header' });
  if (!deptSlug || !role) return res.status(400).json({ message: 'deptSlug and role required' });

  const access = await db('env_departments')
    .where({ env_id: envId, department_slug: requesterDept })
    .first();
  if (!access || access.role !== 'owner') {
    return res.status(403).json({ message: 'Only owner can add departments to this env' });
  }

  const exists = await db('env_departments')
    .where({ env_id: envId, department_slug: deptSlug })
    .first();
  if (exists) {
    return res.status(409).json({ message: 'This department is already assigned to the env' });
  }

  const validRoles = ['owner', 'reporter', 'member'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ message: 'Invalid role' });
  }

  await db('env_departments').insert({
    env_id: envId,
    department_slug: deptSlug,
    role
  });

  res.status(204).send();
});

// Update department role in env
router.patch('/:envId/departments/:deptSlug', async (req, res) => {
  const requesterDept = req.header('Owner-Slug');
  const { envId, deptSlug } = req.params;
  const { role } = req.body;

  if (!requesterDept) return res.status(400).json({ message: 'Missing Owner-Slug header' });
  if (!role) return res.status(400).json({ message: 'Role required' });

  const access = await db('env_departments')
    .where({ env_id: envId, department_slug: requesterDept })
    .first();
  if (!access || access.role !== 'owner') {
    return res.status(403).json({ message: 'Only owner can update departments in this env' });
  }

  const exists = await db('env_departments')
    .where({ env_id: envId, department_slug: deptSlug })
    .first();
  if (!exists) {
    return res.status(404).json({ message: 'Department not found in this env' });
  }

  if (deptSlug === requesterDept) {
    return res.status(409).json({ message: 'Cannot update own department role' });
  }

  // Prevent demotion if department has tasks
  const userIds = await db('users').where('department_slug', deptSlug).pluck('id');
  const taskCount = await db('tasks')
    .where({ env_id: envId })
    .whereIn('author_id', userIds)
    .count({ cnt: '*' })
    .first();
  if (taskCount.cnt > 0 && role === 'member') {
    return res.status(409).json({ message: 'Cannot demote department with existing tasks' });
  }

  const validRoles = ['owner', 'reporter', 'member'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ message: 'Invalid role' });
  }

  await db('env_departments')
    .where({ env_id: envId, department_slug: deptSlug })
    .update({ role });

  res.status(204).send();
});

// Remove department from env
router.delete('/:envId/departments/:deptSlug', async (req, res) => {
  const requesterDept = req.header('Owner-Slug');
  const { envId, deptSlug } = req.params;

  if (!requesterDept) return res.status(400).json({ message: 'Missing Owner-Slug header' });

  const access = await db('env_departments')
    .where({ env_id: envId, department_slug: requesterDept })
    .first();
  if (!access || access.role !== 'owner') {
    return res.status(403).json({ message: 'Only owner can remove departments from this env' });
  }

  const exists = await db('env_departments')
    .where({ env_id: envId, department_slug: deptSlug })
    .first();
  if (!exists) {
    return res.status(404).json({ message: 'Department not found in this env' });
  }

  if (deptSlug === requesterDept) {
    const remainingOwners = await db('env_departments')
      .where({ env_id: envId, role: 'owner' });
    if (remainingOwners.length === 1) {
      return res.status(409).json({ message: 'Cannot left env without owner' });
    }
  }

  await db('env_departments')
    .where({ env_id: envId, department_slug: deptSlug })
    .del();

  res.status(204).send();
});

// Delete env and all relations
router.delete('/:envId', async (req, res) => {
  const requesterDept = req.header('Owner-Slug');
  const { envId } = req.params;

  if (!requesterDept) return res.status(400).json({ message: 'Missing Owner-Slug header' });
  if (!envId) return res.status(400).json({ message: 'Env ID required' });

  const access = await db('env_departments')
    .where({ env_id: envId, department_slug: requesterDept })
    .first();
  if (!access || access.role !== 'owner') {
    return res.status(403).json({ message: 'Only owner can remove env' });
  }

  const envExists = await db('envs').where('id', envId).first();
  if (!envExists) return res.status(404).json({ message: 'Env not found' });

  await db.transaction(async trx => {
    await trx('env_departments').where('env_id', envId).del();
    await trx('tasks').where('env_id', envId).del();
    await trx('envs').where('id', envId).del();
  });

  res.status(204).send();
});

//########### tasks ###########################

// Create task in env
router.post('/:envId/tasks', async (req, res) => {
  const key = req.header('Idempotency-Key');
  const userPoster = req.header('User-ID');
  const { envId } = req.params;
  const { title, description } = req.body;

  if (!key) return res.status(400).json({ message: 'Idempotency-Key header required' });
  const existing = await getIdempotency(key);
  if (existing) return res.status(existing.status).json(JSON.parse(existing.body));

  if (!userPoster) return res.status(400).json({ message: 'Missing User-ID header' });
  if (!title || !description) return res.status(400).json({ message: 'Title and description required' });

  const envExists = await db('envs').where('id', envId).first();
  if (!envExists) return res.status(404).json({ message: 'Env not found' });

  const access = await db('env_departments as ed')
    .join('users as u', 'ed.department_slug', 'u.department_slug')
    .where('ed.env_id', envId)
    .andWhere('u.id', userPoster)
    .first();
  if (!access || !['owner','reporter'].includes(access.role)) {
    return res.status(403).json({ message: 'Insufficient role to create tasks' });
  }

  const taskId = genId();
  await db('tasks').insert({
    id: taskId,
    env_id: envId,
    author_id: userPoster,
    title,
    description,
    status: 'open',
    created_at: Date.now(),
    updated_at: Date.now()
  });

  const responseBody = { id: taskId, title, description, status: 'open', author_id: userPoster };
  await saveIdempotency(key, { status: 201, body: responseBody });
  res.status(201).json(responseBody);
});

// Get all tasks in env, optionally filtered by status
router.get('/:envId/tasks', async (req, res) => {
  const userPoster = req.header('User-ID');
  const { envId } = req.params;
  const { status } = req.query;

  if (!userPoster) return res.status(400).json({ message: 'Missing User-ID header' });

  const envExists = await db('envs').where('id', envId).first();
  if (!envExists) return res.status(404).json({ message: 'Env not found' });

  const access = await db('env_departments')
    .join('users', 'env_departments.department_slug', 'users.department_slug')
    .where({ env_id: envId, id: userPoster })
    .first();
  if (!access) {
    return res.status(403).json({ message: 'User does not have access to this env' });
  }

  let query = db('tasks').where('env_id', envId);
  if (status) {
    query = query.andWhere('status', status);
  }
  const tasks = await query;
  res.json(tasks);
});

// Get single task in env
router.get('/:envId/tasks/:taskId', async (req, res) => {
  const userPoster = req.header('User-ID');
  const { envId, taskId } = req.params;
  if (!userPoster) return res.status(400).json({ message: 'Missing User-ID header' });

  const envExists = await db('envs').where('id', envId).first();
  if (!envExists) return res.status(404).json({ message: 'Env not found' });

  const access = await db('env_departments')
    .join('users', 'env_departments.department_slug', 'users.department_slug')
    .where({ env_id: envId, id: userPoster })
    .first();
  if (!access) {
    return res.status(403).json({ message: 'User does not have access to this env' });
  }

  const task = await db('tasks').where({ id: taskId, env_id: envId }).first();
  if (!task) return res.status(404).json({ message: 'Task not found' });
  res.json(task);
});

// Update task in env
router.put('/:envId/tasks/:taskId', async (req, res) => {
  const userPoster = req.header('User-ID');
  const { envId, taskId } = req.params;
  const { title, description } = req.body;
  if (!userPoster) return res.status(400).json({ message: 'Missing User-ID header' });
  if (!title || !description) return res.status(400).json({ message: 'Title and description required' });

  const envExists = await db('envs').where('id', envId).first();
  if (!envExists) return res.status(404).json({ message: 'Env not found' });

  const access = await db('env_departments')
    .join('users', 'env_departments.department_slug', 'users.department_slug')
    .where({ env_id: envId, id: userPoster })
    .first();
  if (!access || !['owner','reporter'].includes(access.role)) {
    return res.status(403).json({ message: 'Insufficient role to create tasks' });
  }

  await db('tasks').where({ id: taskId, env_id: envId }).update({
    title,
    description,
    updated_at: Date.now()
  });
  res.status(204).send();
});

// Change task status
router.patch('/:envId/tasks/:taskId/status', async (req, res) => {
  const userPoster = req.header('User-ID');
  const { envId, taskId } = req.params;
  const { status } = req.body;
  if (!userPoster) return res.status(400).json({ message: 'Missing User-ID header' });
  if (!status) return res.status(400).json({ message: 'Status required' });

  const envExists = await db('envs').where('id', envId).first();
  if (!envExists) return res.status(404).json({ message: 'Env not found' });

  const access = await db('env_departments')
    .join('users', 'env_departments.department_slug', 'users.department_slug')
    .where({ env_id: envId, id: userPoster })
    .first();
  if (!access || !['owner','reporter'].includes(access.role)) {
    return res.status(403).json({ message: 'Insufficient role to create tasks' });
  }

  await db('tasks').where({ id: taskId, env_id: envId }).update({
    status,
    updated_at: Date.now()
  });
  res.status(204).send();
});

// Change task owner
router.patch('/:envId/tasks/:taskId/owner', async (req, res) => {
  const userPoster = req.header('User-ID');
  const { envId, taskId } = req.params;
  const { newOwnerId } = req.body;
  if (!userPoster) return res.status(400).json({ message: 'Missing User-ID header' });
  if (!newOwnerId) return res.status(400).json({ message: 'New owner ID required' });

  const envExists = await db('envs').where('id', envId).first();
  if (!envExists) return res.status(404).json({ message: 'Env not found' });

  const access = await db('tasks')
    .where({ id: taskId, env_id: envId, author_id: userPoster })
    .first();
  if (!access) {
    return res.status(403).json({ message: 'User is not the owner of this task' });
  }

  const newOwnerExists = await db('users').where('id', newOwnerId).first();
  if (!newOwnerExists) return res.status(404).json({ message: 'New owner not found' });

  const newOwnerAccess = await db('env_departments')
    .join('users', 'env_departments.department_slug', 'users.department_slug')
    .where({ env_id: envId, id: newOwnerId })
    .first();
  if (!newOwnerAccess) {
    return res.status(403).json({ message: 'New owner does not have access to this env' });
  }

  await db('tasks').where({ id: taskId, env_id: envId }).update({
    author_id: newOwnerId,
    updated_at: Date.now()
  });
  res.status(204).send();
});

// Delete task in env
router.delete('/:envId/tasks/:taskId', async (req, res) => {
  const userPoster = req.header('User-ID');
  const { envId, taskId } = req.params;
  if (!userPoster) return res.status(400).json({ message: 'Missing User-ID header' });

  const envExists = await db('envs').where('id', envId).first();
  if (!envExists) return res.status(404).json({ message: 'Env not found' });

  const access = await db('env_departments')
    .join('users', 'env_departments.department_slug', 'users.department_slug')
    .where({ env_id: envId, id: userPoster })
    .first();
  if (!access || !['owner','reporter'].includes(access.role)) {
    return res.status(403).json({ message: 'Insufficient role to delete tasks' });
  }

  await db('tasks').where({ id: taskId, env_id: envId }).del();
  res.status(204).send();
});

// Get all tasks user is assigned to
router.get('/tasks', async (req, res) => {
  const userPoster = req.header('User-ID');
  if (!userPoster) return res.status(400).json({ message: 'Missing User-ID header' });

  if (userPoster === 'any'){
    const tasks = await db('tasks');
    return res.json(tasks);
  }
  const userExists = await db('users').where('id', userPoster).first();
  if (!userExists) return res.status(404).json({ message: 'User not found' });

  const tasks = await db('tasks')
    .join('env_departments', 'tasks.env_id', 'env_departments.env_id')
    .where('env_departments.department_slug', userExists.department_slug)
    .select('tasks.*', 'env_departments.role');
  res.json(tasks);
});

export default router;
