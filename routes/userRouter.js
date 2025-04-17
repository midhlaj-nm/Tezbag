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
router.post('/verify-otp-reg',userController.verifyOtp)

//Google Registration
router.get('/auth/google/signup', passport.authenticate('google-registration',{scope:['profile','email']}));
router.get('/auth/google/callback/register',
  passport.authenticate('google-registration', {
    failureRedirect: '/login',
    failureFlash: true
  }),
  (req, res) => {
    // Success redirect
    res.redirect('/');
  }
);

//Google Login
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


router.get('/forget-password',userController.loadVerifyEmail);
router.post('/verify-email',userController.loadVerifyEmailPost);
router.post('/verify-otp', userController.verifyOtpPost);
router.get('/reset-password',userController.loadResetPassPage)
router.post('/reset-password', userController.resetPasswordPost);




//profileController.js
router.get('/account-settings',userController.loadSettings);
router.get('/account', userController.loadDashboard);
router.get('/logout',userController.logout)

module.exports = router



//.zny.3D8_4PLhhJ - old password