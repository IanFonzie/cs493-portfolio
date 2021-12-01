const {datastore, Datastore, BOATS, LOADS, USERS, findEntity, pagedQuery} = require('../datastore');
const {handleClientError, handleServerError, loadRepr, checkJwt} = require('../utils');

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

  representation.self = `${baseUrl}/boats/${id}`;

  return representation;
}

async function checkRegistered(req, res, next) {
  let user;

  try {
    user = await findEntity(USERS, req.user.sub);
  } catch (err) {
    handleServerError(res, next, err);
    return;
  }

  
  if (!user) {
    handleClientError(res, 403, 'The associated user is not registered.', next);
    return;
  }
  
  next();
}

const BAD_REQUEST = 'The request object is missing at least one of the required attributes';
const BOAT_NOT_FOUND = 'No boat with this boat_id exists';
const BOAT_OR_LOAD_NOT_FOUND = 'The specified boat and/or load does not exist';
const LOAD_ALREADY_ASSIGNED = 'The load is already assigned';
const LOAD_ELSEWHERE = 'The load is not on this boat';

/* Create a boat. */
router.post('/', checkJwt, checkRegistered, async (req, res, next) => {
  // Validate request.
  const boat = getBoatProps(req);
  if (isBadRequest(boat)) {
    handleClientError(res, 400, BAD_REQUEST, next);
    return;
  }

  // Add default loads.
  boat.loads = [];

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
router.get('/:boat_id', checkJwt, checkRegistered, async (req, res, next) => {
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

  // Boat with boat_id was not found.
  if (!boat) {
    handleClientError(res, 404, BOAT_NOT_FOUND, next);
    return;
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

    // Load exists but is already assigned.
    if (load.carrier) {
      handleClientError(res, 403, LOAD_ALREADY_ASSIGNED, next);
      return;
    }

    // Set load's carrier.
    load.carrier = {
      id: boatId,
      name: boat.name
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
router.delete('/:boat_id', checkJwt, checkRegistered, async (req, res, next) => {
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
  
  // Boat did not exist.
  if (!boat) {
    handleClientError(res, 404, BOAT_NOT_FOUND, next);
    return;
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

/* View all loads for a given boat. */
router.get('/:boat_id/loads', checkJwt, checkRegistered, async (req, res, next) => {
  let boat;
  let loads;
  let respBody;

  // Find boat.
  let id = parseInt(req.params.boat_id, 10);
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

  // Boat did not exist.
  if (!boat) {
    handleClientError(res, 404, BOAT_NOT_FOUND, next);
    return;
  }

  // Fetch boat's loads.
  const toFetch = boat.loads.map(load => datastore.key([LOADS, load.id]));
  if (toFetch.length > 0) {
    try {
      [loads] = await datastore.get(toFetch);
    } catch(e) {
      handleServerError(res, next, e);
      return;
    }

    respBody = loads.map(load => {
      return loadRepr(parseInt(load[Datastore.KEY].id, 10), load, req.serverName())
    });
  }

  // Return loads or an empty array if none exist.
  res.status(200).send(respBody || []);
});

/* View all boats. */
router.get('/', checkJwt, checkRegistered, async (req, res, next) => {
  let boats;
  let info;

  // Create query.
  const query = datastore.createQuery(BOATS);
  try {
    [boats, info] = await pagedQuery(query, 5, req.query.cursor);
  } catch(e) {
    handleServerError(res, next, e);
    return;
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

module.exports = router;
