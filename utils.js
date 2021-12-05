const jwt = require('express-jwt');
const jwksRsa = require('jwks-rsa');
const dotenv = require('dotenv');

dotenv.config();

const DOMAIN = process.env.AUTH0_DOMAIN;

function setErrorState(res, statusCode, message) {
  res.status(statusCode).locals.errorMsg = message;
}

exports.handleClientError = function(res, statusCode, message, next) {
  setErrorState(res, statusCode, message);
  res.set('Content-Type', 'application/json').send({Error: res.locals.errorMsg});
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

/* JWT validation. */
exports.checkJwt = jwt({
  secret: jwksRsa.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
    jwksUri: `https://${DOMAIN}/.well-known/jwks.json`
  }),

  // Validate the audience and the issuer.
  issuer: `https://${DOMAIN}/`,
  algorithms: ['RS256']
});

// Assert request accepts correct MIME type.
exports.isAcceptable = function (req, res, next) {
  if (!(req.accepts('application/json'))) {
    const errorMsg = `Unsupported 'Accept' header: '${req.get('Accept')}'. Must accept 'application/json'`;
    return exports.handleClientError(res, 406, errorMsg);
  }
  next();
};