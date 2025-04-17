const User = require('../../models/userSchema');
const Admin = require('../../models/adminSchema');
const nodemailer = require('nodemailer');
const env = require('dotenv').config();
const bcrypt = require('bcrypt');

const loadLogin = async (req, res) => {
    try {
        return res.render('login-adm');
    } catch (err) {
        console.log('Something Happened', err);
        res.render('404-adm')
    }
};

function generateOtp() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

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
            subject: "Verify you're Authority",
            text: `${otp} is your Tezgrani's admin verification code.`,
            html: `<b>${otp} is your Tezgrani's admin verification code.</b>`
        });

        console.log("📧 OTP email sent:", info.accepted);
        return info.accepted.length > 0;
    } catch (error) {
        console.error("❌ Error sending OTP email:", error);
        return false;
    }
}

const verifyLogin = async(req,res, next) => {
    try {
        const {email , password, remember} = req.body;
        console.log("🛂 Login Attempt:", email, "| Remember Me:", remember);

        const isAdm = await Admin.findOne({email})

        if(!isAdm){
            req.flash('message', 'Incorrect Email Address.');
            return res.render('login-adm', {message: req.flash('message')})
        }

        if(isAdm.isBlocked){
            req.flash('message', 'Your entry is Blocked by Authorities')
            return res.render('login-adm',{message: req.flash('message')})
        }

        const passwordMatch = await bcrypt.compare(password, isAdm.password);

        if (!passwordMatch) {
            req.flash('message', 'Incorrect Password');
            return res.render('login-adm', { message: req.flash('message') });
        }

        req.session.admin = isAdm._id;

        if (remember) {
            req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
            console.log("🕒 Remember Me enabled");
        } else {
            req.session.cookie.expires = false;
            console.log("⏱️ Session expires on browser close");
        }

        const otp = generateOtp();
        console.log("🔐 Generated OTP:", otp);

        const emailSent = await sendVeriEmail(email, otp);
        if (!emailSent) {
            console.log("📤 Email sending failed for:", email);
            req.flash('message', 'Something went wrong while sending OTP. Try again later.');
            return res.render('login-adm', { message: req.flash('message') });
        }

        res.redirect('/tezgrani/verifyotp')
    } catch (error) {
        next(error)
    }
}

const loadOtp = async (req, res) => {
    try {
        return res.render('otp-adm');
    } catch (err) {
        console.log('Something Happened', err);
        res.render('404-adm')
    }
};

const verifyOtp = async (req, res, next) => {
    try {
      const { otp } = req.body;
      console.log("🧪 OTP entered:", otp);
  
      // Check for session timeout
      if (!req.session.adminData || !req.session.adminOtp) {
        return res.json({ success: false, message: "Session expired" });
      }
  
      // Compare entered OTP with stored OTP
      if (otp !== req.session.adminOtp) {
        return next({ status: 400, message: 'Invalid OTP, please try again' });
      }
  
      // Session and OTP are valid, proceed
      const admin = req.session.adminData;
  
      req.session.admin = admin._id; // Logging the admin in
      delete req.session.adminOtp;
      delete req.session.adminData;
  
      res.status(200).json({
        success: true,
        redirectUrl: "/tezgrani/dashboard",
      });
  
    } catch (error) {
      console.error("❌ OTP verification error:", error);
      next(error);
    }
  };
  

const resendOtp = async (req, res, next) => {
    try {
        console.log("🔁 Resend OTP requested");

        const adminData = req.session.adminData;
        const lastSentTime = req.session.lastOtpSentTime;
        const now = Date.now();

        if (!adminData || !adminData.email) {
            return next({ status: 400, message: "No user data in session." });
        }

        if (!req.session.email) {
            return res.json({ success: false, message: "Session expired" });
          }
          

        if (lastSentTime && (now - lastSentTime < 60000)) {
            const secondsLeft = Math.ceil((60000 - (now - lastSentTime)) / 1000);
            console.log(`⏳ Resend blocked. Wait ${secondsLeft}s`);
            return next({ status: 429, message: `Please wait ${secondsLeft} seconds before resending OTP.` });
        }

        const newOtp = generateOtp();
        console.log("🔐 New OTP generated:", newOtp);

        const emailSent = await sendVeriEmail(adminData.email, newOtp);
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

const loadDashboard = async (req, res) => {
    try {
        return res.render('dashboard-adm');
    } catch (err) {
        console.log('Something Happened', err);
        res.render('404-adm')
    }
};

module.exports = { loadLogin,verifyLogin,loadOtp,verifyOtp,resendOtp,loadDashboard };