const User = require('../models/userSchema'); 
const userAuth = async (req, res, next) => {
  try {
    console.log("🛡️ Checking user session...");
    console.log("Session data:", req.session);

    // Step 1: Check if session contains userId
    if (!req.session.user) {
      console.log("❌ No userId found in session. Redirecting to login.");
      return res.redirect('/login'); 
    }

    // Step 2: Fetch the user from the DB
    const user = await User.findById(req.session.user);
    console.log("🔍 Fetched user from DB:", user);

    // Step 3: Validate user existence and block status
    if (!user) {
      console.log("⛔ User not found in DB. Destroying session.");
      return req.session.destroy(() => res.redirect('/login'));
    }

    if (user.isBlocked) {
      console.log("🚫 User is blocked. Destroying session.");
      return req.session.destroy(() => res.redirect('/login'));
    }

    // Step 4: All good, proceed
    console.log("✅ User verified. Access granted.");
    next();

  } catch (err) {
    console.log("❌ Error in userAuth middleware:", err);
    res.redirect('/login');
  }
};

module.exports = userAuth;