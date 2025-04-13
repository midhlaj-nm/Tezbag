const express = require('express')
const router = express.Router()
const userController = require('../controllers/user/userController');
const passport = require('passport');

router.get('/',userController.loadHomepage)
router.get('/login', userController.login_user);
router.post('/register',userController.regpost)
router.get('/register', userController.register);
router.get('/otp-page',userController.otpver)
router.post('/verify-otp',userController.verifyOtp)
router.get('/auth/google', passport.authenticate('google',{scope:['profile','email']}));
router.get('/auth/google/sign',
    passport.authenticate('google', {
      failureRedirect: '/login',
      failureFlash: true
    }),
    (req, res) => {
      // Success redirect
      res.redirect('/');
    }
  );
  




module.exports = router