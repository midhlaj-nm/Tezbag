const User = require('../../models/userSchema');
const Admin = require('../../models/adminSchema');
const Order = require('../../models/orderSchema');
const Deal = require('../../models/dealSchema');
const nodemailer = require('nodemailer');
require('dotenv').config();
const bcrypt = require('bcrypt');

// Render login page
const loadLogin = async (req, res) => {
  try {
    // Check if admin is already logged in
    if (req.session.admin) {
      return res.redirect('/tezgrani/dashboard');
    }
    const message = req.flash('message')[0] || null;
    console.log("📥 Rendering Admin Login Page");
    return res.render('login-adm', { message });
  } catch (err) {
    console.log('❌ Error loading login page:', err);
    res.render('404-adm');
  }
};

// Generate 4-digit OTP
function generateOtp() {
  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  console.log("🔐 OTP Generated:", otp);
  return otp;
}

// Send OTP email
async function sendVeriEmail(email, otp) {
  try {
    console.log(`📧 Sending OTP to: ${email}`);
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: {
        user: process.env.NODEMAILER_EMAIL,
        pass: process.env.NODEMAILER_PASSWORD,
      },
    });

    const info = await transporter.sendMail({
      from: process.env.NODEMAILER_EMAIL,
      to: email,
      subject: "Verify you're Authority",
      text: `${otp} is your Tezgrani's admin verification code.`,
      html: `<b>${otp} is your Tezgrani's admin verification code.</b>`,
    });

    console.log("✅ OTP Email Sent:", info.accepted);
    return info.accepted.length > 0;
  } catch (error) {
    console.error("❌ Error sending OTP email:", error);
    return false;
  }
}

// Handle login POST
const verifyLogin = async (req, res, next) => {
  try {
    const { email, password, remember } = req.body;
    console.log("🛂 Login Attempt:", email, "| Remember Me:", remember);

    const isAdm = await Admin.findOne({ email });
    console.log("🔍 Admin Lookup Result:", isAdm ? "Found" : "Not Found");

    if (!isAdm) {
      req.flash('message', 'Incorrect Email Address.');
      return res.render('login-adm', { message: req.flash('message') });
    }

    if (isAdm.isBlocked) {
      console.log("⛔ Admin is blocked:", email);
      req.flash('message', 'Your entry is Blocked by Authorities');
      return res.render('login-adm', { message: req.flash('message') });
    }

    const passwordMatch = await bcrypt.compare(password, isAdm.password);
    console.log("🔑 Password Match:", passwordMatch);

    if (!passwordMatch) {
      req.flash('message', 'Incorrect Password');
      return res.render('login-adm', { message: req.flash('message')[0] });
    }

    // Session duration config
    if (remember) {
      req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000;
      console.log("🕒 Remember Me: Session set for 7 days");
    } else {
      req.session.cookie.expires = false;
      console.log("⏱️ Temporary session until browser close");
    }

    // Generate and send OTP
    const otp = generateOtp();
    const emailSent = await sendVeriEmail(email, otp);

    if (!emailSent) {
      console.log("❌ Email sending failed for:", email);
      req.flash('message', 'Something went wrong while sending OTP. Try again later.');
      return res.render('login-adm', { message: req.flash('message') });
    }

    // Store in session
    req.session.adminOtp = otp;
    req.session.adminData = isAdm;
    req.session.adminEmail = email;
    req.session.lastOtpSentTime = Date.now();

    console.log("📝 Session updated with OTP and adminData");

    res.redirect('/tezgrani/verifyotp');
  } catch (error) {
    console.error("❌ Error in verifyLogin:", error);
    next(error);
  }
};

// Render OTP page
const loadOtp = async (req, res) => {
  try {
    // Check if admin is already logged in
    if (req.session.admin) {
      return res.redirect('/tezgrani/dashboard');
    }
    const message = req.flash('message')[0] || null;
    console.log("📥 Rendering OTP Page");
    return res.render('otp-adm', { message });
  } catch (err) {
    console.log('❌ Error loading OTP page:', err);
    res.render('404-adm');
  }
};

// Handle OTP verification
const verifyOtp = async (req, res) => {
  try {
    const { otp } = req.body;

    if (!req.session.adminOtp || !req.session.adminEmail) {
      return res.json({ message: "Session expired" });
    }

    if (otp !== req.session.adminOtp) {
      return res.json({ success: false, message: "Incorrect OTP" });
    }

    // Find admin by email (assuming OTP was emailed to this admin)
    const admin = await Admin.findOne({ email: req.session.adminEmail });
    if (!admin) {
      return res.json({ success: false, message: "Admin not found" });
    }

    // OTP is valid, set admin session
    req.session.admin = admin._id;

    // Clear OTP and email from session (optional cleanup)
    delete req.session.adminOtp;
    delete req.session.adminEmail;

    // Save session before responding
    req.session.save((err) => {
      if (err) {
        console.error("Session save error:", err);
        return res.status(500).json({ success: false, message: "Session save failed" });
      }

      // Respond with success and dashboard redirect URL
      res.json({
        success: true,
        redirectUrl: "/tezgrani/dashboard",
      });
    });

  } catch (err) {
    console.error("OTP verification error:", err);
    next(err)
  }
};

// Resend OTP
const resendOtp = async (req, res, next) => {
  try {
    console.log("🔁 Resend OTP triggered via", req.method);
    console.log("Session:", req.session); // Debug session contents

    const adminData = req.session.adminData;
    const lastSentTime = req.session.lastOtpSentTime;
    const now = Date.now();

    if (!adminData || !adminData.email) {
      console.warn("⚠️ No adminData in session");
      return next({ status: 400, message: "Session expired. Please login again." });
    }

    if (lastSentTime && (now - lastSentTime < 60000)) {
      const secondsLeft = Math.ceil((60000 - (now - lastSentTime)) / 1000);
      console.log(`⏳ Resend blocked. Wait ${secondsLeft}s`);
      return next({ status: 429, message: `Wait ${secondsLeft}s before resending.` });
    }

    const newOtp = generateOtp();
    const emailSent = await sendVeriEmail(adminData.email, newOtp);

    if (!emailSent) {
      return next({ status: 500, message: "Failed to resend OTP." });
    }

    req.session.adminOtp = newOtp;
    req.session.lastOtpSentTime = now;

    console.log("✅ New OTP resent successfully");
    res.status(200).json({ success: true, message: "OTP resent successfully." });
  } catch (error) {
    console.error("❌ Resend OTP error:", error);
    next(error);
  }
};

// Load dashboard
const loadDashboard = async (req, res) => {
  try {
    console.log("📥 Loading admin dashboard");
    const adminId = req.session.admin;

    // Fetch filter parameters or default to 'last28Days'
    const productFilter = req.query.productFilter || 'last28Days';
    const categoryFilter = req.query.categoryFilter || 'last28Days';
    const salesFilter = req.query.salesFilter || 'last28Days';

    // Fetch recent orders and logins
    const recentOrders = await Order.find().sort({ invoiceDate: -1 }).limit(3);
    const recentLogins = await User.find({ isBlocked: false }).sort({ createdOn: -1 }).limit(3).select('f_Name email createdOn');

    // Fetch basic stats
    const countOrders = await Order.countDocuments();
    console.log('This much orders till now:', countOrders);
    const countUsers = await User.countDocuments({ isBlocked: false });
    console.log('This much Users:', countUsers);
    const revenue = await Order.aggregate([{ $group: { _id: null, total: { $sum: '$finalAmount' } } }]).then(result => result[0]?.total || 0);
    console.log('This is the total revenue:', revenue);
    const pendingOrders = await Order.countDocuments({ status: 'Pending' });
    console.log('This much pending orders:', pendingOrders);

    // Fetch admin details
    const admin = await Admin.findById(adminId);
    console.log("Got it", admin);
    const name = admin?.f_Name;

    const deal = await Deal.find({ status: 'Active' }).select('name offerType expireOn');
    console.log('This are the deals running now: ', deal);

    // Start dates based on individual filters
    const now = new Date();
    const getStartDate = (filter) => {
      const date = new Date(now);
      switch (filter) {
        case 'Today':
          date.setHours(0, 0, 0, 0); // Set to start of today
          return date;
        case 'last6Month':
          return new Date(date.setMonth(date.getMonth() - 6));
        case 'last1Year':
          return new Date(date.setFullYear(date.getFullYear() - 1));
        case 'last28Days':
        default:
          return new Date(date.setDate(date.getDate() - 28));
      }
    };

    const productStartDate = getStartDate(productFilter);
    const categoryStartDate = getStartDate(categoryFilter);
    const salesStartDate = getStartDate(salesFilter);

    const topProducts = await Order.aggregate([
      { $match: { invoiceDate: { $gte: productStartDate } } },
      { $unwind: '$orderedItems' },
      {
        $lookup: {
          from: 'products',
          localField: 'orderedItems.productId',
          foreignField: '_id',
          as: 'productDetails'
        }
      },
      { $unwind: '$productDetails' },
      {
        $group: {
          _id: '$orderedItems.productId',
          productName: { $first: '$productDetails.productName' },
          totalQuantity: { $sum: '$orderedItems.quantity' },
          productImage: { $first: { $arrayElemAt: ['$productDetails.productImage', 0] } }
        }
      },
      { $sort: { totalQuantity: -1 } },
      { $limit: 10 }
    ]).exec();

    const topCategories = await Order.aggregate([
      { $match: { invoiceDate: { $gte: categoryStartDate } } },
      { $unwind: '$orderedItems' },
      {
        $lookup: {
          from: 'products',
          localField: 'orderedItems.productId',
          foreignField: '_id',
          as: 'productDetails'
        }
      },
      { $unwind: '$productDetails' },
      {
        $lookup: {
          from: 'categories',
          localField: 'productDetails.category',
          foreignField: '_id',
          as: 'categoryDetails'
        }
      },
      { $unwind: '$categoryDetails' },
      {
        $group: {
          _id: '$productDetails.category',
          categoryName: { $first: '$categoryDetails.name' },
          totalQuantity: { $sum: '$orderedItems.quantity' },
          categoryImage: { $first: '$categoryDetails.image' }
        }
      },
      { $sort: { totalQuantity: -1 } },
      { $limit: 10 }
    ]).exec();

    const salesData = await Order.aggregate([
      { $match: { invoiceDate: { $gte: salesStartDate } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$invoiceDate" } },
          totalSales: { $sum: '$finalAmount' }
        }
      },
      { $sort: { _id: 1 } }
    ]).exec();

    const labels = salesData.map(item => item._id) || [];
    const data = salesData.map(item => item.totalSales) || [];

    console.log('Top Products:', topProducts);
    console.log('Top Categories:', topCategories);
    console.log('Sales Data:', { labels, data });

    return res.render('dashboard-adm', {
      name,
      recentOrders,
      recentLogins,
      countOrders,
      countUsers,
      revenue,
      pendingOrders,
      topProducts,
      topCategories,
      deal,
      salesData: { labels, data },
      productFilter,
      categoryFilter,
      salesFilter
    });
  } catch (err) {
    console.log('❌ Error loading dashboard:', err);
    res.render('404-adm');
  }
};

const storePunchin = async (req, res, next) => {
  try {
    const adminId = req.session.admin;
    console.log("🧑‍💻 Punch-In by admin:", adminId);

    if (!adminId) return next({ status: 401, message: "Unauthorized" });

    const updatedAdmin_in = await Admin.findOneAndUpdate(
      { _id: adminId },
      { lastLogin: new Date() },
      { new: true }
    );

    console.log("✅ Punch-in time updated:", updatedAdmin_in.lastLogin);

    res.status(200).json({ message: "Punch-In Updated", time: updatedAdmin_in.lastLogin });
  } catch (error) {
    next(error);
  }
};

const storePunchout = async (req, res, next) => {
  try {
    const adminId = req.session.admin;
    console.log("🧑‍💻 Punch-Out by admin:", adminId);

    if (!adminId) return next({ status: 401, message: "Unauthorized" });

    const updatedAdmin_out = await Admin.findOneAndUpdate(
      { _id: adminId },
      { lastLogout: new Date() },
      { new: true }
    );

    console.log("✅ Punch-out time updated:", updatedAdmin_out.lastLogout);

    res.status(200).json({ message: "Punch-Out Updated", time: updatedAdmin_out.lastLogout });
  } catch (error) {
    next(error);
  }
};

const logoutAdmin = async (req, res) => {
  try {
    // Clear the user property (optional, as destroy will handle this)
    req.session.admin = null;
    // Redirect to login page
    res.redirect('/tezgrani/login');
  } catch (error) {
    console.error("❌ Logout error:", error);
    res.redirect('/404Error');
  }
};

module.exports = {
  loadLogin,
  verifyLogin,
  loadOtp,
  verifyOtp,
  resendOtp,
  loadDashboard,
  storePunchin,
  storePunchout,
  logoutAdmin
};