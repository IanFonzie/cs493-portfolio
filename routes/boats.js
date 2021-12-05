const {datastore, Datastore, BOATS, LOADS, USERS, findEntity, pagedQuery} = require('../datastore');
const {handleClientError, handleServerError, loadRepr, checkJwt, isAcceptable} = require('../utils');

const express = require('express');
const router = express.Router();

function isBadRequest(boatBody) {
  // Assert the boat's name, type, and body are present in the request.
  return !(boatBody.name && boatBody.type && boatBody.length);
}

function getBoatProps(req) {
  return (({body: {name, type, length}}) => ({name, type, length}))(req);
}

function boatRepr(id, boat, baseUrl, singleton = true) {
  const representation = {
    id,
    name: boat.name,
    type: boat.type,
    length: boat.length
  };

  // Add loads for singleton representations.
  if (singleton) {
    for (let load of boat.loads) {
      load.self = `${baseUrl}/loads/${load.id}`;
    }
    representation.loads = boat.loads;
  }

  representation.owner = boat.owner;
  representation.self = `${baseUrl}/boats/${id}`;

  return representation;
}

// Validate JWT.
router.use(checkJwt);

// Assert user is registered and has permission.
router.use(async function checkRegistered(req, res, next) {
  let user;

  // Retrieve the user
  try {
    user = await findEntity(USERS, req.user.sub);
  } catch (err) {
    return handleServerError(res, next, err);
  }

  // User not found.
  if (!user) {
    return handleClientError(res, 403, NOT_REGISTERED);
  }
  
  next();
});

// Assert request accepts JSON.
router.use(isAcceptable);

const BAD_REQUEST = 'The request object is missing at least one of the required attributes';
const BOAT_NOT_FOUND = 'No boat with this boat_id exists';
const BOAT_OR_LOAD_NOT_FOUND = 'The specified boat and/or load does not exist';
const LOAD_ALREADY_ASSIGNED = 'The load is already assigned';
const LOAD_ELSEWHERE = 'The load is not on this boat';
const NOT_REGISTERED = 'The associated user is not registered';
const NOT_OWNER = 'The associated user does not own the boat with the requested boat_id';

/* Create a boat. */
router.post('/', async (req, res, next) => {
  // Validate request.
  const boat = getBoatProps(req);
  if (isBadRequest(boat)) {
    handleClientError(res, 400, BAD_REQUEST, next);
    return;
  }

  // Add default loads and owner.
  boat.loads = [];
  boat.owner = req.user.sub;

  // Create boat.
  const key = datastore.key(BOATS);
  try {
    await datastore.insert({key, data: boat});
  } catch (e) {
    // Pass to server error handler.
    handleServerError(res, next, e);
    return;
  }

  // Return boat representation.
  const respBody = boatRepr(parseInt(key.id, 10), boat, req.serverName());
  res.status(201).send(respBody);
});

/* View a boat. */
router.get('/:boat_id', async (req, res, next) => {
  let boat;

  const id = parseInt(req.params.boat_id, 10);
  try {
    boat = await findEntity(BOATS, id);
  } catch(e) {
    if (e.code === 3) {
      // boat_id was non-int.
      handleClientError(res, 404, BOAT_NOT_FOUND, next);
    } else {
      handleServerError(res, next, e);
    }
    return;
  }

  // Boat with boat_id was not found or user does not own it.
  if (!boat) {
    return handleClientError(res, 404, BOAT_NOT_FOUND);
  } else if (boat.owner !== req.user.sub) {
    return handleClientError(res, 403, NOT_OWNER);
  }
  
  // Return boat.
  const respBody = boatRepr(id, boat, req.serverName());
  res.status(200).send(respBody);
});

/* Add load to a boat. */
router.put('/:boat_id/loads/:load_id', (req, res, next) => {
  const boatId = parseInt(req.params.boat_id, 10);
  const loadId = parseInt(req.params.load_id, 10);

  Promise.all([findEntity(BOATS, boatId), findEntity(LOADS, loadId)]).then(([boat, load]) => {
    // Either boat or load do not exist.
    if (!(load && boat)) {
      handleClientError(res, 404, BOAT_OR_LOAD_NOT_FOUND, next);
      return;
    }

    // Assert current user owns the boat.
    if (boat.owner !== req.user.sub) {
      return handleClientError(res, 403, NOT_OWNER);
    }

    // Load exists but is already assigned.
    if (load.carrier) {
      handleClientError(res, 403, LOAD_ALREADY_ASSIGNED, next);
      return;
    }

    // Set load's carrier.
    load.carrier = {
      id: boatId,
      // name: boat.name
    };

    // Add load to boat's loads.
    boat.loads.push({id: loadId});

    // Perform updates.
    Promise.all([
      datastore.update({key: load[Datastore.KEY], data: load}),
      datastore.update({key: boat[Datastore.KEY], data: boat})
    ]).then(_ => {
      // Updates successful.
      res.status(204).send();
    }).catch(e => {
      // Error occurred during updates.
      handleServerError(res, next, e);
    });

  }).catch(e => {
    if (e.code === 3) {
      // boat_id or load_id was non-int.
      handleClientError(res, 404, BOAT_OR_LOAD_NOT_FOUND, next);
    } else {
      handleServerError(res, next, e);
    }
  });
});

/* Remove load from a boat. */
router.delete('/:boat_id/loads/:load_id', (req, res, next) => {
  const boatId = parseInt(req.params.boat_id, 10);
  const loadId = parseInt(req.params.load_id, 10);

  Promise.all([findEntity(BOATS, boatId), findEntity(LOADS, loadId)]).then(([boat, load]) => {
    // Either boat or load do not exist.
    if (!(load && boat)) {
      handleClientError(res, 404, BOAT_OR_LOAD_NOT_FOUND, next);
      return;
    }

    // Assert current user owns the boat.
    if (boat.owner !== req.user.sub) {
      return handleClientError(res, 403, NOT_OWNER);
    }

    // Load exists but its carrier is not this boat.
    if (!load.carrier || load.carrier.id !== boatId) {
      handleClientError(res, 403, LOAD_ELSEWHERE, next);
      return;
    }

    // Disassociate carrier.
    load.carrier = null;

    // Remove load from boat's loads.
    const index = boat.loads.findIndex(load => load.id === loadId);
    boat.loads.splice(index, 1);

    // Perform updates.
    Promise.all([
      datastore.update({key: load[Datastore.KEY], data: load}),
      datastore.update({key: boat[Datastore.KEY], data: boat})
    ]).then(_ => {
      // Updates successful.
      res.status(204).send();
    }).catch(e => {
      // Error occurred during updates.
      handleServerError(res, next, e);
    });

  }).catch(e => {
    if (e.code === 3) {
      // boat_id or load_id was non-int.
      handleClientError(res, 404, BOAT_OR_LOAD_NOT_FOUND, next);
    } else {
      handleServerError(res, next, e);
    }
  });
});

/* Delete a boat. */
router.delete('/:boat_id', async (req, res, next) => {
  let boat;
  let loads;

  // Find boat.
  const id = parseInt(req.params.boat_id, 10);
  try {
    boat = await findEntity(BOATS, id);
  } catch(e) {
    if (e.code === 3) {
      // boat_id was non-int.
      handleClientError(res, 404, BOAT_NOT_FOUND, next);
    } else {
      handleServerError(res, next, e);
    }
    return;
  }
  
  // Boat did not exist or user does not own it.
  if (!boat) {
    return handleClientError(res, 404, BOAT_NOT_FOUND, next);
  } else if (boat.owner !== req.user.sub) {
    return handleClientError(res, 403, NOT_OWNER);
  }

  // Get loads for the boat.
  const toNull = boat.loads.map(load => datastore.key([LOADS, load.id]));
  if (toNull.length > 0) {
    // If loads exist, fetch them.
    try {
      [loads] = await datastore.get(toNull);
    } catch(e) {
      handleServerError(res, next, e);
      return;
    }

    // Prepare to set load's carrier to null.
    for (let load of loads) {
      load.carrier = null;
    }
  }

  // Delete boat and update loads.
  Promise.all([
    datastore.delete(boat[Datastore.KEY]),
    datastore.update(loads || [])
  ]).then(_ => res.status(204).send())
    .catch(e => handleServerError(res, next, e));
});

/* View all boats. */
router.get('/', async (req, res, next) => {
  let boats;
  let info;

  // Create query.
  const query = datastore
    .createQuery(BOATS)
    .filter('owner', '=', req.user.sub);

  try {
    [boats, info] = await pagedQuery(query, 5, req.query.cursor);
  } catch(e) {
    return handleServerError(res, next, e);
  }
 
  // Build response body.
  const respBody = {}
  respBody.items = boats.map(boat => {
    return boatRepr(parseInt(boat[Datastore.KEY].id, 10), boat, req.serverName(), false);
  });
  if (info.moreResults === Datastore.MORE_RESULTS_AFTER_LIMIT) {
    respBody.next = `${req.serverName()}/boats?cursor=${encodeURIComponent(info.endCursor)}`;
  }

  // Return loads.
  res.status(200).send(respBody);
});

/* Edit a boat. */
router.put('/:boat_id', async (req, res, next) => {
  // Validate request.
  const boat = getBoatProps(req);
  if (isBadRequest(boat)) {
    return handleClientError(res, 400, BAD_REQUEST);
  }

  // Find boat.
  const id = parseInt(req.params.boat_id, 10);
  let stored;
  try {
    stored = await findEntity(BOATS, id);
  } catch(e) {
    if (e.code === 3) {
      // boat_id was non-int.
      handleClientError(res, 404, BOAT_NOT_FOUND, next);
    } else {
      handleServerError(res, next, e);
    }
    return;
  }

  // Boat did not exist or user does not own it.
  if (!stored) {
    return handleClientError(res, 404, BOAT_NOT_FOUND, next);
  } else if (stored.owner !== req.user.sub) {
    return handleClientError(res, 403, NOT_OWNER);
  }

  const updated = {owner: stored.owner, loads: stored.loads, ...boat};
  const key = datastore.key([BOATS, id]);
  try {
    await datastore.update({key, data: updated});
  } catch (err) {
    // Pass to server error handler.
    return handleServerError(res, next, e);
  }

  // Return boat representation.
  const respBody = boatRepr(parseInt(key.id, 10), updated, req.serverName());
  res.status(200).send(respBody);
});

/* Edit a boat. */
router.patch('/:boat_id', async (req, res, next) => {
  // Validate request.
  const boat = getBoatProps(req);

  // Find boat.
  const id = parseInt(req.params.boat_id, 10);
  let stored;
  try {
    stored = await findEntity(BOATS, id);
  } catch(e) {
    if (e.code === 3) {
      // boat_id was non-int.
      handleClientError(res, 404, BOAT_NOT_FOUND, next);
    } else {
      handleServerError(res, next, e);
    }
    return;
  }

  // Boat did not exist or user does not own it.
  if (!stored) {
    return handleClientError(res, 404, BOAT_NOT_FOUND, next);
  } else if (stored.owner !== req.user.sub) {
    return handleClientError(res, 403, NOT_OWNER);
  }

  // Get missing props.
  for (let prop in boat) {
    if (boat[prop] === undefined) {
      boat[prop] = stored[prop];
    }
  }

  const updated = {owner: stored.owner, loads: stored.loads, ...boat};
  const key = datastore.key([BOATS, id]);
  try {
    await datastore.update({key, data: updated});
  } catch (err) {
    // Pass to server error handler.
    return handleServerError(res, next, e);
  }

  // Return boat representation.
  const respBody = boatRepr(parseInt(key.id, 10), updated, req.serverName());
  res.status(200).send(respBody);
});

module.exports = router;
