const express = require('express')
const router = express.Router()
const userController = require('../controllers/user/userController')

router.get('/',userController.loadHomepage)
router.get('/login', userController.login_user);
router.post('/register',userController.regpost)
router.get('/register', userController.register);
router.get('/otp-page',userController.otpver)
router.post('/verify-otp',userController.verifyOtp)
router.get('/resend-otp', userController.resendOtp);





module.exports = router