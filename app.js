const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');

const boatRouter = require('./routes/boats');
const loadsRouter = require('./routes/loads');

const app = express();
app.set('trust proxy', true);

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Add server name to request.
app.use((req, res, next) => {
  req.serverName = () => `${req.protocol}://${req.get('host')}`;
  next();
});

app.use('/boats', boatRouter);
app.use('/loads', loadsRouter);

// Handle 4xx errors.
app.use((req, res, next) => {
  res.send({Error: res.locals.errorMsg});
});

// Handle 5xx errors.
app.use(function (err, req, res, next) {
  console.error(err.stack)
  res.send({Error: res.locals.errorMsg});
});

module.exports = app;
