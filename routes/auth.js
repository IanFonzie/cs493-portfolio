const express = require('express');
const router = express.Router();
const passport = require('passport');
const querystring = require('querystring');
const dotenv = require('dotenv');

dotenv.config();

/* Login page. */
router.get('/login', passport.authenticate('auth0', {
  scope: 'openid email profile'
}));

/* Auth0 callback page. */
router.get('/callback', (req, res, next) => {
  passport.authenticate('auth0', (err, user, info) => {
    if (err) {
      return next(err);
    }

    if (!user) {
      return res.redirect('/auth/login');
    }

    req.logIn(user, (err) => {
      if (err) {
        return next(err);
      }

      const returnTo = req.session.returnTo;
      delete req.session.returnTo;

      req.session.idToken = info.idToken;
      res.redirect(returnTo || '/user');
    });
  })(req, res, next)
});

/* Logout page. */
router.get('/logout', (req, res, next) => {
  req.logout();

  const logoutURL = new URL(
    `https://${process.env.AUTH0_DOMAIN}/v2/logout`
  );

  const searchString = querystring.stringify({
    client_id: process.env.AUTH0_CLIENT_ID,
    returnTo: `${req.serverName()}/auth/login`
  });

  logoutURL.search = searchString;

  res.redirect(logoutURL);
});

/* Handle auth specific errors. */
router.use((err, req, res, next) => {
  res.status(500).render('error', {
    message: 'Something went wrong. We will fix it shortly.',
    error: {status: 500, stack: err.stack}
  });
  return;
});

module.exports = router;
