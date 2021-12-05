const {datastore, Datastore, LOADS, BOATS, findEntity, pagedQuery} = require('../datastore');
const {handleClientError, handleServerError, loadRepr, isAcceptable} = require('../utils');

const express = require('express');
const router = express.Router();

function isBadRequest(loadBody) {
  // Assert the load's volume, content, and creation_date are present in the request.
  return !(loadBody.volume && loadBody.content && loadBody.creation_date);
}

function getLoadProps(req) {
  return (({body: {volume, content, creation_date}}) => ({volume, content, creation_date}))(req);
}

// Assert request accepts JSON.
router.use(isAcceptable);

const BAD_REQUEST = 'The request object is missing at least one of the required attributes';
const NOT_FOUND = 'No load with this load_id exists';
const METHOD_NOT_ALLOWED = "Method not allowed. See 'Allow' header";

/* Create a load. */
router.post('/', async (req, res, next) => {
  // Validate request.
  const load = getLoadProps(req);
  if (isBadRequest(load)) {
    return handleClientError(res, 400, BAD_REQUEST);
  }

  // Set carrier to null and store creation date as a Date.
  load.carrier = null;
  load.creation_date = new Date(load.creation_date);

  // Create loa.
  const key = datastore.key(LOADS);
  try {
    await datastore.insert({key, data: load});
  } catch (e) {
    // Pass to server error handler.
    return handleServerError(res, next, e);
  }

  // Return load representation.
  const respBody = loadRepr(parseInt(key.id, 10), load, req.serverName());
  res.status(201).send(respBody);  
});

/* View a load. */
router.get('/:load_id', async (req, res, next) => {
  let load;

  const id = parseInt(req.params.load_id, 10);
  try {
    load = await findEntity(LOADS, id);
  } catch(e) {
    if (e.code === 3) {
      // load_id was non-int.
      handleClientError(res, 404, NOT_FOUND);
    } else {
      handleServerError(res, next, e);
    }
    return;
  }

  // Load with load_id was not found.
  if (!load) {
    return handleClientError(res, 404, NOT_FOUND);
  }
  
  // Return load.
  const respBody = loadRepr(id, load, req.serverName());
  res.status(200).send(respBody);
});

/* Delete a load. */
router.delete('/:load_id', async (req, res, next) => {
  let load;
  let carrier;

  // Find load.
  const id = parseInt(req.params.load_id, 10);
  try {
    load = await findEntity(LOADS, id);
  } catch(e) {
    if (e.code === 3) {
      // load_id was non-int.
      handleClientError(res, 404, NOT_FOUND);
    } else {
      handleServerError(res, next, e);
    }
    return;
  }
  
  // Load did not exist.
  if (!load) {
    return handleClientError(res, 404, NOT_FOUND);
  }

  // Prepare carrier data.
  if (load.carrier) {
    try {
      carrier = await findEntity(BOATS, load.carrier.id);
    } catch(e) {
      return handleServerError(res, next, e);
    }

    // Remove load from boat's loads.
    const index = carrier.loads.findIndex(load => load.id === id);
    carrier.loads.splice(index, 1);
  }

  const asyncAction = carrier ? datastore.update.bind(datastore) : Promise.resolve.bind(Promise);

  // Delete load and update carrier.
  Promise.all([
    datastore.delete(load[Datastore.KEY]),
    asyncAction(carrier)
  ]).then(_ => res.status(204).send())
    .catch(e => handleServerError(res, next, e));
});

/* View all loads. */
router.get('/', async (req, res, next) => {
  let loads;
  let info;

  // Create query.
  const query = datastore.createQuery(LOADS);
  // Queries are mutable; need to create another.
  const totalQuery = datastore.createQuery(LOADS);
  try {
    [loads, info] = await pagedQuery(query, 5, req.query.cursor);
    [total] = await datastore.runQuery(totalQuery);
  } catch(e) {
    return handleServerError(res, next, e);
  }
 
  // Build response body.
  const respBody = {}
  respBody.items = loads.map(load => {
    return loadRepr(parseInt(load[Datastore.KEY].id, 10), load, req.serverName());
  });
  if (info.moreResults === Datastore.MORE_RESULTS_AFTER_LIMIT) {
    respBody.next = `${req.serverName()}/loads?cursor=${encodeURIComponent(info.endCursor)}`;
  }
  respBody.total = total.length;

  // Return loads.
  res.status(200).send(respBody);
});

/* Edit a load. */
router.put('/:load_id', async (req, res, next) => {
  // Validate request.
  const load = getLoadProps(req);
  if (isBadRequest(load)) {
    return handleClientError(res, 400, BAD_REQUEST);
  }

  // Find load.
  const id = parseInt(req.params.load_id, 10);
  let stored;
  try {
    stored = await findEntity(LOADS, id);
  } catch(e) {
    if (e.code === 3) {
      // load_id was non-int.
      handleClientError(res, 404, NOT_FOUND);
    } else {
      handleServerError(res, next, e);
    }
    return;
  }

  if (!stored) {
    return handleClientError(res, 404, NOT_FOUND);
  }

  // store creation date as a Date.
  load.creation_date = new Date(load.creation_date);

  const updated = {carrier: stored.carrier, ...load};
  const key = datastore.key([LOADS, id]);
  try {
    await datastore.update({key, data: updated});
  } catch (err) {
    // Pass to server error handler.
    return handleServerError(res, next, e);
  }

  // Return load representation.
  const respBody = loadRepr(parseInt(key.id, 10), updated, req.serverName());
  res.status(200).send(respBody);
});

/* Edit a load. */
router.patch('/:load_id', async (req, res, next) => {
  // Validate request.
  const load = getLoadProps(req);

  // Find boat.
  const id = parseInt(req.params.load_id, 10);
  let stored;
  try {
    stored = await findEntity(LOADS, id);
  } catch(e) {
    if (e.code === 3) {
      // boat_id was non-int.
      handleClientError(res, 404, NOT_FOUND);
    } else {
      handleServerError(res, next, e);
    }
    return;
  }

  if (!stored) {
    return handleClientError(res, 404, NOT_FOUND);
  }

  // Get missing props.
  for (let prop in load) {
    if (load[prop] === undefined) {
      load[prop] = stored[prop];
    }
  }

  const updated = {carrier: stored.carrier, ...load};
  const key = datastore.key([LOADS, id]);
  try {
    await datastore.update({key, data: updated});
  } catch (err) {
    // Pass to server error handler.
    return handleServerError(res, next, e);
  }

  // Return load representation.
  const respBody = loadRepr(parseInt(key.id, 10), updated, req.serverName());
  res.status(200).send(respBody);
});

router.put('/', (req, res, next) => {
  res.set('Allow', 'GET, POST');
  return handleClientError(res, 405, METHOD_NOT_ALLOWED);
});

router.delete('/', (req, res, next) => {
  res.set('Allow', 'GET, POST');
  return handleClientError(res, 405, METHOD_NOT_ALLOWED);
});

module.exports = router;
