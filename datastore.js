const { Datastore } = require('@google-cloud/datastore');

exports.Datastore = Datastore;
exports.datastore = new Datastore();

/* Kinds */
exports.BOATS = 'Boats';
exports.LOADS = 'Loads';
exports.USERS = 'Users';

/* Helpers */
exports.findEntity = async function findEntity(kind, id) {
  // Finds an entity and returns it to the caller.
  const key = exports.datastore.key([kind, id]);
  let [entity] = await exports.datastore.get(key);

  return entity;
}

exports.pagedQuery = async function(query, limit, cursor) {
  query.limit(limit);

  // Start query at cursor if present.
  if (cursor) {
    query = query.start(cursor);
  }
  return await exports.datastore.runQuery(query);
}
