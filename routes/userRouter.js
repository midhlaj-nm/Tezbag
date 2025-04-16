const express = require('express')
const router = express.Router()
const userController = require('../controllers/user/userController');
const passport = require('passport');

router.get('/',userController.loadHomepage)
router.get('/login', userController.login_user);
router.post('/login', userController.logpost);
router.post('/register',userController.regpost)
router.get('/register', userController.register);
router.get('/otp-page',userController.otpver)
router.post('/verify-otp',userController.verifyOtp)
router.get('/auth/google/signup', passport.authenticate('google-registration',{scope:['profile','email']}));
router.get('/auth/google/callback/register',
  passport.authenticate('google-registration', {
    failureRedirect: '/register',
    failureFlash: true
  }),
  (req, res) => {
    // Success redirect
    res.redirect('/');
  }
);
router.get('/auth/google/login', passport.authenticate('google-login', { scope: ['profile', 'email'] }));
router.get('/auth/google/callback/login',
  passport.authenticate('google-login', {
    failureRedirect: '/login',
    failureFlash: true
  }),
  (req, res) => {
    res.redirect('/');
  }
);
router.get('/verify-email',userController.loadVerifyEmail)
router.post('/verify-email',userController.loadVerifyEmailPost)
router.get('/account-settings',userController.loadSettings);
router.get('/account', userController.loadDashboard);
router.get('/logout',userController.logout)

module.exports = router