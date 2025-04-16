const User = require('../../models/userSchema');
const env = require('dotenv').config();
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');

// ===========================
// Load 404 Page
// ===========================
const load404 = async (req, res) => {
    try {
        res.render('404');
    } catch (err) {
        console.error('⚠️ Error loading 404 page:', err);
        res.redirect('/404Error');
    }
};

// ===========================
// Load Homepage
// ===========================
const loadHomepage = async (req, res, next) => {
    try {
        if (req.session.user || req.user) {
            console.log("✅ User is logged in:", req.session.user || req.user?.email);
            res.render('homepage');
        } else {
            console.log("⚠️ User not logged in");
            res.render('beforelogin');
        }
    } catch (err) {
        console.error('❌ Error loading homepage:', err);
        next(err);
    }
};

// ===========================
// Load Login Page
// ===========================
const login_user = async (req, res, next) => {
    try {
        res.render('login_user', { message: res.locals.message || null });
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
            return res.render('login_user', { message: req.flash('message') });
        }

        if (findUser.isBlocked) {
            req.flash('message', 'Your entry is Blocked by Authorities');
            return res.render('login_user', { message: req.flash('message') });
        }

        const passwordMatch = await bcrypt.compare(password, findUser.password);

        if (!passwordMatch) {
            req.flash('message', 'Incorrect Password');
            return res.render('login_user', { message: req.flash('message') });
        }

        req.session.user = findUser._id;

        if (rememberMe) {
            req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
            console.log("🕒 Remember Me enabled");
        } else {
            req.session.cookie.expires = false;
            console.log("⏱️ Session expires on browser close");
        }

        res.redirect('/');
    } catch (error) {
        console.error("❌ Login failed:", error);
        req.flash('message', 'Login failed. Please try again');
        res.render('login_user', { message: req.flash('message') });
    }
};

// ===========================
// Load Email Verification Page
// ===========================
const loadVerifyEmail = async (req, res) => {
    try {
        res.render('forgetpass');
    } catch (error) {
        console.error("❌ Error loading forget password page:", error);
        res.redirect('/404Error');
    }
};

// ===========================
// Email Verification POST
// ===========================
const loadVerifyEmailPost = async (req, res, next) => {
    try {
        const { email } = req.body;
        console.log("🔍 Received email for password reset:", email);

        const user = await User.findOne({ email });

        if (!user) {
            console.log("❌ No user found with email:", email);
            req.flash('message', 'User not found');
            return res.redirect('/verify-email');
        }

        req.session.resetEmail = email;
        console.log("✅ Email verified and stored in session");

        res.render('resetPass');
    } catch (error) {
        console.error("💥 Error in loadVerifyEmailPost:", error);
        next(error);
    }
};

// ===========================
// Load Register Page
// ===========================
const register = async (req, res, next) => {
    try {
        res.render('register', { message: res.locals.message || null });
    } catch (err) {
        console.error("❌ Error loading register page:", err);
        res.redirect('/404Error');
    }
};

// ===========================
// Generate 4-digit OTP
// ===========================
function generateOtp() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

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
        console.log("📥 Registration attempt:", email);

        if (password !== cPassword) {
            req.flash('message', 'Passwords do not match. Please re-enter.');
            return res.render('register', { message: req.flash('message') });
        }

        const findUser = await User.findOne({ email });
        if (findUser) {
            req.flash('message', 'This email ID is already registered. Try logging in.');
            return res.render('register', { message: req.flash('message') });
        }

        const otp = generateOtp();
        console.log("🔐 Generated OTP:", otp);

        const emailSent = await sendVeriEmail(email, otp);
        if (!emailSent) {
            req.flash('message', 'Something went wrong while sending OTP. Try again later.');
            return res.render('register', { message: req.flash('message') });
        }

        req.session.userOtp = otp;
        req.session.userData = { f_name, l_name, email, password };
        console.log("📦 Stored user data in session");

        res.redirect("/otp-page");
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
        if (!req.session.userData || !req.session.userOtp) {
            return res.redirect('/');
        }
        res.render('otppage', { message: null });
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
    try {
        const { otp } = req.body;
        console.log("🧪 OTP entered:", otp);

        if (otp !== req.session.userOtp) {
            return next({ status: 400, message: 'Invalid OTP, please try again' });
        }

        const user = req.session.userData;
        if (!user) {
            return next({ status: 400, message: 'Session expired. Please register again.' });
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

        res.status(200).json({ success: true, redirectUrl: "/login" });
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
    regpost,
    otpver,
    verifyOtp,
    resendOtp,
    loadSettings,
    loadDashboard,
    logout
};
