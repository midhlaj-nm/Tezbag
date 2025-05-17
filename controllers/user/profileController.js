const Users = require('../../models/userSchema')
const Order = require('../../models/orderSchema')
const Address = require('../../models/addressSchema')
const Product = require('../../models/productSchema')

const loadDashboard = async (req, res) => {
    try {
      const userId = req.session.user;
  
      // Fetch user details
      const user = await Users.findById(userId)
        .select('f_Name l_Name email')
        .lean();
  
      const userName = [user?.f_Name, user?.l_Name].filter(Boolean).join(' ') || 'User';
      const userEmail = user?.email || 'Not provided';
  
      // Fetch user orders
      const orders = await Order.find({ address: userId })
        .select('orderId createdOn finalAmount status')
        .sort({ createdOn: -1 })
        .lean();
  
      // Fetch first address (if any)
      const address = await Address.findOne({ userId }).lean();
      const firstAddress = address?.address?.[0];
  
      const addressDetails = firstAddress
        ? {
            streetAddress: firstAddress.streetAddress || '',
            city: firstAddress.city || '',
            pinCode: firstAddress.pinCode || '',
            phone: firstAddress.phone || ''
          }
        : 'Not provided';
  
      res.render('dashboard', {
        userName,
        userEmail,
        orders: orders || [],
        address: addressDetails
      });
  
    } catch (error) {
      console.error('❌ Error loading dashboard:', error);
      res.redirect('/404Error');
    }
  };

const loadSettings = async (req, res) => {
    try {
        res.render('settings');
    } catch (error) {
        console.error("❌ Error loading settings:", error);
        res.redirect('/404Error');
    }
};


module.exports = {loadSettings, loadDashboard}