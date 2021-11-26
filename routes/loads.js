const {datastore, Datastore, LOADS, BOATS, findEntity, pagedQuery} = require('../datastore');
const {handleClientError, handleServerError, loadRepr} = require('../utils');

const express = require('express');
const router = express.Router();

function isBadRequest(loadBody) {
  // Assert the load's volume, content, and creation_date are present in the request.
  return !(loadBody.volume && loadBody.content && loadBody.creation_date);
}

function getLoadProps(req) {
  return (({body: {volume, content, creation_date}}) => {
    return {volume, content, creation_date: new Date(creation_date)};
  })(req);
}

const BAD_REQUEST = 'The request object is missing at least one of the required attributes';
const NOT_FOUND = 'No load with this load_id exists';

/* Create a load. */
router.post('/', async (req, res, next) => {
  // Validate request.
  const load = getLoadProps(req);
  if (isBadRequest(load)) {
    handleClientError(res, 400, BAD_REQUEST, next);
    return;
  }

  // Set carrier to null.
  load.carrier = null;

  // Create loa.
  const key = datastore.key(LOADS);
  try {
    await datastore.insert({key, data: load});
  } catch (e) {
    // Pass to server error handler.
    handleServerError(res, next, e);
    return;
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
      handleClientError(res, 404, NOT_FOUND, next);
    } else {
      handleServerError(res, next, e);
    }
    return;
  }

  // Load with load_id was not found.
  if (!load) {
    handleClientError(res, 404, NOT_FOUND, next);
    return;
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
      handleClientError(res, 404, NOT_FOUND, next);
    } else {
      handleServerError(res, next, e);
    }
    return;
  }
  
  // Load did not exist.
  if (!load) {
    handleClientError(res, 404, NOT_FOUND, next);
    return;
  }

  // Prepare carrier data.
  if (load.carrier) {
    try {
      carrier = await findEntity(BOATS, load.carrier.id);
    } catch(e) {
      handleServerError(res, next, e);
      return;
    }

    // Remove load from boat's loads.
    const index = carrier.loads.findIndex(load => load.id === id);
    carrier.loads.splice(index, 1);
  }

  // Delete load and update carrier.
  Promise.all([
    datastore.delete(load[Datastore.KEY]),
    datastore.update(carrier || {})
  ]).then(_ => res.status(204).send())
    .catch(e => handleServerError(res, next, e));
});

/* View all loads. */
router.get('/', async (req, res, next) => {
  let loads;
  let info;

  // Create query.
  const query = datastore.createQuery(LOADS);
  try {
    [loads, info] = await pagedQuery(query, 5, req.query.cursor);
  } catch(e) {
    handleServerError(res, next, e);
    return;
  }
 
  // Build response body.
  const respBody = {}
  respBody.items = loads.map(load => {
    return loadRepr(parseInt(load[Datastore.KEY].id, 10), load, req.serverName());
  });
  if (info.moreResults === Datastore.MORE_RESULTS_AFTER_LIMIT) {
    respBody.next = `${req.serverName()}/loads?cursor=${encodeURIComponent(info.endCursor)}`;
  }

  // Return loads.
  res.status(200).send(respBody);
});

module.exports = router;
