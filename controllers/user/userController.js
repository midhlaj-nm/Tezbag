const User = require('../../models/userSchema');
const Category = require('../../models/categorySchema');
const Product = require('../../models/productSchema');
const Wallet = require('../../models/walletSchema');
const Admin = require('../../models/adminSchema');
const Deal = require('../../models/dealSchema');
const Cart = require('../../models/cartSchema');
const Banner = require('../../models/bannerSchema');
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
        console.log('Session user:', req.session.user);
        const [categories, products] = await Promise.all([
            Category.find({ isListed: true }).lean(),
            Product.find({ isBlocked: false }).lean()
        ]);

        const [vegetableCategory, fruitCategory] = await Promise.all([
            Category.findOne({ name: 'Vegetables', isListed: true }),
            Category.findOne({ name: 'Fruits', isListed: true })
        ]);

        const categoryIds = [vegetableCategory, fruitCategory]
            .filter(Boolean)
            .map(cat => cat._id);

        let latestProducts = [];
        if (categoryIds.length) {
            latestProducts = await Product.find({
                category: { $in: categoryIds },
                isBlocked: false
            })
                .sort({ createdAt: -1 })
                .limit(3)
                .lean();
        }

        const activeDeals = await Deal.find({
            offerType: 'percentage',
            status: 'Active'
        }).lean();

        const productDeals = activeDeals.filter(deal => deal.appliedTo === 'products').reduce((acc, deal) => {
            deal.selectedItems.forEach(itemId => {
                acc[itemId] = deal.offerPrice;
            });
            return acc;
        }, {});

        const categoryDeals = activeDeals.filter(deal => deal.appliedTo === 'category').reduce((acc, deal) => {
            deal.selectedItems.forEach(itemId => {
                acc[itemId] = deal.offerPrice;
            });
            return acc;
        }, {});

        const transformProduct = (product) => {
            const productOffer = productDeals[product._id.toString()] || 0;
            const categoryOffer = categoryDeals[product.category?.toString()] || 0;
            const largestOffer = Math.max(productOffer, categoryOffer);

            let discountPercentage = 0;
            let finalPrice = product.regularPrice;

            if (largestOffer > 0) {
                discountPercentage = largestOffer;
                finalPrice = product.regularPrice * (1 - largestOffer / 100);
            } else {
                const priceDifference = product.salePrice - product.regularPrice;
                discountPercentage = product.salePrice > 0 ? Math.round((priceDifference / product.salePrice) * 100) : 0;
            }

            return {
                ...product,
                name: product.productName,
                image: Array.isArray(product.productImage) ? product.productImage[0] : product.productImage,
                price: finalPrice,
                regularPrice: product.regularPrice,
                salePrice: product.salePrice,
                largestOffer: largestOffer > 0 ? largestOffer : null,
                discountPercentage
            };
        };

        const transformedProducts = products.map(transformProduct);
        const transformedLatestProducts = latestProducts.map(transformProduct);

        for (let i = transformedProducts.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [transformedProducts[i], transformedProducts[j]] = [transformedProducts[j], transformedProducts[i]];
        }

        const categoriesWithData = await Promise.all(
            categories.map(async (category) => {
                const [productCount] = await Promise.all([
                    Product.countDocuments({ category: category._id }),
                ]);

                return {
                    ...category,
                    productCount,
                    image: category.image
                };
            })
        );

        const banners = await Banner.find({ status: 'Active' }).lean();
        const bannersByPosition = {
            'homepage top': banners.filter(banner => banner.position === 'homepage top'),
            'homepage bottom': banners.filter(banner => banner.position === 'homepage bottom')
        };

        let name = '';
        let total = '0.00₹';

        if (req.session.user) {
            const userId = req.session.user;
            const user = await User.findById(userId).select('f_Name l_Name');
            name = `${user.f_Name} ${user.l_Name}`;
            console.log('This is the name: ', name);

            const cart = await Cart.findOne({ userId }).select('total');
            console.log('this is cart total: ', cart);
            if (cart) {
                total = cart.total.toFixed(2) + '₹';
            } else {
                console.log('No cart found for userId:', userId);
                total = '0.00₹';
            }
            console.log('This is cart price: ', total);
        }

        const renderData = {
            category: categoriesWithData,
            products: transformedProducts,
            latestProducts: transformedLatestProducts,
            showTodaysItems: transformedLatestProducts.length > 0,
            showFeaturedProducts: transformedProducts.length > 0,
            showTopCategories: categoriesWithData.length > 0,
            name: name || '',
            total: total || '0.00₹',
            bannersByPosition
        };

        const viewName = req.session.user ? 'homepage' : 'beforelogin';
        res.render(viewName, renderData);

    } catch (err) {
        console.error('❌ Error loading homepage:', err);
        res.render('404');
    }
};

// ===========================
// Load Login Page
// ===========================
const login_user = async (req, res) => {
    try {
        // Check if user is already logged in
        if (req.session.user) {
            return res.redirect('/');
        }

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
            return res.redirect('/login');
        }

        if (findUser.isBlocked) {
            req.flash('message', 'Your entry is Blocked by Authorities');
            req.flash('messageType', 'error');
            return res.redirect('/login');
        }

        if (!password || !findUser.password) {
            req.flash('message', 'Invalid credentials.');
            req.flash('messageType', 'error');
            return res.redirect('/login');
        }

        const passwordMatch = await bcrypt.compare(password, findUser.password);

        if (!passwordMatch) {
            req.flash('message', 'Incorrect Password');
            req.flash('messageType', 'error');
            return res.redirect('/login');
        }

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
        next(error);
    }
};

// ===========================
// Load Email Verification Page (Forget Password)
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
// Email Verification POST (Forget Password)
// ===========================
const loadVerifyEmailPost = async (req, res) => {
    try {
        const { email } = req.body;

        const user = await User.findOne({ email });
        if (!user) {
            req.flash('message', 'Email not found. Please register.');
            return res.redirect('/forget-password');
        }

        const otp = generateOtp();
        req.session.resetOtp = otp;
        req.session.resetEmail = email;
        req.session.otpType = "reset";
        req.session.resetFlowOrigin = "forget-password";

        const emailSent = await sendVeriEmail(email, otp);
        if (!emailSent) {
            req.flash('message', 'Failed to send OTP. Try again later.');
            return res.redirect('/forget-password');
        }

        console.log("📧 OTP sent to user:", otp);
        res.redirect('/otp-page');
    } catch (error) {
        console.error("💥 Error in loadVerifyEmailPost:", error);
        res.redirect('/404Error');
    }
};

// ===========================
// OTP Verification (Forget Password)
// ===========================
const verifyOtpPost = async (req, res, next) => {
    console.log("🔥 REACHED THE RIGHT verifyOtpPost (Forget Password) CONTROLLER");
    try {
        const { otp } = req.body;
        const sessionOtp = req.session.resetOtp;

        console.log("📥 OTP Verification Request Received");
        console.log("🔐 Entered OTP:", otp);
        console.log("📦 Session OTP:", sessionOtp);

        if (!otp || otp.length !== 4) {
            console.warn("⚠️ OTP is missing or not 4 digits");
            return res.json({ success: false, message: "OTP must be 4 digits." });
        }

        if (!sessionOtp) {
            console.warn("⚠️ No OTP stored in session (session might have expired)");
            return res.json({ success: false, message: "Timeout. Try again" });
        }

        if (otp !== sessionOtp) {
            console.warn("❌ Invalid OTP entered");
            return res.json({ success: false, message: "Invalid OTP." });
        }

        console.log("✅ OTP Verified Successfully");
        delete req.session.resetOtp;

        return res.json({
            success: true,
            redirectUrl: "/reset-password"
        });

    } catch (error) {
        console.error("💥 Error in verifyOtpPost:", error);
        next(error);
    }
};

// ===========================
// Reset Password GET
// ===========================
const loadResetPassPage = async (req, res) => {
    try {
        if (!req.session.resetEmail) {
            req.flash('message', 'Session expired. Please start the password reset process again.');
            req.flash('messageType', 'error');
            return res.redirect('/forget-password');
        }

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
            req.flash('message', 'Please Login First');
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

        if (user.password) {
            if (!user.oldPasswords) user.oldPasswords = [];
            if (user.oldPasswords.length >= 3) user.oldPasswords.shift();
            user.oldPasswords.push(user.password);
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        console.log("🔑 New (plain) hashedPassword:", hashedPassword);

        user.password = hashedPassword;
        await user.save();

        delete req.session.resetEmail;
        req.session.otpType = null;
        req.session.resetFlowOrigin = req.session.resetFlowOrigin || "forget-password";

        console.log("✅ Password successfully updated for", email);
        req.flash('message', 'Password updated successfully.');
        req.flash('messageType', 'success');

        const redirectUrl = req.session.resetFlowOrigin === "account-settings" ? "/account-settings" : "/login";
        req.session.resetFlowOrigin = null;

        return res.redirect(redirectUrl);

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
        // Check if user is already logged in
        if (req.session.user) {
            return res.redirect('/');
        }

        let message = req.flash('message')[0] || null;
        let messageType = req.flash('messageType')[0] || null;

        if (!message) {
            message = req.flash('error')[0]; // for Passport
            messageType = 'error';
        }

        // Pass the referral code from params to the view (null if not present)
        const referralCode = req.params.code || null;

        res.render('register', { message, messageType, referralCode });
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
        const { f_name, l_name, email, password, cPassword, referralCode } = req.body;

        console.log("📥 Registration attempt:");
        console.log("👤 First Name:", f_name);
        console.log("👤 Last Name:", l_name);
        console.log("📧 Email:", email);
        console.log("🔑 Password:", password);
        console.log("🔐 Confirm Password:", cPassword);
        console.log("📋 Referral Code:", referralCode);

        if (password !== cPassword) {
            console.log("⚠️ Passwords do not match");
            req.flash('message', 'Passwords do not match. Please re-enter.');
            return res.redirect(`/register${req.params.code ? '/' + req.params.code : ''}`);
        }

        const findUser = await User.findOne({ email });
        if (findUser) {
            console.log("🚫 Email already registered:", email);
            req.flash('message', 'This email ID is already registered. Try logging in.');
            req.flash('messageType', 'error');
            return res.redirect(`/register${req.params.code ? '/' + req.params.code : ''}`);
        }

        const findAdmin = await Admin.findOne({ email });
        if (findAdmin) {
            console.log("🚫 Entry denied because of Admin's email:", email);
            req.flash('message', 'Cannot register using an admin\'s email. Please use a different email.');
            req.flash('messageType', 'error');
            return res.redirect(`/register${req.params.code ? '/' + req.params.code : ''}`);
        }

        let redeemed = false;
        let referralValidationMessage = null;
        if (referralCode) {
            const referrer = await User.findOne({ referralCode }).select('referralCode referralCount');
            if (referrer) {
                if (referrer.referralCount >= 10) {
                    referralValidationMessage = 'This referral code has reached its limit.';
                } else {
                    redeemed = true;
                }
            } else {
                referralValidationMessage = 'Invalid Referral Code';
            }
        }

        if (referralValidationMessage) {
            req.flash('message', referralValidationMessage);
            return res.redirect(`/register${req.params.code ? '/' + req.params.code : ''}`);
        }

        const otp = generateOtp();
        console.log("🔐 Generated OTP:", otp);

        const emailSent = await sendVeriEmail(email, otp);
        if (!emailSent) {
            console.log("📤 Email sending failed for:", email);
            req.flash('message', 'Something went wrong while sending OTP. Try again later.');
            return res.redirect(`/register${req.params.code ? '/' + req.params.code : ''}`);
        }

        req.session.userOtp = otp;
        req.session.userData = { f_name, l_name, email, password, referralCode, redeemed };
        console.log("📦 Stored user data in session:");
        console.log("🧾", req.session.userData);

        req.session.otpType = "registration";
        res.redirect('/otp-page');
    } catch (error) {
        console.error("❌ Registration error:", error);
        req.flash('message', 'An error occurred during registration. Please try again.');
        res.redirect(`/register${req.params.code ? '/' + req.params.code : ''}`);
    }
};

// ===========================
// Load OTP Page
// ===========================
const otpver = async (req, res, next) => {
    try {
        console.log("📲 Opening OTP Page");

        const otpType = req.session.otpType;
        if (!otpType) {
            req.flash('message', 'Session expired. Please try again.');
            return res.redirect('/register');
        }

        if (otpType === "registration" && !req.session.userOtp) {
            req.flash('message', 'Session expired. Please register again.');
            return res.redirect('/register');
        }

        if (otpType === "reset" && !req.session.resetOtp) {
            req.flash('message', 'Session expired. Please start the password reset process again.');
            return res.redirect('/forget-password');
        }

        const message = req.flash('message');
        res.render('otppage', { message, otpType });

        delete req.session.otpType;
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
// OTP Verification (Registration)
// ===========================
const verifyOtp = async (req, res, next) => {
    console.log("🔥 REACHED THE RIGHT verifyOtpPost (Account Registration) CONTROLLER");
    try {
        const { otp } = req.body;
        const newSessionOtp = req.session.userOtp;

        console.log("📥 OTP Verification Request Received");
        console.log("🔐 Entered OTP:", otp);
        console.log("📦 Session OTP:", newSessionOtp);

        if (!otp || otp.length !== 4) {
            console.warn("⚠️ OTP is missing or not 4 digits");
            return res.json({ success: false, message: "OTP must be 4 digits." });
        }

        if (!newSessionOtp) {
            console.warn("⚠️ No OTP stored in session (session might have expired)");
            return res.json({ success: false, message: "Timeout. Try again" });
        }

        if (otp !== newSessionOtp) {
            console.warn("⚠️ Invalid OTP entered");
            return res.json({ success: false, message: "Invalid OTP" });
        }

        const user = req.session.userData;
        if (!user) {
            console.warn("⚠️ No user data in session (session might have expired)");
            return res.json({ success: false, message: "Timeout. Try again" });
        }

        const passwordHash = await securePass(user.password);

        let referralCode = '';
        async function getReferralCode() {
            const code = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            let isUnique = false;

            while (!isUnique) {
                referralCode = '';
                for (let i = 0; i < 6; i++) {
                    referralCode += code.charAt(Math.floor(Math.random() * code.length));
                }
                const existingUser = await User.findOne({ referralCode });
                isUnique = !existingUser;
            }
            return referralCode;
        }

        referralCode = await getReferralCode();

        const saveUserData = new User({
            f_Name: user.f_name,
            l_Name: user.l_name,
            email: user.email,
            password: passwordHash,
            referralCode,
            redeemed: user.redeemed || false
        });

        const savedUser = await saveUserData.save();
        console.log("✅ User registered successfully:", savedUser.email);

        let userWallet = await Wallet.findOne({ user: savedUser._id });
        if (!userWallet) {
            userWallet = new Wallet({ user: savedUser._id });
            await userWallet.save();
        }

        // Add referral bonus for new user if redeemed
        if (user.redeemed) {
            userWallet.balance += 20;
            userWallet.transactions.push({
                type: 'credit',
                amount: 20,
                reason: 'Welcome Bonus',
                date: new Date()
            });
            await userWallet.save();

            // Find referrer by the provided referral code
            const referrer = await User.findOne({ referralCode: user.referralCode }).select('referralCount');
            if (referrer) {
                referrer.referralCount += 1;
                if (referrer.referralCount >= 10) {
                    referrer.referralCode = null; // Invalidate referral code by setting it to null
                }
                await referrer.save();

                let referrerWallet = await Wallet.findOne({ user: referrer._id });
                if (!referrerWallet) {
                    referrerWallet = new Wallet({ user: referrer._id });
                    await referrerWallet.save();
                }
                referrerWallet.balance += 10;
                referrerWallet.transactions.push({
                    type: 'credit',
                    amount: 10,
                    reason: 'Referral Reward',
                    date: new Date()
                });
                await referrerWallet.save();
            }
        }

        req.session.user = savedUser._id;
        delete req.session.userOtp;
        delete req.session.userData;

        return res.status(200).json({
            success: true,
            redirectUrl: '/login',
            message: 'OTP Verified Successfully. Please log in.',
            messageType: 'success'
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
            return res.status(400).json({ success: false, message: "No user data in session. Please register again." });
        }

        if (lastSentTime && (now - lastSentTime < 60000)) {
            const secondsLeft = Math.ceil((60000 - (now - lastSentTime)) / 1000);
            console.log(`⏳ Resend blocked. Wait ${secondsLeft}s`);
            return res.status(429).json({ success: false, message: `Please wait ${secondsLeft} seconds before resending OTP.` });
        }

        const newOtp = generateOtp();
        console.log("🔐 New OTP generated:", newOtp);

        const emailSent = await sendVeriEmail(userData.email, newOtp);
        if (!emailSent) {
            return res.status(500).json({ success: false, message: "Failed to resend OTP." });
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
// Logout
// ===========================
const logout = async (req, res) => {
    try {
        req.session.user = null;
        res.redirect('/');
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
    logout
};