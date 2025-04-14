const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/userSchema');
require('dotenv').config();

passport.use('google-registration',new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: '/auth/google/callback/register'
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      console.log("🔁 Google Strategy triggered");
      console.log("🔐 Access Token:", accessToken);
      console.log("👤 Google Profile ID:", profile.id);
      console.log("📧 Email from Google:", profile.emails?.[0]?.value);

      const email = profile.emails?.[0]?.value;
      const googleId = profile.id;

      const existingUser = await User.findOne({ email });

      if (existingUser) {
        console.log("✅ Existing user found:", existingUser.email);
        return done(null, false, {
          message: "This email already exists. Please log in."
        });
      }

      const newUser = new User({
        f_Name: profile.name?.givenName || "Google",
        l_Name: profile.name?.familyName || "User",
        email,
        googleId
      });

      const savedUser = await newUser.save();
      console.log("🎉 New Google user created:", savedUser.email);
      return done(null, savedUser);

    } catch (err) {
      console.error("❌ Error in Google Strategy:", err);
      return done(err, null);
    }
  }
));

passport.serializeUser((user, done) => {
  console.log("📦 Serializing user with ID:", user.id);
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  User.findById(id)
    .then(user => {
      console.log("📤 Deserialized user:", user?.email);
      done(null, user);
    })
    .catch(err => {
      console.log("📤 Deserialized user:", user?.email);
      done(err, null);
    });
});

// ✅ Export passport instance
module.exports = passport;