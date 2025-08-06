const express = require('express');

const router = express.Router();
const adminController = require('../controllers/admin/adminController');
const userManageController = require('../controllers/admin/userManageController');
const categoryManageController = require('../controllers/admin/categoryManageController');
const productManagementController = require('../controllers/admin/productManagementController');
const dealsManageController = require('../controllers/admin/dealsManageController');
const orderController = require('../controllers/admin/orderController');
const salesController = require('../controllers/admin/salesController');
const returnManagementController = require('../controllers/admin/returnManagementController');
const galleryManagement = require('../controllers/admin/bannerController');
const adminAuth = require('../middlewares/adminAuth');
const upload = require('../middlewares/multer');

// adminController
router.get('/login', adminController.loadLogin);
router.post('/login', adminController.verifyLogin);
router.get('/verifyotp', adminController.loadOtp);
router.post('/verify-otp', adminController.verifyOtp);
router.post('/resend-verify-otp', adminController.resendOtp);
router.get('/dashboard', adminAuth, adminController.loadDashboard);
router.patch('/punch-in', adminAuth, adminController.storePunchin);
router.patch('/punch-out', adminAuth, adminController.storePunchout);
router.get('/logout', adminAuth, adminController.logoutAdmin);

// userManageController
router.get('/user-management', adminAuth, userManageController.loadUsersPage);
router.patch('/user/block-toggle/:id', adminAuth, userManageController.isAction);

// categoryManageController
router.get('/category-management', adminAuth, categoryManageController.loadCategory);
router.post('/category/save', adminAuth, upload.array('images', 1), categoryManageController.addCategory);
router.patch('/list-toggle/:categoryId', adminAuth, categoryManageController.toggleCategoryStatus);
router.patch('/category/update/:id', adminAuth, upload.array('images', 1), categoryManageController.editCategory);

// productManageController
router.get('/product-management', adminAuth, productManagementController.loadProduct);
router.post('/product/save', adminAuth, upload.array('images', 5), productManagementController.addProduct);
router.patch('/product/toggle-block/:productId', adminAuth, productManagementController.toggleProductStatus);
router.patch('/product/edit/:productId', adminAuth, upload.array('images'), productManagementController.editProduct);

// dealsManageController
router.get('/deals-management', adminAuth, dealsManageController.loadDeals);
router.post('/deals/save', adminAuth, dealsManageController.saveDeals);
router.patch('/deals/edit/:dealId', adminAuth, dealsManageController.editDeals);
router.delete('/deals/delete/:dealId', adminAuth, dealsManageController.deleteDeal);

// orderController
router.get('/order-management', adminAuth, orderController.loadOrder);
router.post('/update-status/:orderId', adminAuth, orderController.updateStatus);
router.get('/order-details/:orderId', adminAuth, orderController.loadOrderDetails);
router.patch('/cancel-order/:orderId', adminAuth, orderController.cancelOrder);

// returnManagementController
router.get('/return-management', adminAuth, returnManagementController.loadReturn);
router.patch('/update-return-status', adminAuth, returnManagementController.changeStatus);

// salesController
router.get('/sales-report', adminAuth, salesController.loadSales);

// galleryManagement
router.get('/gallery-management', galleryManagement.loadGallery);
router.post('/banner/save', upload.single('bannerImage'), galleryManagement.saveBanner);
router.patch('/banner/toggle-status/:bannerId', galleryManagement.toggleBannerStatus);
router.delete('/banner/delete/:bannerId', galleryManagement.deleteBanner);

module.exports = router;
