const express = require("express");
const app = express();
const path = require("path");
const session = require("express-session");
const env = require("dotenv").config();
const flash = require('connect-flash');
const db = require("./config/db");
const userRouter = require("./routes/userRouter");
const errorHandler = require('./middlewares/errorHandler');
const passport = require('./config/passport')
db();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: false,
      httpOnly: true,
      maxAge: 48 * 60 * 60 * 1000,
    },
  })
);

app.use(flash());

app.use((req, res, next) => {
  res.locals.message = req.flash('error');
  next();
});

app.set("view engine", "ejs");
app.set("views", [
  path.join(__dirname, "views/User"),
  path.join(__dirname, "views/Admin"),
]);
app.use(express.static(path.join(__dirname, "public")));
app.use(passport.initialize());
app.use(passport.session())
app.use("/", userRouter);
app.use(errorHandler);


app.listen(process.env.PORT, () => {
  console.log("Server running");
});

module.exports = app;
