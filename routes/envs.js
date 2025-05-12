
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

// Create env (owner department in body)
router.post('/', async (req, res) => {
    const { name, ownerDept } = req.body;
    if (!name || !ownerDept) return res.status(400).json({ message: 'Name and ownerDept required' });
    const id = genId();
    await db.transaction(async trx => {
      // 1) create env
      await trx('envs').insert({ id, name });
      // 2) add pivot: owner
      await trx('env_departments').insert({
        env_id: id,
        department_slug: ownerDept,
        role: 'owner'
      });
    });
    res.status(201).json({ id, name });
  });
  
// Get departments for env

router.get('/:envId/departments', async (req, res) => {
    const { envId } = req.params; // envId z URI

    const envs = await db('env_departments')
      .join('departments', 'env_departments.department_slug', 'departments.slug')
      .where('env_departments.env_id', envId)
      .select('departments.*', 'env_departments.role');
    return res.json(envs);

  }
);

// Gen env - brak naglowka podaje wszystkie

router.get('/', async (req, res) => {
    const deptSlug = req.header('X-Department-Slug');
  
    if (deptSlug) {
      // Użytkownik podał dział – daj środowiska tylko tego działu
      const envs = await db('envs')
        .join('env_departments', 'envs.id', 'env_departments.env_id')
        .where('env_departments.department_slug', deptSlug)
        .select('envs.*', 'env_departments.role');
  
      return res.json(envs);
    } else {
      // Brak nagłówka – daj wszystkie środowiska bez filtrowania
      const envs = await db('envs').select('*');
      return res.json(envs);
    }
  });

  //dodanie departamentu do środowiska
  // POST /envs/:envId/departments
router.post('/:envId/departments', async (req, res) => {
    const requesterDept = req.header('Owner-Slug');
    const { envId } = req.params; // envId z URI
    const { deptSlug, role } = req.body;
  
    if (!requesterDept) return res.status(400).json({ message: 'Missing Owner-Slug header' });
    if (!deptSlug || !role) return res.status(400).json({ message: 'deptSlug and role required' });
  
    // 1) Sprawdź, czy requester jest ownerem środowiska
    const access = await db('env_departments')
      .where({ env_id: envId, department_slug: requesterDept })
      .first();
  
    if (!access || access.role !== 'owner') {
      return res.status(403).json({ message: 'Only owner can add departments to this env' });
    }
  
    // 2) Sprawdź, czy już istnieje przypisanie
    const exists = await db('env_departments')
      .where({ env_id: envId, department_slug: deptSlug })
      .first();
  
    if (exists) {
      return res.status(409).json({ message: 'This department is already assigned to the env' });
    }
  
    // 3) Wstaw nową relację
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

  // PATCH update role of department in env

  router.patch('/:envId/departments/:deptSlug', async (req, res) => {
    const requesterDept = req.header('Owner-Slug');
    const { envId, deptSlug } = req.params; // envId i deptSlug z URI
    const { role } = req.body;
  
    if (!requesterDept) return res.status(400).json({ message: 'Missing Owner-Slug header' });
    if (!role) return res.status(400).json({ message: 'Role required' });
  
    // 1) Sprawdź, czy requester jest ownerem środowiska
    const access = await db('env_departments')
      .where({ env_id: envId, department_slug: requesterDept })
      .first();
  
    if (!access || access.role !== 'owner') {
      return res.status(403).json({ message: 'Only owner can update departments in this env' });
    }
  
    // 2) Sprawdź, czy deptSlug istnieje w relacji
    const exists = await db('env_departments')
      .where({ env_id: envId, department_slug: deptSlug })
      .first();
  
    if (!exists) {
      return res.status(404).json({ message: 'Department not found in this env' });
    }

    // Sprawdź, czy deptSlug jest tym samym, co requesterDept
    if (deptSlug === requesterDept) {
      return res.status(409).json({ message: 'Cannot update own department role' });
    }
    

    // 3) Zaktualizuj rolę
    const validRoles = ['owner', 'reporter', 'member'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }
  
    await db('env_departments')
      .where({ env_id: envId, department_slug: deptSlug })
      .update({ role });
  
    res.status(204).send();
  });

  // DELETE department from env
    router.delete('/:envId/departments/:deptSlug', async (req, res) => {
        const requesterDept = req.header('Owner-Slug');
        const { envId, deptSlug } = req.params; // envId i deptSlug z URI
    
        if (!requesterDept) return res.status(400).json({ message: 'Missing Owner-Slug header' });
    
        // 1) Sprawdź, czy requester jest ownerem środowiska
        const access = await db('env_departments')
        .where({ env_id: envId, department_slug: requesterDept })
        .first();
    
        if (!access || access.role !== 'owner') {
        return res.status(403).json({ message: 'Only owner can remove departments from this env' });
        }
    
        // 2) Sprawdź, czy deptSlug istnieje w relacji
        const exists = await db('env_departments')
        .where({ env_id: envId, department_slug: deptSlug })
        .first();
    
        if (!exists) {
        return res.status(404).json({ message: 'Department not found in this env' });
        }

        // Sprawdź, czy deptSlug jest tym samym, co requesterDept
        if (deptSlug === requesterDept) {
            //sprawdz czy env nie pozostanie bez ownera
            const remainingOwners = await db('env_departments')
            .where({ env_id: envId, role: 'owner' })
            if (remainingOwners.length === 1) {
                return res.status(409).json({ message: 'Cannot left env without owner' });
            }
        }
    
        // 3) Usuń relację
        await db('env_departments')
        .where({ env_id: envId, department_slug: deptSlug })
        .del();
    
        res.status(204).send();
    });

    // Delete env and all relations

    router.delete('/:envId', async (req, res) => {
        const requesterDept = req.header('Owner-Slug');
        const { envId } = req.params; // envId z URI

        if (!requesterDept) return res.status(400).json({ message: 'Missing Owner-Slug header' });
        if (!envId) return res.status(400).json({ message: 'Env ID required' });

        // 1) Sprawdź, czy requester jest ownerem środowiska
        const access = await db('env_departments')
        .where({ env_id: envId, department_slug: requesterDept })
        .first();
    
        if (!access || access.role !== 'owner') {
        return res.status(403).json({ message: 'Only owner can remove env' });
        }
    
        // Sprawdź, czy środowisko istnieje
        const envExists = await db('envs').where('id', envId).first();
        if (!envExists) return res.status(404).json({ message: 'Env not found' });
    
        // Usuń środowisko i wszystkie relacje
        await db.transaction(async trx => {
            await trx('env_departments').where('env_id', envId).del(); // Usuń relacje
            await trx('tasks').where('env_id', envId).del(); // Usuń zadania
            await trx('envs').where('id', envId).del(); // Usuń środowisko
        });
    
        res.status(204).send();
    });
  
    

  

export default router;