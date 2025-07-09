const express = require('express')
const router = express.Router()
const userController = require('../controllers/user/userController');
const productPageController = require('../controllers/user/productPageController');
const profileController = require('../controllers/user/profileController');
const cartPageController = require('../controllers/user/cartPageController');
const orderController = require('../controllers/user/orderController');
const wishlistController = require('../controllers/user/wishlistPageController');
const walletController = require('../controllers/user/walletController')
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
    if(req.user){
      req.session.user = req.user._id
      console.log('🔐 Session user set to:', req.session.user);
      console.log('')
    }
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
router.get('/account', userAuth, profileController.loadDashboard);
router.get('/account-settings', userAuth, profileController.loadSettings);
router.get('/email-update-otp', userAuth, profileController.emailOtpPage);
router.post('/verify-email-otp', userAuth, profileController.otpVerification);
router.patch('/account-settings/update-profile', userAuth, profileController.updateProfile);
router.post('/account-settings/add-address', userAuth, profileController.addAddress);
router.patch('/account-settings/edit-address', userAuth, profileController.editAddress);
router.delete('/account-settings/delete-address/:index', userAuth, profileController.deleteAddress);
router.post('/account-settings/password-reset', userAuth, profileController.changePassword);
router.get('/logout', userAuth, userController.logout);

//productPage
router.get('/shop', productPageController.loadshop);
router.get('/product/:id', productPageController.loadProductDetails);

//cartPageController
router.get('/cart', userAuth, cartPageController.loadCart);
router.post('/cart/add/:productId', userAuth, cartPageController.addToCart)
router.patch('/cart/increase-quantity', userAuth, cartPageController.increaseQuantity);
router.patch('/cart/decrease-quantity', userAuth, cartPageController.decreaseQuantity);
router.delete('/cart/remove-item', userAuth, cartPageController.removeItem);
router.delete('/cart/clear', userAuth, cartPageController.clearCart);

//orderController
router.get('/cart/checkout', userAuth, orderController.loadCheckout);
router.post('/order/place', userAuth, orderController.confirmOrder);
router.get('/order-confirmation/:orderId', userAuth, orderController.loadConfirmation);
router.get('/download-invoice/', userAuth, orderController.downloadInvoice)
router.get('/order-history', userAuth, orderController.loadOrderHistory)
router.post('/cancel-order/:orderId', userAuth, orderController.cancelOrder)
router.post('/return-order/:orderId', userAuth, orderController.returnOrder)

//wishlist
router.get('/wishlist', wishlistController.loadWishlist)
router.post('/wishlist/add-or-remove', wishlistController.wishlistPrdct)

//wallet
router.get('/wallet', walletController.loadWallet)

module.exports = router