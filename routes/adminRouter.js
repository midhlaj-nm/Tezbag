const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin/adminController'); // <- this line connects it

router.get('/login', adminController.loadLogin); 
router.post('/login', adminController.verifyLogin);
router.get('/verifyotp',adminController.loadOtp);
router.post('/verify-otp',adminController.verifyOtp);
router.get('/resend-otp', adminController.resendOtp);
router.get('/dashboard',adminController.loadDashboard);
router.patch('/punch-in',adminController.storePunchin)
router.patch('/punch-out',adminController.storePunchout)

module.exports = router;