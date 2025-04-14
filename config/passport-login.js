const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/userSchema');
require('dotenv').config();


passport.use('google-login', new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: '/auth/google/callback/login'
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      console.log("🔁 Google Login Strategy triggered");
      console.log("🔐 Access Token:", accessToken);
      console.log("👤 Google Profile ID:", profile.id);
      console.log("📧 Email from Google:", profile.emails?.[0]?.value);
  
      const email = profile.emails?.[0]?.value;
      const user = await User.findOne({ email });
  
      if (!email || !user) {
        console.log("❌ No user found with this Google email");
        return done(null, false, { message: "No user found. Please register first." });
      }
  
      if (!user.googleId) {
        console.log("⚠️ User has not registered via Google. Block login.");
        return done(null, false, {
          message: "Account exists. Please log in using email and password."
        });
      }
  
      if (user.isBlocked) {
        console.log("⛔ User is blocked");
        return done(null, false, {
          message: "Your entry is Blocked by Authorities"
        });
      }
  
      console.log("✅ Google login successful for:", user.email);
      return done(null, user);
  
    } catch (err) {
      console.error("❌ Error in Google Login Strategy:", err);
      return done(err, null);
    }
  }));
  
  
  // Serialize/Deserialize
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
        console.log("❌ Error in deserialization:", err);
        done(err, null);
      });
  });
  
// ✅ Export passport instance
module.exports = passport;