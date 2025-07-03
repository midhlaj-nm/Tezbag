const express = require('express')
const router = express.Router()
const userController = require('../controllers/user/userController');
const productPageController = require('../controllers/user/productPageController');
const profileController = require('../controllers/user/profileController');
const cartPageController = require('../controllers/user/cartPageController');
const orderController = require('../controllers/user/orderController')
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
router.get('/account',  profileController.loadDashboard);
router.get('/account-settings', profileController.loadSettings);
router.get('/email-update-otp', profileController.emailOtpPage);
router.post('/verify-email-otp', profileController.otpVerification);
router.patch('/account-settings/update-profile', profileController.updateProfile);
router.post('/account-settings/add-address', profileController.addAddress);
router.patch('/account-settings/edit-address', profileController.editAddress);
router.delete('/account-settings/delete-address/:index', profileController.deleteAddress);
router.post('/account-settings/password-reset', profileController.changePassword);
router.get('/logout', userAuth, userController.logout);

//productPage
router.get('/shop', productPageController.loadshop);
router.get('/product/:id', productPageController.loadProductDetails);

//cartPageController
router.get('/cart', cartPageController.loadCart);
router.post('/cart/add/:productId', cartPageController.addToCart)
router.patch('/cart/increase-quantity', cartPageController.increaseQuantity);
router.patch('/cart/decrease-quantity', cartPageController.decreaseQuantity);
router.delete('/cart/remove-item', cartPageController.removeItem);
router.delete('/cart/clear', cartPageController.clearCart);

//orderCOntroller
router.get('/cart/checkout', orderController.loadCheckout);
router.post('/order/place', orderController.confirmOrder);
router.get('/order-confirmation/:orderId', orderController.loadConfirmation);

module.exports = router