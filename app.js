const express = require("express");
const app = express();
const path = require("path");
const session = require("express-session");
const flash = require('connect-flash');
const env = require("dotenv").config();
const db = require("./config/db");
const userRouter = require("./routes/userRouter");
const adminRouter = require('./routes/adminRouter')
const errorHandler = require('./middlewares/errorHandler');
const passport = require('./config/passport')
const passport_login = require('./config/passport-login')
const stateRouter = require('./routes/countryStateApi');
db();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      httpOnly: true,
      maxAge: 48 * 60 * 60 * 1000,
    },
  })
);

app.use(flash());


app.set("view engine", "ejs");
app.set("views", [
  path.join(__dirname, "views/User"),
  path.join(__dirname, "views/Admin"),
]);
app.use(express.static(path.join(__dirname, "public")));
app.use(passport.initialize());
app.use(passport.session())
app.use(passport_login.initialize());
app.use(passport_login.session())
app.use("/", userRouter);
app.use('/tezgrani', adminRouter);
app.use('/api', stateRouter);
app.use(errorHandler);

app.use((req, res) => {
  const isAdminRoute = req.originalUrl.startsWith('/tezgrani');

  if (isAdminRoute) {
    res.status(404).render('404-adm'); // no isAdmin needed
  } else {
    res.status(404).render('404');  // no isAdmin needed
  }
});



app.listen(process.env.PORT, () => {
  console.log("Server running");
});