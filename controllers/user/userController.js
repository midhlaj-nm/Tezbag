const User = require('../../models/userSchema');
const Category = require('../../models/categorySchema');
const Products = require('../../models/productSchema');
const Gallery = require('../../models/bannerSchema');
const Admin = require('../../models/adminSchema')
const env = require('dotenv').config();
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
const { LEGAL_TCP_SOCKET_OPTIONS } = require('mongodb');

// ===========================
// Load 404 Page
// ===========================
const load404 = async (req, res) => {
    try {
        res.render('404');
    } catch (err) {
        console.error('⚠️ Error loading 404 page:', err);
        res.render('404');
    }
};

// ===========================
// Generate 4-digit OTP
// ===========================
function generateOtp() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// ===========================
// Load Homepage
// ===========================
const loadHomepage = async (req, res, next) => {
    try {
      const categories = await Category.find({ isListed: true }).lean();
  
      const categoriesWithData = await Promise.all(
        categories.map(async (category) => {
          const productCount = await Products.countDocuments({ category: category._id });
          const banner = await Gallery
          .findOne({ categoryId: category._id }).lean();
  
          return {
            ...category,
            productCount,
            image: banner ? banner.image : null
          };
        })
      );
  
      if (req.session.user || req.user) {
        res.render('homepage', { categories: categoriesWithData });
      } else {
        res.render('beforelogin', { categories: categoriesWithData });
      }
  
    } catch (err) {
      console.error('❌ Error loading homepage:', err);
      next(err);
    }
  };
  
  

// ===========================
// Load Login Page
// ===========================
const login_user = async (req, res) => {
    try {
      let message = req.flash('message')[0] || null;
      let messageType = req.flash('messageType')[0] || null;
  
      if (!message) {
        message = req.flash('error')[0]; // for Passport
        messageType = 'error';
      }
  
      res.render('login_user', { message, messageType });
    } catch (err) {
      console.error('❌ Error loading login page:', err);
      res.redirect('/404Error');
    }
  }; 

// ===========================
// Login POST
// ===========================
const logpost = async (req, res, next) => {
    try {
      const { email, password, rememberMe } = req.body;
      console.log("🛂 Login Attempt:", email, "| Remember Me:", rememberMe);
  
      const findUser = await User.findOne({ isAdmin: 0, email });
  
      if (!findUser) {
        req.flash('message', 'Incorrect Email Address');
        req.flash('messageType', 'error');
        return res.redirect('/login')
      }
  
      if (findUser.isBlocked) {
        req.flash('message', 'Your entry is Blocked by Authorities');
        req.flash('messageType', 'error');
        return res.redirect('/login')
      }
  
      if (!password || !findUser.password) {
        req.flash('message', 'Invalid credentials.');
        req.flash('messageType', 'error');
        return res.redirect('/login')
      }
  
      const passwordMatch = await bcrypt.compare(password, findUser.password);
  
      if (!passwordMatch) {
        req.flash('message', 'Incorrect Password');
        req.flash('messageType', 'error');
        return res.redirect('/login')
      }
  
      // Successful login
      req.session.user = findUser._id;
  
      if (rememberMe === "on") {
        req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
        console.log("🕒 Remember Me enabled");
      } else {
        req.session.cookie.expires = false;
        console.log("⏱️ Session expires on browser close");
      }
  
      res.redirect('/');
    } catch (error) {
      console.error("❌ Login failed:", error);
      next(error)
    }
  };
  



// ===========================
// Load Email Verification Page (Forget Passowrd)
// ===========================
const loadVerifyEmail = async (req, res) => {
    try {
      const message = req.flash("message")[0] || null;
      res.render("forgetpass", { message });
    } catch (err) {
      console.error(err);
      res.redirect("/404Error");
    }
  };
  

// ===========================
// Email Verification POST (Forget Passowrd)
// ===========================
const loadVerifyEmailPost = async (req, res, next) => {
    try {
        const { email } = req.body;
        console.log("🔍 Received email for password reset:", email);

        if (!email || email.trim() === "") {
            req.flash('message', 'Enter your Email Address');
            return res.redirect('/forget-password');
        }

        const user = await User.findOne({ email });

        if (!user) {
            req.flash('message', 'User not found');
            return res.redirect('/forget-password');
        }

        // ✅ Save email in session
        req.session.resetEmail = email;
        console.log("✅ Email verified and stored in session:", req.session.resetEmail);

        // ✅ Generate OTP
        const otp = generateOtp(); // Make sure this function exists
        req.session.resetOtp = otp;

        // ✅ Send OTP to user's email
        const emailSent = await sendVeriEmail(email, otp);
        if (!emailSent) {
            req.flash('message', 'Failed to send OTP. Try again later.');
            return res.redirect('/forget-password');
        }

        console.log("📧 OTP sent to user:", otp);

        // ✅ Redirect to OTP input page
        res.render("otppage", { message: req.flash('message'), otpType: "reset" });

    } catch (error) {
        console.error("💥 Error in loadVerifyEmailPost:", error);
        next(error);
    }
};

// ===========================
// OTP verification (Forget Password)
// ===========================
const verifyOtpPost = async (req, res, next) => {
    console.log("🔥 REACHED THE RIGHT verifyOtpPost (Forget Password) CONTROLLER");
    try {
        const { otp } = req.body;
        const sessionOtp = req.session.resetOtp;

        console.log("📥 OTP Verification Request Received");
        console.log("🔐 Entered OTP:", otp);
        console.log("📦 Session OTP:", sessionOtp);

        // Check if OTP was sent and is 4 digits
        if (!otp || otp.length !== 4) {
            console.warn("⚠️ OTP is missing or not 4 digits");
            return res.json({ success: false, message: "OTP must be 4 digits." });
        }

        // Check if session OTP exists
        if (!sessionOtp) {
            console.warn("⚠️ No OTP stored in session (session might have expired)");
            return res.json({ success: false, message: "Timeout. Try again" });
        }

        // Validate OTP
        if (otp !== sessionOtp) {
            console.warn("❌ Invalid OTP entered");
            return res.json({ success: false, message: "Invalid OTP." });
        }

        // OTP Verified
        console.log("✅ OTP Verified Successfully");
        delete req.session.resetOtp;

        return res.json({
            success: true,
            redirectUrl: "/reset-password"
        });

    } catch (error) {
        console.error("💥 Error in verifyOtpPost:", error);
        next()
    }
};


// ===========================
// Reset Password GET
// ===========================
const loadResetPassPage = async (req, res) => {
    try {
      const message = req.flash('message')[0] || null;
      const messageType = req.flash('messageType')[0] || null;
  
      res.render('resetPass', { message, messageType });
    } catch (err) {
      console.error('❌ Error loading resetPassword page:', err);
      res.redirect('/404Error');
    }
  }; 

// ===========================
// Reset Password POST
// ===========================
const resetPasswordPost = async (req, res, next) => {
    try {
        const { password, confirmPassword } = req.body;
        const email = req.session.resetEmail;

        console.log("🧩 Reset password for:", email);

        if (!email) {
            req.flash('message', 'Timeout. Please verify your email again.');
            return res.redirect('/forget-password');
        }

        if (!password || !confirmPassword) {
            req.flash('message', 'Please fill in all fields.');
            return res.redirect('/reset-password');
        }

        if (password !== confirmPassword) {
            req.flash('message', 'Passwords do not match.');
            return res.redirect('/reset-password');
        }

        const user = await User.findOne({ email });
        if (!user) {
            req.flash('message', 'User not found.');
            return res.redirect('/reset-password');
        }

        console.log("🔐 Old (stored hashed) password:", user.password);
        console.log("🔑 New (plain) password:", password);

        const isSameAsCurrent = await bcrypt.compare(password, user.password);

        let isSameAsOld = false;
        if (user.oldPasswords && Array.isArray(user.oldPasswords)) {
            for (let old of user.oldPasswords) {
                const match = await bcrypt.compare(password, old);
                if (match) {
                    isSameAsOld = true;
                    break;
                }
            }
        }

        if (isSameAsCurrent || isSameAsOld) {
            req.flash('message', 'This password was used before. Please use a new one.');
            return res.redirect('/reset-password');
        }

        // Store current password in oldPasswords array
        if (user.password) {
            if (!user.oldPasswords) user.oldPasswords = [];
            if (user.oldPasswords.length >= 3) user.oldPasswords.shift(); // Keep only last 3
            user.oldPasswords.push(user.password);
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        console.log("🔑 New (plain) hashedPassword:", hashedPassword);

        user.password = hashedPassword;
        await user.save();

        delete req.session.resetEmail;

        console.log("✅ Password successfully updated for", email);
        req.flash('message', 'Password updated successfully. Please log in.');
        req.flash('messageType', 'success');
        return res.redirect('/login');

    } catch (error) {
        console.error("💥 Error resetting password:", error);
        next(error);
    }
};

// ===========================
// Load Register Page
// ===========================
const register = async (req, res) => {
    try {
      let message = req.flash('message')[0] || null;
      let messageType = req.flash('messageType')[0] || null;

      if (!message) {
        message = req.flash('error')[0]; // for Passport
        messageType = 'error';
      }
  
      res.render('register', { message, messageType });
    } catch (err) {
      console.error('❌ Error loading register page:', err);
      res.redirect('/404Error');
    }
  };

// ===========================
// Send OTP Email
// ===========================
async function sendVeriEmail(email, otp) {
    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            port: 587,
            secure: false,
            requireTLS: true,
            auth: {
                user: process.env.NODEMAILER_EMAIL,
                pass: process.env.NODEMAILER_PASSWORD
            }
        });

        const info = await transporter.sendMail({
            from: process.env.NODEMAILER_EMAIL,
            to: email,
            subject: "Verify your account",
            text: `${otp} is your TezBag verification code.`,
            html: `<b>${otp} is your TezBag verification code.</b>`
        });

        console.log("📧 OTP email sent:", info.accepted);
        return info.accepted.length > 0;
    } catch (error) {
        console.error("❌ Error sending OTP email:", error);
        return false;
    }
}

// ===========================
// Register POST
// ===========================
const regpost = async (req, res, next) => {
    try {
        const { f_name, l_name, email, password, cPassword } = req.body;

        console.log("📥 Registration attempt:");
        console.log("👤 First Name:", f_name);
        console.log("👤 Last Name:", l_name);
        console.log("📧 Email:", email);
        console.log("🔑 Password:", password);
        console.log("🔐 Confirm Password:", cPassword);

        if (password !== cPassword) {
            console.log("⚠️ Passwords do not match");
            req.flash('message', 'Passwords do not match. Please re-enter.');
            return res.redirect('/register');
        }

        const findUser = await User.findOne({ email });
        if (findUser) {
            console.log("🚫 Email already registered:", email);
            req.flash('message', 'This email ID is already registered. Try logging in.');
            req.flash('messageType', 'error');
            return res.redirect('/login');
        }        

        const findAdmin = await Admin.findOne({ email });
        if (findAdmin) {
            console.log("🚫 Entry deneied Because of Admin's email:", email);
            req.flash('message', 'Cannot register using an admin\'s email. Please use a different email.');
            req.flash('messageType', 'error');
            return res.redirect('/register');
        }

        const otp = generateOtp();
        console.log("🔐 Generated OTP:", otp);

        const emailSent = await sendVeriEmail(email, otp);
        if (!emailSent) {
            console.log("📤 Email sending failed for:", email);
            req.flash('message', 'Something went wrong while sending OTP. Try again later.');
            return res.redirect('/register');
        }

        req.session.userOtp = otp;
        req.session.userData = { f_name, l_name, email, password };
        console.log("📦 Stored user data in session:");
        console.log("🧾", req.session.userData);

        res.render("otppage", { message: req.flash('message'), otpType: "registration" });
    } catch (error) {
        console.error("❌ Registration error:", error);
        next(error);
    }
};

// ===========================
// Load OTP Page
// ===========================
const otpver = async (req, res, next) => {
    try {
        console.log("📲 Opening OTP Page");

        const message = req.flash('message');
        const otpType = req.session.otpType;  // 👈 grab otpType from session

        res.render('otppage', { message, otpType }); // 👈 pass it to EJS

    } catch (err) {
        console.error("❌ Error opening OTP page:", err);
        next(err);
    }
};


// ===========================
// Secure Password Hashing
// ===========================
const securePass = async (password) => {
    try {
        return await bcrypt.hash(password, 10);
    } catch (error) {
        throw new Error("Error hashing password");
    }
};

// ===========================
// OTP Verification
// ===========================
const verifyOtp = async (req, res, next) => {
    console.log("🔥 REACHED THE RIGHT verifyOtpPost (Account Registration) CONTROLLER");
    try {
        const { otp } = req.body;
        const newSessionOtp = req.session.userOtp

        console.log("📥 OTP Verification Request Received");
        console.log("🔐 Entered OTP:", otp);
        console.log("📦 Session OTP:", newSessionOtp);

        // Check if OTP was sent and is 4 digits
        if (!otp || otp.length !== 4) {
            console.warn("⚠️ OTP is missing or not 4 digits");
            return res.json({ success: false, message: "OTP must be 4 digits." });
        }

        // Validate OTP
        if (otp !== newSessionOtp) {
            console.warn("⚠️ OTP is missing or not 4 digits");
            return res.json({ success: false, message: "Invalid Otp" });
        }

        // Check if session OTP exists
        const user = req.session.userData;
        if (!user) {
            console.warn("⚠️ No OTP stored in session (session might have expired)");
            return res.json({ success: false, message: "Timeout. Try again" });
        }

        const passwordHash = await securePass(user.password);

        const saveUserData = new User({
            f_Name: user.f_name,
            l_Name: user.l_name,
            email: user.email,
            password: passwordHash
        });

        const savedUser = await saveUserData.save();
        console.log("✅ User registered successfully:", savedUser.email);

        req.session.user = savedUser._id;
        delete req.session.userOtp;
        delete req.session.userData;

        return res.status(200).json({ 
            success: true,
            redirectUrl: '/login',
            message: 'OTP Verified Successfully. Please log in.', // Add flash message
            messageType: 'success' // Add message type
          });
          
    } catch (error) {
        console.error("❌ OTP verification error:", error);
        next(error);
    }
};

// ===========================
// Resend OTP
// ===========================
const resendOtp = async (req, res, next) => {
    try {
        console.log("🔁 Resend OTP requested");

        const userData = req.session.userData;
        const lastSentTime = req.session.lastOtpSentTime;
        const now = Date.now();

        if (!userData || !userData.email) {
            return next({ status: 400, message: "No user data in session." });
        }

        if (lastSentTime && (now - lastSentTime < 60000)) {
            const secondsLeft = Math.ceil((60000 - (now - lastSentTime)) / 1000);
            console.log(`⏳ Resend blocked. Wait ${secondsLeft}s`);
            return next({ status: 429, message: `Please wait ${secondsLeft} seconds before resending OTP.` });
        }

        const newOtp = generateOtp();
        console.log("🔐 New OTP generated:", newOtp);

        const emailSent = await sendVeriEmail(userData.email, newOtp);
        if (!emailSent) {
            return next({ status: 500, message: "Failed to resend OTP." });
        }

        req.session.userOtp = newOtp;
        req.session.lastOtpSentTime = now;

        res.status(200).json({ success: true, message: "OTP resent successfully." });
    } catch (error) {
        console.error("❌ Resend OTP error:", error);
        next(error);
    }
};

// ===========================
// Load Settings
// ===========================
const loadSettings = async (req, res) => {
    try {
        res.render('settings');
    } catch (error) {
        console.error("❌ Error loading settings:", error);
        res.redirect('/404Error');
    }
};

// ===========================
// Load Dashboard
// ===========================
const loadDashboard = async (req, res) => {
    try {
        res.render('dashboard');
    } catch (error) {
        console.error("❌ Error loading dashboard:", error);
        res.redirect('/404Error');
    }
};

// ===========================
// Logout
// ===========================
const logout = async (req, res) => {
    try {
        req.session.destroy((err) => {
            if (err) {
                console.error("❌ Session destroy error:", err.message);
                return res.redirect('/404Error');
            }
            console.log("👋 User logged out");
            res.redirect('/');
        });
    } catch (error) {
        console.error("❌ Logout error:", error);
        res.redirect('/404Error');
    }
};

module.exports = {
    load404,
    loadHomepage,
    register,
    login_user,
    logpost,
    loadVerifyEmail,
    loadVerifyEmailPost,
    verifyOtpPost,
    loadResetPassPage,
    resetPasswordPost,
    regpost,
    otpver,
    verifyOtp,
    resendOtp,
    loadSettings,
    loadDashboard,
    logout
};
