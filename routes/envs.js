
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

    const key = req.header('Idempotency-Key');
    if (!key) return res.status(400).json({ message: 'Idempotency-Key header required' });
    if (key) {
      const existing = await getIdempotency(key);
      if (existing) return res.status(existing.status).json(JSON.parse(existing.body));
    }

    const { name, ownerDept } = req.body;
    if (!name || !ownerDept) return res.status(400).json({ message: 'Name and ownerDept required' });
    // sprawdz czy taki departament istnieje
    const isDept = await db('departments').where('slug', ownerDept).first();
    if (!isDept) return res.status(404).json({ message: 'Department not found' });

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

    const body = { id, name };
    if (key) await saveIdempotency(key, { status: 201, body });

    res.status(201).json(body);
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

            // **GUARD: nie pozwalaj zdegradować, jeśli są taski tego działu**
    // najpierw pobierz listę userów z tego działu
    const userIds = await db('users')
    .where('department_slug', deptSlug)
    .pluck('id');

    // potem oblicz liczbę tasków
    const taskCount = await db('tasks')
    .where({ env_id: envId })
    .whereIn('author_id', userIds)
    .count({ cnt: '*' })
    .first();

    // i dalej:
    if (taskCount.cnt > 0 && role === 'member') {
    return res.status(409).json({ message: 'Cannot demote department with existing tasks' });
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
  

//########### tasks ###########################
//########### handling ###########################


    // create task in env (as a user)

    router.post('/:envId/tasks', async (req, res) => {
    const key        = req.header('Idempotency-Key');
    const userPoster = req.header('User-ID');
    const { envId }  = req.params; 
    const { title, description } = req.body;

    // 0) Idempotency-Key jest wymagany
    if (!key) {
        return res.status(400).json({ message: 'Idempotency-Key header required' });
    }

    // 1) Sprawdź, czy klucz już był użyty
    const existing = await getIdempotency(key);
    if (existing) {
        // zwróć dokładnie ten sam response co poprzednio
        return res
        .status(existing.status)
        .json(JSON.parse(existing.body));
    }

    // 2) Walidacja podstawowa
    if (!userPoster) {
        return res.status(400).json({ message: 'Missing User-ID header' });
    }
    if (!title || !description) {
        return res.status(400).json({ message: 'Title and description required' });
    }

    // 3) Sprawdź istnienie env
    const envExists = await db('envs').where('id', envId).first();
    if (!envExists) {
        return res.status(404).json({ message: 'Env not found' });
    }

    // 4) Sprawdź dostęp usera — musi istnieć w pivot i department musi mieć rolę reporter/owner
    const access = await db('env_departments as ed')
        .join('users as u', 'ed.department_slug', 'u.department_slug')
        .where('ed.env_id', envId)
        .andWhere('u.id', userPoster)
        .first();

    if (!access || !['owner','reporter'].includes(access.role)) {
        return res.status(403).json({ message: 'Insufficient role to create tasks' });
    }

    // 5) Wygeneruj taskId i wstaw rekord
    const taskId = genId();
    await db('tasks').insert({
        id:        taskId,
        env_id:    envId,
        author_id: userPoster,
        title,
        description,
        status:    'open',
        created_at: Date.now(),
        updated_at: Date.now()
    });

    // 6) Przygotuj body odpowiedzi
    const responseBody = { id: taskId, title, description, status: 'open', author_id: userPoster };

    // 7) Zapisz wynik pod kluczem idempotentnym
    await saveIdempotency(key, { status: 201, body: responseBody });

    // 8) Odeślij odpowiedź
    res.status(201).json(responseBody);
    });





    // get tasks in env (as a user)
    router.get('/:envId/tasks', async (req, res) => {
        const userPoster = req.header('User-ID');
        const { envId } = req.params; // envId z URI
        if (!userPoster) return res.status(400).json({ message: 'Missing User-ID header' });
        // 1) Sprawdź, czy środowisko istnieje
        const envExists = await db('envs').where('id', envId).first();
        if (!envExists) return res.status(404).json({ message: 'Env not found' });  

        // Czy uzytkownik ma dostep do srodowiska
        const access = await db('env_departments')
          .join('users', 'env_departments.department_slug', 'users.department_slug')
          .where({ env_id: envId, id: userPoster })
          .first();
        if (!access) {
          return res.status(403).json({ message: 'User does not have access to this env' });
        }

        // 2) Pobierz zadania z bazy danych
        const tasks = await db('tasks').where('env_id', envId);
        res.json(tasks); }
    );

    // get single task in env (as a user)
    router.get('/:envId/tasks/:taskId', async (req, res) => {
        const userPoster = req.header('User-ID');
        const { envId, taskId } = req.params; // envId i taskId z URI
        if (!userPoster) return res.status(400).json({ message: 'Missing User-ID header' });
        // 1) Sprawdź, czy środowisko istnieje
        const envExists = await db('envs').where('id', envId).first();
        if (!envExists) return res.status(404).json({ message: 'Env not found' });  

        // Czy uzytkownik ma dostep do srodowiska
        const access = await db('env_departments')
          .join('users', 'env_departments.department_slug', 'users.department_slug')
          .where({ env_id: envId, id: userPoster })
          .first();
        if (!access) {
          return res.status(403).json({ message: 'User does not have access to this env' });
        }

        // 2) Pobierz zadanie z bazy danych
        const task = await db('tasks').where({ id: taskId, env_id: envId }).first();
        if (!task) return res.status(404).json({ message: 'Task not found' });
        res.json(task); }
    );

    // update task in env (as a user)
    router.put('/:envId/tasks/:taskId', async (req, res) => {
        const userPoster = req.header('User-ID');
        const { envId, taskId } = req.params; // envId i taskId z URI
        const { title, description } = req.body;
        if (!userPoster) return res.status(400).json({ message: 'Missing User-ID header' });
        if (!title || !description) return res.status(400).json({ message: 'Title and description required' });
        // 1) Sprawdź, czy środowisko istnieje
        const envExists = await db('envs').where('id', envId).first();
        if (!envExists) return res.status(404).json({ message: 'Env not found' });  

        // Czy uzytkownik ma dostep do srodowiska
        const access = await db('env_departments')
          .join('users', 'env_departments.department_slug', 'users.department_slug')
          .where({ env_id: envId, id: userPoster })
          .first();
          
          if (!access || !['owner','reporter'].includes(access.role)) {
            return res.status(403).json({ message: 'Insufficient role to create tasks' });
        }

        // 2) Zaktualizuj zadanie w bazie danych
        await db('tasks').where({ id: taskId, env_id: envId }).update({
          title,
          description,
          updated_at: Date.now()
        });
        res.status(204).send(); }
    );

    // przeniesienie zadania do innego srodowiska
    router.patch('/:envId/tasks/:taskId', async (req, res) => {
        const userPoster = req.header('User-ID');
        const { envId, taskId } = req.params; // envId i taskId z URI
        const { newEnvId } = req.body;
        if (!userPoster) return res.status(400).json({ message: 'Missing User-ID header' });
        if (!newEnvId) return res.status(400).json({ message: 'New env ID required' });
        // 1) Sprawdź, czy środowisko istnieje
        const envExists = await db('envs').where('id', envId).first();
        if (!envExists) return res.status(404).json({ message: 'Env not found' });  

        // Czy uzytkownik ma dostep do srodowiska
        const access = await db('env_departments')
          .join('users', 'env_departments.department_slug', 'users.department_slug')
          .where({ env_id: envId, id: userPoster })
          .first();

          if (!access || !['owner'].includes(access.role)) {
            return res.status(403).json({ message: 'Insufficient role to create tasks' });
        }

        // 2) Sprawdź, czy nowe środowisko istnieje
        const newEnvExists = await db('envs').where('id', newEnvId).first();
        if (!newEnvExists) return res.status(404).json({ message: 'New env not found' });

        // Czy uzytkownik ma dostep do nowego srodowiska
        const newAccess = await db('env_departments')
          .join('users', 'env_departments.department_slug', 'users.department_slug')
          .where({ env_id: newEnvId, id: userPoster })
          .first();
        if (!newAccess) {
            return res.status(403).json({ message: 'User does not have access to this new env' });
            }

        // 3) Przenieś zadanie do nowego środowiska
        await db('tasks').where({ id: taskId, env_id: envId }).update({
          env_id: newEnvId,
          updated_at: Date.now()
        });
        res.status(204).send(); }
    );

    // zmiana statusu zadania
    router.patch('/:envId/tasks/:taskId/status', async (req, res) => {
        const userPoster = req.header('User-ID');
        const { envId, taskId } = req.params; // envId i taskId z URI
        const { status } = req.body;
        if (!userPoster) return res.status(400).json({ message: 'Missing User-ID header' });
        if (!status) return res.status(400).json({ message: 'Status required' });
        // 1) Sprawdź, czy środowisko istnieje
        const envExists = await db('envs').where('id', envId).first();
        if (!envExists) return res.status(404).json({ message: 'Env not found' });  

        // Czy uzytkownik ma dostep do srodowiska
        const access = await db('env_departments')
          .join('users', 'env_departments.department_slug', 'users.department_slug')
          .where({ env_id: envId, id: userPoster })
          .first();

          if (!access || !['owner','reporter'].includes(access.role)) {
            return res.status(403).json({ message: 'Insufficient role to create tasks' });
        }

        // 2) Zaktualizuj status zadania w bazie danych
        await db('tasks').where({ id: taskId, env_id: envId }).update({
          status,
          updated_at: Date.now()
        });
        res.status(204).send(); }
    );

    // zmiana wlasciciela zadania

    router.patch('/:envId/tasks/:taskId/owner', async (req, res) => {
        const userPoster = req.header('User-ID');
        const { envId, taskId } = req.params; // envId i taskId z URI
        const { newOwnerId } = req.body;
        if (!userPoster) return res.status(400).json({ message: 'Missing User-ID header' });
        if (!newOwnerId) return res.status(400).json({ message: 'New owner ID required' });
        // 1) Sprawdź, czy środowisko istnieje
        const envExists = await db('envs').where('id', envId).first();
        if (!envExists) return res.status(404).json({ message: 'Env not found' });  

        // Czy uzytkownik ma dostep do srodowiska
        const access = await db('env_departments')
          .join('users', 'env_departments.department_slug', 'users.department_slug')
          .where({ env_id: envId, id: userPoster })
          .first();

        if (!access || !['owner'].includes(access.role)) {
            return res.status(403).json({ message: 'Insufficient role to create tasks' });
        }

        // 2) Sprawdź, czy nowy właściciel istnieje
        const newOwnerExists = await db('users').where('id', newOwnerId).first();
        if (!newOwnerExists) return res.status(404).json({ message: 'New owner not found' });

        // sprawdź czy nowy właściciel nie ma rangi member
        

        // Sprawdz czy nowy wlasciciel ma dostep do srodowiska
        const newOwnerAccess = await db('env_departments')
          .join('users', 'env_departments.department_slug', 'users.department_slug')
          .where({ env_id: envId, id: newOwnerId })
          .first();
        if (!newOwnerAccess) {
            return res.status(403).json({ message: 'New owner does not have access to this env' });
            }

        // 3) Zaktualizuj właściciela zadania w bazie danych
        await db('tasks').where({ id: taskId, env_id: envId }).update({
          author_id: newOwnerId,
          updated_at: Date.now()
        });
        res.status(204).send(); }
    );

    // delete task in env (as a user)
    router.delete('/:envId/tasks/:taskId', async (req, res) => {
        const userPoster = req.header('User-ID');
        const { envId, taskId } = req.params; // envId i taskId z URI
        if (!userPoster) return res.status(400).json({ message: 'Missing User-ID header' });
        // 1) Sprawdź, czy środowisko istnieje
        const envExists = await db('envs').where('id', envId).first();
        if (!envExists) return res.status(404).json({ message: 'Env not found' });  

        // Czy uzytkownik ma dostep do srodowiska
        const access = await db('env_departments')
          .join('users', 'env_departments.department_slug', 'users.department_slug')
          .where({ env_id: envId, id: userPoster })
          .first();

        if (!access || !['owner','reporter'].includes(access.role)) {
            return res.status(403).json({ message: 'Insufficient role to create tasks' });
        }

        // 2) Usuń zadanie z bazy danych
        await db('tasks').where({ id: taskId, env_id: envId }).del();
        res.status(204).send(); }
    );

    // get all tasks in env by status (as a user)
    router.get('/:envId/tasks/status/:status', async (req, res) => {
        const userPoster = req.header('User-ID');
        const { envId, status } = req.params; // envId i status z URI
        if (!userPoster) return res.status(400).json({ message: 'Missing User-ID header' });
        // 1) Sprawdź, czy środowisko istnieje
        const envExists = await db('envs').where('id', envId).first();
        if (!envExists) return res.status(404).json({ message: 'Env not found' });  

        // Czy uzytkownik ma dostep do srodowiska
        const access = await db('env_departments')
          .join('users', 'env_departments.department_slug', 'users.department_slug')
          .where({ env_id: envId, id: userPoster })
          .first();
        if (!access) {
          return res.status(403).json({ message: 'User does not have access to this env' });
        }

        // 2) Pobierz zadania z bazy danych
        const tasks = await db('tasks').where({ env_id: envId, status });
        res.json(tasks); }
    );

    // get all tasks user is assigned to (as a user)

    router.get('/tasks', async (req, res) => {
        const userPoster = req.header('User-ID');
        if (!userPoster) return res.status(400).json({ message: 'Missing User-ID header' });
        // 1) Sprawdź, czy użytkownik istnieje
        const userExists = await db('users').where('id', userPoster).first();
        if (!userExists) return res.status(404).json({ message: 'User not found' });  

        // 2) Pobierz zadania z bazy danych
        const tasks = await db('tasks')
          .join('env_departments', 'tasks.env_id', 'env_departments.env_id')
          .where('env_departments.department_slug', userExists.department_slug)
          .select('tasks.*', 'env_departments.role');
        res.json(tasks); }
    );  



  

export default router;