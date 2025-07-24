const User = require('../models/userSchema'); 
const userAuth = async (req, res, next) => {
  try {
    // Step 1: Check if session contains userId
    if (!req.session.user) {
      return res.redirect('/'); 
    }

    // Step 2: Fetch the user from the DB
    const user = await User.findById(req.session.user);

    // Step 3: Validate user existence and block status
    if (!user) {
      return req.session.destroy(() => res.redirect('/'));
    }

    if (user.isBlocked) {
      return req.session.destroy(() => res.redirect('/'));
    }

    // Step 4: All good, proceed
    next();

  } catch (err) {
    res.redirect('/');
  }
};

module.exports = userAuth;