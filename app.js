const express = require('express');
const { engine: exphbs }  = require('express-handlebars');
const path = require('path');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const logger = require('morgan');
const dotenv = require('dotenv');
const passport = require('passport');
const Auth0Strategy = require('passport-auth0');

const boatsRouter = require('./routes/boats');	
const loadsRouter = require('./routes/loads');
const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');

dotenv.config();

// Configure Passport to use Auth0
const strategy = new Auth0Strategy(
  {
    domain: process.env.AUTH0_DOMAIN,
    clientID: process.env.AUTH0_CLIENT_ID,
    clientSecret: process.env.AUTH0_CLIENT_SECRET,
    callbackURL:
      process.env.AUTH0_CALLBACK_URL || 'http://localhost:8080/auth/callback'
  },
  function (accessToken, refreshToken, extraParams, profile, done) {
    return done(null, profile, {idToken: extraParams.id_token});
  }
);

passport.use(strategy);

passport.serializeUser(function (user, done) {
  done(null, user);
});

passport.deserializeUser(function (user, done) {
  done(null, user);
});

const app = express();

// View engine setup
app.engine('.hbs', exphbs({extname: '.hbs'}));
app.set('view engine', '.hbs');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

const sess = {
  secret: process.env.SESSION_SECRET,
  cookie: {},
  resave: false,
  saveUninitialized: true
};

if (app.get('env') === 'production') {
  app.set('trust proxy', true);
  sess.cookie.secure = true; // serve secure cookies, requires https
}

app.use(session(sess));

app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(path.join(__dirname, 'public')));

// Add server name to request.
app.use((req, res, next) => {
  req.serverName = () => {
    let serverName = req.protocol + '://' + req.hostname;
    const port = req.socket.localPort;

    if (port !== undefined && port !== 80 && port !== 443) {
      return process.env.NODE_ENV === "production"
        ? `${serverName}`
        : `${serverName}:${port}`;
    }
  }
  next();
});

app.use('/boats', boatsRouter);
app.use('/loads', loadsRouter);
app.use('/auth', authRouter);
app.use('/', usersRouter);

// Handle 404 errors.
app.use((req, res, next) => {
  res.status(404).locals.errorMsg = 'Resource not found.';
  res.set('Content-Type', 'application/json').send({Error: res.locals.errorMsg});
});

// Handle 5xx errors.
app.use((err, req, res, next) => {
  if (err.name === 'UnauthorizedError') {
    res.status(401).locals.errorMsg = 'Missing/invalid authorization';
  } else {
    console.error(err.stack)
  }

  res.set('Content-Type', 'application/json').send({Error: res.locals.errorMsg});
});

module.exports = app;
