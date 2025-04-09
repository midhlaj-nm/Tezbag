const User = require('../../models/userSchema');
const env = require('dotenv').config();
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');

// Load Homepage
const loadHomepage = async (req, res) => {
    try {
        return res.render('beforelogin');
    } catch (err) {
        console.log('Something Happened', err);
        res.status(500).send('Server Error');
    }
};

// Load Login Page
const login_user = async (req, res) => {
    try {
        return res.render('login_user');
    } catch (err) {
        console.log('Something Happened', err);
        res.status(500).send('Server Error');
    }
};

// Load Register Page
const register = async (req, res) => {
    try {
        res.render('register');
    } catch (err) {
        console.log('Something Happened While Rendering Register Page', err);
        res.status(500).send('Server Error');
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

        return info.accepted.length > 0;
    } catch (error) {
        console.log("Facing problem with sending Verification code", error);
        return false;
    }
}

// Register POST handler
const regpost = async (req, res) => {
    try {
        const { f_name, l_name, email, password, cPassword } = req.body;

        if (password !== cPassword) {
            return res.render('regpost', { message: "Password do not match" });
        }

        const findUser = await User.findOne({ email });
        if (findUser) {
            return res.render('regpost', { message: "This email ID is already registered" });
        }

        const otp = generateOtp();
        const emailSent = await sendVeriEmail(email, otp);
        if (!emailSent) {
            return res.json("email-error");
        }

        req.session.userOtp = otp;
        req.session.userData = { f_name, l_name, email, password };

        res.redirect("/otp-page");
        console.log("OTP sent", otp);
    } catch (error) {
        console.error("Register error", error);
        res.redirect('/page-not-found');
    }
};

// Load OTP Page
const otpver = async (req, res) => {
    try {
        res.render('otppage');
    } catch (err) {
        console.log('Something Happened: ', err);
        res.status(500).send('Server Error');
    }
};

// Secure Password
const securePass = async (password) => {
    try {
        return await bcrypt.hash(password, 10);
    } catch (error) {
        console.error("Password hashing error", error);
    }
};

// OTP Verification
const verifyOtp = async (req, res) => {
    try {
        const { otp } = req.body;
        console.log("OTP entered:", otp);

        if (otp === req.session.userOtp) {
            const user = req.session.userData;
            console.log("Session userData:", user);

            const passwordHash = await securePass(user.password);

            const saveUserData = new User({
                f_Name: user.f_name,
                l_Name: user.l_name,
                email: user.email,
                password: passwordHash
            });

            await saveUserData.save();
            req.session.user = saveUserData._id;
            res.json({ success: true, redirectUrl: "/login" });
        } else {
            res.status(400).json({ success: false, message: 'Invalid OTP, Please try again' });
        }
    } catch (error) {
        console.error("OTP verification failed: ", error);
        res.status(500).json({ success: false, message: 'An error occurred' });
    }
};

const resendOtp = async (req, res) => {
    try {
        const userData = req.session.userData;
        const lastSentTime = req.session.lastOtpSentTime;
        const now = Date.now();

        if (!userData || !userData.email) {
            return res.status(400).json({ success: false, message: "No user data in session." });
        }

        // Check if 30 seconds have passed
        if (lastSentTime && (now - lastSentTime < 30000)) {
            const secondsLeft = Math.ceil((30000 - (now - lastSentTime)) / 1000);
            return res.status(429).json({
                success: false,
                message: `Please wait ${secondsLeft} seconds before resending OTP.`
            });
        }

        const newOtp = generateOtp();
        const emailSent = await sendVeriEmail(userData.email, newOtp);

        if (!emailSent) {
            return res.status(500).json({ success: false, message: "Failed to resend OTP." });
        }

        req.session.userOtp = newOtp;
        req.session.lastOtpSentTime = now; // Save timestamp

        return res.status(200).json({ success: true, message: "OTP resent successfully." });

    } catch (error) {
        console.error("Resend OTP error:", error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};



module.exports = {
    loadHomepage,
    register,
    login_user,
    regpost,
    otpver,
    verifyOtp,
    resendOtp
};
