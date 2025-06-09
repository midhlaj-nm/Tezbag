const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin/adminController');
const userManageController = require('../controllers/admin/userManageController');
const categoryManageController = require('../controllers/admin/categoryManageController');
const productManagementController = require('../controllers/admin/productManagementController');
const dealsManageController = require('../controllers/admin/dealsManageController');
const adminAuth = require('../middlewares/adminAuth');
const upload = require('../middlewares/multer')


//adminController
router.get('/login', adminController.loadLogin); 
router.post('/login', adminController.verifyLogin);
router.get('/verifyotp',adminController.loadOtp);
router.post('/verify-otp',adminController.verifyOtp);
router.get('/resend-otp', adminController.resendOtp);
router.get('/dashboard', adminAuth, adminController.loadDashboard);
router.patch('/punch-in', adminAuth, adminController.storePunchin);
router.patch('/punch-out', adminAuth, adminController.storePunchout);
router.get('/logout', adminAuth, adminController.logoutAdmin);

//userManageController
router.get('/user-management', adminAuth, userManageController.loadUsersPage);
router.patch('/user/block-toggle/:id', adminAuth, userManageController.isAction);

//categoryManageController
router.get('/category-management',adminAuth, categoryManageController.loadCategory);
router.post('/category/save',adminAuth,  upload.array('images', 1), categoryManageController.addCategory);
router.patch('/list-toggle/:categoryId',adminAuth, categoryManageController.toggleCategoryStatus);
router.patch('/category/update/:id',adminAuth,  upload.array('images', 1), categoryManageController.editCategory);

//productManageController
router.get('/product-management', adminAuth, productManagementController.loadProduct);
router.post('/product/save', adminAuth, upload.array('images', 5), productManagementController.addProduct)
router.patch('/product/toggle-block/:productId', adminAuth, productManagementController.toggleProductStatus)
router.patch('/product/edit/:productId', adminAuth, upload.array('images'), productManagementController.editProduct)

//dealsManageController
router.get('/deals-management', adminAuth, dealsManageController.loadDeals);
router.post('/deals/save', adminAuth, dealsManageController.saveDeals);
router.patch('/deals/edit/:dealId', adminAuth, dealsManageController.editDeals)
router.delete('/deals/delete/:dealId', adminAuth, dealsManageController.deleteDeal)


module.exports = router;