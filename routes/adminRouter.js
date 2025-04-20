const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin/adminController');
const userManageController = require('../controllers/admin/userManageController');
const categoryManageController = require('../controllers/admin/categoryManageController')
const adminAuth = require('../middlewares/adminAuth');


//adminController
router.get('/login', adminController.loadLogin); 
router.post('/login', adminController.verifyLogin);
router.get('/verifyotp',adminController.loadOtp);
router.post('/verify-otp',adminController.verifyOtp);
router.get('/resend-otp', adminController.resendOtp);
router.get('/dashboard', adminAuth, adminController.loadDashboard);
router.patch('/punch-in', adminAuth, adminController.storePunchin);
router.patch('/punch-out', adminAuth, adminController.storePunchout);

//userManageController
router.get('/user-management', adminAuth, userManageController.loadUsersPage);
router.patch('/user/block-toggle/:id', adminAuth, userManageController.isAction);

module.exports = router;