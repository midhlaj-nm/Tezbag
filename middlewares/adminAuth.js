const Admin = require('../models/adminSchema');

const adminAuth = async (req, res, next) => {
  try {
    console.log("🛡️ Checking admin session...");
    console.log("Session object:", req.session);
    console.log("admin in session:", req.session.admin);

    if (!req.session.admin) {
      console.log("❌ No admin in session. Redirecting to login.");
      return res.redirect('/tezgrani/login');
    }

    const admin = await Admin.findById(req.session.admin);
    console.log("This is our admin", admin);
    console.log(req.session.admin);

    if (!admin || !admin.isAdmin) {
      console.log("⛔ Invalid or non-admin user. Destroying session.");
      req.session.destroy(() => {
        res.redirect('/tezgrani/login');
      });
    } else {
      console.log("✅ Admin verified. Proceeding...");
      return next();
    }
  } catch (err) {
    console.log("❌ Admin auth error:", err);
    res.redirect('/tezgrani/login');
  }
};

module.exports = adminAuth;