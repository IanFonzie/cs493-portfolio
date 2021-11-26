function setErrorState(res, statusCode, message) {
  res.status(statusCode).locals.errorMsg = message;
}

exports.handleClientError = function(res, statusCode, message, next) {
  setErrorState(res, statusCode, message);
  next();
}

exports.handleServerError = function(res, next, error) {
  setErrorState(res, 500, 'Something went wrong. We will fix it shortly.')
  next(error);
}

exports.loadRepr = function(id, load, baseUrl) {
  let carrier;

  // Format carrier.
  if (load.carrier) {
    carrier = {
      id: load.carrier.id,
      name: load.carrier.name,
      self: `${baseUrl}/boats/${load.carrier.id}`
    }
  }

  return {
    id,
    volume: load.volume,
    carrier: carrier || null,
    content: load.content,
    creation_date: load.creation_date.toLocaleDateString('en-US'),
    self: `${baseUrl}/loads/${id}`
  };
}
