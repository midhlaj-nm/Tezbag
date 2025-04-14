const User = require('../../models/userSchema');
const env = require('dotenv').config();
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');


//Load 404
const load404 = async (req, res) => {
    try {
      res.render('404');
    } catch (err) {
        res.redirect('/404Error')
    }
};


// Load Homepage
const loadHomepage = async (req, res, next) => {
    try {
        // Check if user is logged in via session OR via Passport
        if (req.session.user || req.user) {
            console.log("✅ User is logged in:", req.session.user || req.user?.email);
            res.render('homepage');  // Render your actual home page for logged-in users
        } else {
            console.log("⚠️ User not logged in");
            res.render('beforelogin');  // Public landing page
        }
    } catch (err) {
        console.error('❌ Error loading homepage:', err);
        next(err);
    }
};

// Load Login Page
const login_user = async (req, res, next) => {
    try {
        res.render('login_user', { message: res.locals.message || null })
    } catch (err) {
        console.log('Something Happened', err);
        res.redirect('/404Error')
    }
};

/*
const register = async (req, res, next) => {
  try {
    res.render('register', { message: res.locals.message || null });
  } catch (err) {
    console.log('Something Happened While Rendering Register Page', err);
    next(err);
  }
};
*/

//Login post
const logpost = async (req, res, next) => {
    try {
        const { email, password, rememberMe } = req.body;

        console.log("🛂 Login Attempt:", email, "| Remember Me:", rememberMe);

        const findUser = await User.findOne({ isAdmin: 0, email });

        if (!findUser) {
            return res.render('login_user', { message: 'Incorrect Email Address' });
        }

        if (findUser.isBlocked) {
            return res.render('login_user', { message: "Your entry is Blocked by Authorities" });
        }

        const passwordMatch = await bcrypt.compare(password, findUser.password);

        if (!passwordMatch) {
            return res.render('login_user', { message: "Incorrect Password" });
        }

        req.session.user = findUser._id;

        // 🌟 If 'Remember Me' is checked, extend session cookie
        if (rememberMe) {
            req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
            console.log("🕒 Remember Me enabled: Session will persist for 7 days");
        } else {
            req.session.cookie.expires = false; // Session cookie
            console.log("⏱️ Session will expire on browser close");
        }

        res.redirect('/');
    } catch (error) {
        next(error);
        res.render('login_user', { message: 'Login failed. Please try again' });
    }
};


// Load Register Page
const register = async (req, res, next) => {
    try {
      res.render('register', { message: res.locals.message || null });
    } catch (err) {
      console.log('Something Happened While Rendering Register Page', err);
      res.redirect('/404Error')
    }
  };  

// Generate 4-digit OTP
function generateOtp() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// Send OTP Email
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

        console.log("Email send response:", info.accepted);
        return info.accepted.length > 0;
    } catch (error) {
        console.log("Facing problem with sending Verification code", error);
        return false;
    }
}

// Register POST handler
const regpost = async (req, res, next) => {
    try {
        console.log("Received registration data:", req.body);
        const { f_name, l_name, email, password, cPassword } = req.body;

        if (password !== cPassword) {
            return res.render('register', { message: "Passwords do not match. Please re-enter." });
        }

        const findUser = await User.findOne({ email });
        if (findUser) {
            return res.render('register', { message: "This email ID is already registered. Try logging in." });
        }

        const otp = generateOtp();
        console.log("Generated OTP:", otp);

        const emailSent = await sendVeriEmail(email, otp);
        if (!emailSent) {
            return res.render('register', { message: "Something went wrong while sending OTP. Try again later." });
        }

        req.session.userOtp = otp;
        req.session.userData = { f_name, l_name, email, password };
        console.log("Stored in session: ", req.session.userData);

        return res.redirect("/otp-page");
    } catch (error) {
        next(error);
    }
};

// Load OTP Page
const otpver = async (req, res, next) => {
    try {
        console.log("Opening OTP Page. Session data:", req.session.userData, "OTP:", req.session.userOtp);
        if (!req.session.userData || !req.session.userOtp) {
            return res.redirect('/');
        }
        res.render('otppage', { message: null });
    } catch (err) {
        console.log('Something Happened: ', err);
        next(err);
    }
};

// Secure Password
const securePass = async (password) => {
    try {
        return await bcrypt.hash(password, 10);
    } catch (error) {
        throw new Error("Error occurred during hashing password");
    }
};

// OTP Verification
const verifyOtp = async (req, res, next) => {
    try {
        const { otp } = req.body;
        console.log("OTP entered by user:", otp);
        console.log("OTP in session:", req.session.userOtp);

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
        console.log("User saved successfully:", savedUser);

        req.session.user = savedUser._id;
        delete req.session.userOtp;
        delete req.session.userData;

        return res.status(200).json({ success: true, redirectUrl: "/login" });
    } catch (error) {
        next(error);
    }
};

// Resend OTP
const resendOtp = async (req, res, next) => {
    try {
        console.log("Resend OTP triggered. Session userData:", req.session.userData);

        if (!req.session.userData || !req.session.userOtp) {
            return res.redirect('/');
        }

        const userData = req.session.userData;
        const lastSentTime = req.session.lastOtpSentTime;
        const now = Date.now();

        if (!userData || !userData.email) {
            return next({ status: 400, message: "No user data in session." });
        }

        if (lastSentTime && (now - lastSentTime < 60000)) {
            const secondsLeft = Math.ceil((60000 - (now - lastSentTime)) / 1000);
            console.log(`Blocked resend: wait ${secondsLeft} more seconds`);
            return next({
                status: 429,
                message: `Please wait ${secondsLeft} seconds before resending OTP.`
            });
        }

        const newOtp = generateOtp();
        console.log("New OTP:", newOtp);

        const emailSent = await sendVeriEmail(userData.email, newOtp);
        if (!emailSent) {
            return next({ status: 500, message: "Failed to resend OTP." });
        }

        req.session.userOtp = newOtp;
        req.session.lastOtpSentTime = now;

        return res.status(200).json({ success: true, message: "OTP resent successfully." });
    } catch (error) {
        next(error);
    }
};




module.exports = {
    load404,
    loadHomepage,
    register,
    login_user,
    logpost,
    regpost,
    otpver,
    verifyOtp,
    resendOtp
};
