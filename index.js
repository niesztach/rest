// index.js (na górze pliku)
import express from 'express';
import { db } from './db.js';
import { initSchema } from './db/initSchema.js';
import { makeDb } from './db/db.js';

const app = express();
app.use(express.json());

let db;
(async () => {
  db = await makeDb();
  await initSchema();           // upewnij się, że schama jest na miejscu
  app.listen(1234, () => console.log('Server running'));
})();


// uniwersalne wczytaj/zapisz
async function load(resource) {
  const file = path.join(DATA_DIR, resource + '.json');
  const txt = await fs.readFile(file, 'utf8').catch(() => '[]');
  return JSON.parse(txt);
}
async function save(resource, data) {
  const file = path.join(DATA_DIR, resource + '.json');
  // atomowo: zapisz do tmp, potem podmień
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}
const genId = () => crypto.randomBytes(8).toString('hex');
const genEtag = obj =>
  `"${crypto.createHash('md5').update(JSON.stringify(obj)).digest('hex')}"`;


app.get('/users', async (req, res) => {
  let users = await load('users');
  const totalCount = users.length;

  // Pagination
  const page = parseInt(req.query._page) || 1;
  const limit = parseInt(req.query._limit) || 10;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;

  const paginatedUsers = users.slice(startIndex, endIndex);

  // Add pagination headers
  res.set('X-Total-Count', totalCount);
  // Możesz też dodać Link header dla next/prev/first/last pages - to jest bardziej zaawansowane
  // Przykładowy Link header (uproszczony, wymagałby kalkulacji)
  // const baseUrl = `${req.protocol}://${req.get('host')}${req.originalUrl.split('?')[0]}`;
  // let linkHeader = '';
  // if (endIndex < totalCount) {
  //   linkHeader += `<${baseUrl}?_page=${page + 1}&_limit=${limit}>; rel="next"`;
  // }
  // if (startIndex > 0) {
  //   if (linkHeader) linkHeader += ', ';
  //   linkHeader += `<${baseUrl}?_page=${page - 1}&_limit=${limit}>; rel="prev"`;
  // }
  // if (linkHeader) res.set('Link', linkHeader);


  res.json(paginatedUsers);
});

// Simple GET by ID
app.get('/users/:userId', async (req, res) => {
  const userId = req.params.userId;
  const users = await load('users');
  const user = users.find(u => u.id === userId);

  if (!user) {
    return res.status(404).send('User not found');
  }

  // For Conditional PUT later
  res.set('ETag', genEtag(user));
  res.json(user);
});

// Idempotent POST (Example: create user)
// Requires a mechanism to store processed idempotency keys
//const processedKeys = new Map(); // In-memory store for demo. Needs persistence/expiration in production.

app.post('/users', async (req, res) => {
  const idempotencyKey = req.get('Idempotency-Key');

  if (idempotencyKey) {
    const cachedResponse = processedKeys.get(idempotencyKey);
    if (cachedResponse) {
      console.log(`Idempotency key ${idempotencyKey} hit cache.`);
      // Return cached response status and body
      return res.status(cachedResponse.status).json(cachedResponse.body);
    }
  }

  const newUser = {
    id: genId(),
    ...req.body // assuming body contains user details
  };

  // Basic validation (add more!)
  if (!newUser.name) {
      const responseBody = { message: "User name is required" };
      if (idempotencyKey) processedKeys.set(idempotencyKey, { status: 400, body: responseBody });
      return res.status(400).json(responseBody);
  }

  // *** CONCURRENCY ISSUE HERE ***
  // Multiple requests could load, add the same user (if no validation), and save,
  // potentially overwriting each other's changes if not careful.
  const users = await load('users');
  // Add checks here if user with same properties already exists, etc.

  users.push(newUser);

  try {
    await save('users', users);
    const responseBody = newUser; // Or just { id: newUser.id }
    if (idempotencyKey) processedKeys.set(idempotencyKey, { status: 201, body: responseBody });
    res.status(201).json(responseBody);
  } catch (error) {
    console.error("Error saving users:", error);
    const responseBody = { message: "Internal Server Error" };
    if (idempotencyKey) processedKeys.set(idempotencyKey, { status: 500, body: responseBody }); // Cache the error too? Depends on desired behavior.
    res.status(500).json(responseBody);
  }
  // TODO: Implement cleanup for old keys in processedKeys map
});


// Conditional PUT (Update User)
app.put('/users/:userId', async (req, res) => {
    const userId = req.params.userId;
    const ifMatch = req.get('If-Match'); // Client provides ETag here

    if (!ifMatch) {
        // If-Match header is required for conditional update
        return res.status(428).send('Precondition Required (If-Match header missing)');
    }

    // *** CONCURRENCY ISSUE: Load, check ETag, THEN save. Another process could update between load and save ***
    // In a real DB, you'd do this within a transaction or use optimistic concurrency provided by the DB.
    const users = await load('users');
    const userIndex = users.findIndex(u => u.id === userId);

    if (userIndex === -1) {
        // Resource not found (or deleted since client read it)
        return res.status(404).send('User not found');
    }

    const currentUser = users[userIndex];
    const currentEtag = genEtag(currentUser);

    if (ifMatch !== currentEtag) {
        // ETag mismatch - resource has been modified by another client
        console.log(`ETag mismatch for user ${userId}. Client: ${ifMatch}, Server: ${currentEtag}`);
        return res.status(412).send('Precondition Failed (ETag mismatch)');
    }

    // Proceed with update
    const updatedUser = { ...currentUser, ...req.body, id: userId }; // Ensure ID isn't changed

    // Add validation for req.body fields

    users[userIndex] = updatedUser;

    try {
        await save('users', users);
        const newEtag = genEtag(updatedUser);
        res.set('ETag', newEtag); // Return the new ETag
        res.status(200).json(updatedUser); // Or 204 No Content if body is empty
    } catch (error) {
        console.error("Error saving users:", error);
        res.status(500).send('Internal Server Error');
    }
});

// Simple DELETE
app.delete('/users/:userId', async (req, res) => {
    const userId = req.params.userId;
    const users = await load('users');
    const initialLength = users.length;
    const remainingUsers = users.filter(u => u.id !== userId);

    if (remainingUsers.length === initialLength) {
        return res.status(404).send('User not found');
    }

    // *** CONCURRENCY ISSUE HERE ***
    try {
      await save('users', remainingUsers);
      res.status(204).send(); // No Content
    } catch (error) {
      console.error("Error saving users:", error);
      res.status(500).send('Internal Server Error');
    }
});


// --- Implementacja Department-Env Many-to-Many (Using department_envs.json) ---

// Helper to load department_envs links
async function loadDepartmentEnvs() {
  return load('department_envs');
}

// Helper to save department_envs links
async function saveDepartmentEnvs(links) {
  // *** CONCURRENCY ISSUE: Saving this file is NOT atomic with loading it ***
  // Needs careful handling (e.g., locking mechanism or database transactions) in production
  return save('department_envs', links);
}


// GET environments for a specific department
app.get('/departments/:depId/envs', async (req, res) => {
  const depId = req.params.depId;
  const links = await loadDepartmentEnvs();
  const envs = await load('envs'); // Load environments to get full details

  const envIdsForDep = links
    .filter(link => link.depId === depId)
    .map(link => link.envId);

  const environmentsForDep = envs.filter(env => envIdsForDep.includes(env.id));

  // Could add pagination here too if needed for this collection
  res.json(environmentsForDep);
});

// POST to add an environment to a department (create a link)
app.post('/departments/:depId/envs', async (req, res) => {
    const depId = req.params.depId;
    const { envId } = req.body; // Expecting { "envId": "..." } in body

    if (!envId) {
        return res.status(400).send('envId is required in the request body');
    }

    // Optional: Check if depId and envId actually exist
    const departments = await load('departments');
    const departmentExists = departments.some(d => d.id === depId);
    if (!departmentExists) {
      return res.status(404).send('Department not found');
    }
    const envs = await load('envs');
    const envExists = envs.some(e => e.id === envId);
    if (!envExists) {
      return res.status(404).send('Environment not found');
    }

    // *** CONCURRENCY ISSUE HERE ***
    // Multiple POSTs could load, add the same link if not careful, and save.
    const links = await loadDepartmentEnvs();

    // Check if the link already exists (idempotency for adding the link)
    const linkExists = links.some(link => link.depId === depId && link.envId === envId);

    if (linkExists) {
        // Resource already exists, return 200 or 204 (depends on API design, 200 with link info is common)
        // For a simple "add", 204 is fine.
        return res.status(204).send();
    }

    const newLink = { depId, envId };
    links.push(newLink);

    try {
        await saveDepartmentEnvs(links);
        res.status(201).json(newLink); // Return the created link object
    } catch (error) {
        console.error("Error saving department_envs:", error);
        res.status(500).send('Internal Server Error');
    }
});

// DELETE a link between a department and an environment
app.delete('/departments/:depId/envs/:envId', async (req, res) => {
    const depId = req.params.depId;
    const envId = req.params.envId;

    // *** CONCURRENCY ISSUE HERE ***
    const links = await loadDepartmentEnvs();
    const initialLength = links.length;

    const remainingLinks = links.filter(link => !(link.depId === depId && link.envId === envId));

    if (remainingLinks.length === initialLength) {
        // Link not found
        return res.status(404).send('Link not found');
    }

    try {
        await saveDepartmentEnvs(remainingLinks);
        res.status(204).send(); // No Content
    } catch (error) {
        console.error("Error saving department_envs:", error);
        res.status(500).send('Internal Server Error');
    }
});

// --- Implementacja Atomic Controller (Transfer User) ---

// Example: Transfer user from one department to another
// This endpoint will perform operations on:
// 1. The user object itself (optional, maybe update a 'departmentId' field)
// 2. The list of users associated with the source department (remove user)
// 3. The list of users associated with the target department (add user)

app.post('/actions/transfer-user', async (req, res) => {
    const { userId, sourceDepId, targetDepId } = req.body; // Expecting these IDs in body

    if (!userId || !sourceDepId || !targetDepId) {
        return res.status(400).send('userId, sourceDepId, and targetDepId are required');
    }

    // --- START OF POTENTIAL TRANSACTION ---
    // *** THIS IS WHERE FILE-BASED STORAGE FAILS FOR TRUE ATOMICITY ***
    // We need to load ALL necessary data first. If any load fails, abort.
    // Then perform operations in memory.
    // Then save ALL modified data. If ANY save fails, the system is in an inconsistent state.
    // There's no easy way to roll back changes saved to files.

    let users, departments, sourceDep, targetDep;

    try {
      users = await load('users');
      departments = await load('departments');

      sourceDep = departments.find(d => d.id === sourceDepId);
      targetDep = departments.find(d => d.id === targetDepId);

      if (!sourceDep || !targetDep) {
          return res.status(404).send('Source or target department not found');
      }

      const userToTransferIndex = users.findIndex(u => u.id === userId);
      if (userToTransferIndex === -1) {
          return res.status(404).send('User not found');
      }
      const userToTransfer = users[userToTransferIndex];

      // Basic check: is the user actually in the source department (conceptually)?
      // If users have a 'departmentId' field, check that.
      // If departments have a list of user IDs, check that.
      // Let's assume users have a 'departmentId' field for simplicity in this example.
      if (userToTransfer.departmentId !== sourceDepId) {
         // You might return 400 or 409 depending on exact desired behavior
         return res.status(400).send(`User ${userId} is not currently in department ${sourceDepId}`);
      }


      // --- PERFORM MODIFICATIONS IN MEMORY ---

      // 1. Update user's department ID
      users[userToTransferIndex].departmentId = targetDepId;

      // 2. Update department user lists (if departments store lists of user IDs)
      //    Let's assume departments DON'T store user lists explicitly, we find users *by* departmentId.
      //    If they *did* store lists, the logic here would be:
      //    sourceDep.userIds = sourceDep.userIds.filter(id => id !== userId);
      //    targetDep.userIds.push(userId);
      //    (and you'd need to find/update the sourceDep and targetDep objects in the 'departments' array)


      // --- ATTEMPT TO SAVE MODIFIED DATA ---
      // THIS IS THE NON-ATOMIC PART WITH FILES

      // Save updated users list
      await save('users', users);

      // If departments stored user lists, you'd also need to save departments.json here:
      // await save('departments', departments);


      // --- END OF POTENTIAL TRANSACTION ---

      // If we reached here, all saves succeeded (or appeared to succeed at the file system level)
      res.status(200).json({ message: `User ${userId} transferred from ${sourceDepId} to ${targetDepId}` });

    } catch (error) {
        console.error("Error during user transfer:", error);
        // In a real transactional system (database), you would ROLLBACK here.
        // With files, the state might be inconsistent. You might need manual recovery
        // or a more sophisticated logging/recovery mechanism.
        res.status(500).json({ message: 'Transfer failed due to an internal error. State might be inconsistent.' });
    }
});


// --- Implementacja pozostałych zasobów (Departments, Envs, nested collections) ---
// Podobnie jak dla users, zaimplementuj GET, POST, PUT, DELETE dla:
// - /departments (CRUD, Pagination)
// - /departments/:depId (CRUD)
// - /departments/:depId/users (GET - filter users by departmentId, POST - add user to department - consider idempotent!)
// - /departments/:depId/users/:userId (DELETE - remove user from department)
// - /envs (CRUD, Pagination)
// - /envs/:envId (CRUD)
// - /envs/:envId/departments (GET - filter department_envs by envId, lookup departments, POST - add department to env - consider idempotent!)
// - /envs/:envId/departments/:depId (DELETE - remove department from env)
// - /envs/:envId/boards (GET, POST, DELETE - if you implement boards)
