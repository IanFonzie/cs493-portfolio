const {datastore, Datastore, USERS} = require('../datastore');
const {handleServerError} = require('../utils');

const express = require('express');
const router = express.Router();

/* Render user info. */
router.get('/user', (req, res, next) => {
  // Assert user is authenticated.
  if (req.user) {
    return next();
  }

  // Redirect unauthenticated users.
  req.session.returnTo = req.originalUrl;
  res.redirect('/auth/login');
}, async (req, res, next) => {
  // Add the user to the database if they do not already exist.
  const key = datastore.key([USERS, req.user.id]);
  const userEntity = {
    key,
    data: {}
  };
  const transaction = datastore.transaction();
  try {
    await transaction.run();
    const [user] = await transaction.get(key);
    if (user) {
      // User already exists.
      await transaction.rollback();
    } else {
      // Create the user entity.
      transaction.save(userEntity);
      await transaction.commit();
    }
  } catch (err) {
    console.log(err)
    await transaction.rollback();
  }

  res.status(200).render('info', {
    jwt: req.session.idToken,
    userId: req.user.id 
  });
});

router.get('/users', async (req, res, next) => {
  let users;

  // Construct users query.
  const query = datastore.createQuery(USERS);

  try {
    // Run query.
    [users] = await datastore.runQuery(query);
  } catch (err) {
    // Pass to server error handler.
    handleServerError(res, next, err)
    return;
  }
  
  const respBody = users.map(user => {
    return {id: user[Datastore.KEY].name}
  });
  res.status(200).send(respBody);
})

module.exports = router;