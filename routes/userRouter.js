const express = require('express')
const router = express.Router()
const userController = require('../controllers/user/userController')

router.get('/home',userController.loadHomepage)
router.get('/login',userController.login_user)
router.get('/forgetPassword',userController.forgetPass)
router.get('/resetPassword',userController.resetPass)
router.get('/createAccount',userController.createAcc)
router.get('/otp',userController.otpVerify)
router.get('/shop',userController.shop)
router.get('/productDescription', userController.prdctDescription)




module.exports = router