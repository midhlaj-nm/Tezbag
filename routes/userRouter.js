const express = require('express')
const router = express.Router()
const userController = require('../controllers/user/userController');
const productPageController = require('../controllers/user/productPageController');
const profileController = require('../controllers/user/profileController')
const passport = require('passport');
const userAuth = require('../middlewares/userAuth');

router.get('/', userController.loadHomepage);
router.get('/404Error', userController.load404)

router.get('/login', userController.login_user);
router.post('/login', userController.logpost);
router.get('/register', userController.register);
router.post('/register', userController.regpost);

// OTP & Verification
router.get('/otp-page', userController.otpver);
router.post('/verify-otp-reg', userController.verifyOtp);
router.get('/resend-otp', userController.resendOtp);

// Google Registration
router.get('/auth/google/signup', passport.authenticate('google-registration', { scope: ['profile', 'email'] }));
router.get('/auth/google/callback/register',
  passport.authenticate('google-registration', {
    failureRedirect: '/login',
    failureFlash: true
  }),
  (req, res) => {
    res.redirect('/');
  }
);

// Google Login
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

// Forget Password Flow
router.get('/forget-password', userController.loadVerifyEmail);
router.post('/verify-email', userController.loadVerifyEmailPost);
router.post('/verify-otp', userController.verifyOtpPost);
router.get('/reset-password', userController.loadResetPassPage);
router.post('/reset-password', userController.resetPasswordPost);

// profileController.js
router.get('/account-settings', userAuth, profileController.loadSettings);
router.get('/account', userAuth, profileController.loadDashboard);
router.get('/logout', userAuth, userController.logout);

//productPage
router.get('/shop', userAuth, productPageController.loadshop)
router.get('/product/:id', userAuth, productPageController.loadProductDetails)

module.exports = router