const User = require('../../models/userSchema');
const Order = require('../../models/orderSchema');
const Address = require('../../models/addressSchema');
const Product = require('../../models/productSchema');
const env = require('dotenv').config();
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');

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

const loadDashboard = async (req, res) => {
    try {
        const userId = req.session.user;

        // Check if userId exists in session
        if (!userId) {
            return res.redirect('/login'); // Redirect to login if session is invalid
        }

        // Fetch user details
        const user = await User.findById(userId)
            .select('f_Name l_Name email')
            .lean();

        // Check if user exists
        if (!user) {
            req.session.destroy(); // Clear invalid session
            return res.redirect('/login'); // Redirect to login if user not found
        }

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
        const userId = req.session.user;
        console.log('User ID from session:', userId);

        // Check if userId exists in session
        if (!userId) {
            return res.redirect('/login'); // Redirect to login if session is invalid
        }

        // Fetch user details from the database
        const userDoc = await User.findById(userId)
            .select('f_Name l_Name email')
            .lean();

        // Check if user exists
        if (!userDoc) {
            req.session.destroy(); // Clear invalid session
            return res.redirect('/login'); // Redirect to login if user not found
        }

        // Fetch the user's addresses from the database
        const addressDoc = await Address.findOne({ userId });
        const addresses = addressDoc ? addressDoc.address : [];

        // Prepare user details for the frontend
        const user = {
            firstName: userDoc.f_Name || '',
            lastName: userDoc.l_Name || '',
            email: userDoc.email || ''
        };

        // Render the settings page and pass the addresses and user details to the frontend
        res.render('settings', { addresses, user });
    } catch (error) {
        console.error("❌ Error loading settings:", error);
        res.redirect('/404Error');
    }
};

const addAddress = async (req, res) => {
    try {
        const userId = req.session.user;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'User not authenticated' });
        }

        // Log the incoming request headers and body for debugging
        console.log('Request headers:', req.headers);
        console.log('Request body:', req.body);

        if (!req.body) {
            return res.status(400).json({ success: false, message: 'Request body is missing' });
        }

        // Extract address data from the request body
        const {
            firstName,
            lastName,
            company,
            streetAddress,
            city,
            country,
            state,
            landmark: landMark,
            zipcode: pinCode,
            email,
            phone,
            altPhone,
            isDefault
        } = req.body;

        // Find the user's address document
        const addressDoc = await Address.findOne({ userId });

        // Check for duplicate address
        if (addressDoc && addressDoc.address.length > 0) {
            const newAddressKeyFields = {
                streetAddress: streetAddress?.trim().toLowerCase() || '',
                city: city?.trim().toLowerCase() || '',
                state: state?.trim().toLowerCase() || '',
                country: country?.trim().toLowerCase() || '',
                pinCode: pinCode?.toString().trim().toLowerCase() || '',
                phone: phone?.trim().toLowerCase() || ''
            };

            const isDuplicate = addressDoc.address.some(existingAddress => {
                return (
                    existingAddress.streetAddress?.trim().toLowerCase() === newAddressKeyFields.streetAddress &&
                    existingAddress.city?.trim().toLowerCase() === newAddressKeyFields.city &&
                    existingAddress.state?.trim().toLowerCase() === newAddressKeyFields.state &&
                    existingAddress.country?.trim().toLowerCase() === newAddressKeyFields.country &&
                    existingAddress.pinCode?.toString().trim().toLowerCase() === newAddressKeyFields.pinCode &&
                    existingAddress.phone?.trim().toLowerCase() === newAddressKeyFields.phone
                );
            });

            if (isDuplicate) {
                return res.status(400).json({ success: false, message: 'This address already exists' });
            }
        }

        // Determine if this address should be the default
        const isFirstAddress = !addressDoc || addressDoc.address.length === 0;
        const shouldBeDefault = isFirstAddress || isDefault === 'on' || isDefault === true;

        // Create new address object
        const newAddress = {
            firstName,
            lastName,
            company,
            streetAddress,
            city,
            country,
            state,
            landMark,
            pinCode,
            email,
            phone,
            altPhone,
            isDefault: shouldBeDefault
        };

        if (addressDoc) {
            // If the user already has an address document, append the new address
            if (newAddress.isDefault) {
                // If the new address is set as default, unset the previous default
                addressDoc.address.forEach(addr => (addr.isDefault = false));
            }
            addressDoc.address.push(newAddress);
            await addressDoc.save();
        } else {
            // If no address document exists, create a new one
            addressDoc = new Address({
                userId,
                address: [newAddress]
            });
            await addressDoc.save();
        }

        res.json({ success: true, message: 'Address added successfully' });
    } catch (error) {
        console.error('❌ Error adding address:', error);
        res.status(500).json({ success: false, message: 'Failed to add address' });
    }
};

const editAddress = async (req, res) => {
    try {
        const userId = req.session.user;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'User not authenticated' });
        }

        // Log the incoming request body for debugging
        console.log('Request body:', req.body);

        if (!req.body) {
            return res.status(400).json({ success: false, message: 'Request body is missing' });
        }

        const { index } = req.body;
        if (index === undefined || index < 0) {
            return res.status(400).json({ success: false, message: 'Invalid address index' });
        }

        // Extract address data from the request body
        const {
            firstName,
            lastName,
            company,
            streetAddress,
            city,
            country,
            state,
            landmark: landMark,
            zipcode: pinCode,
            email,
            phone,
            altPhone,
            isDefault
        } = req.body;

        // Find the user's address document
        const addressDoc = await Address.findOne({ userId });
        if (!addressDoc || !addressDoc.address[index]) {
            return res.status(404).json({ success: false, message: 'Address not found' });
        }

        // Update the address at the specified index
        const updatedAddress = {
            firstName,
            lastName,
            company,
            streetAddress,
            city,
            country,
            state,
            landMark,
            pinCode,
            email,
            phone,
            altPhone,
            isDefault: isDefault === 'on' || isDefault === true
        };

        if (updatedAddress.isDefault) {
            // If this address is set as default, unset the previous default
            addressDoc.address.forEach((addr, i) => {
                if (i !== parseInt(index)) {
                    addr.isDefault = false;
                }
            });
        }

        addressDoc.address[index] = updatedAddress;
        await addressDoc.save();

        res.json({ success: true, message: 'Address updated successfully' });
    } catch (error) {
        console.error('❌ Error editing address:', error);
        res.status(500).json({ success: false, message: 'Failed to edit address' });
    }
};

const deleteAddress = async (req, res) => {
    try {
        const userId = req.session.user;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'User not authenticated' });
        }

        // Log the incoming request body for debugging
        console.log('Request body:', req.body);

        if (!req.body) {
            return res.status(400).json({ success: false, message: 'Request body is missing' });
        }

        const { index } = req.body;
        if (index === undefined || index < 0) {
            return res.status(400).json({ success: false, message: 'Invalid address index' });
        }

        // Find the user's address document
        const addressDoc = await Address.findOne({ userId });
        if (!addressDoc || !addressDoc.address[index]) {
            return res.status(404).json({ success: false, message: 'Address not found' });
        }

        // Check if the address being deleted is the default
        const isDefaultAddress = addressDoc.address[index].isDefault;

        // Remove the address at the specified index
        addressDoc.address.splice(index, 1);

        // If the deleted address was the default and there are remaining addresses, assign default to a random address
        if (isDefaultAddress && addressDoc.address.length > 0) {
            const randomIndex = Math.floor(Math.random() * addressDoc.address.length);
            addressDoc.address[randomIndex].isDefault = true;
        }

        await addressDoc.save();

        res.json({ success: true, message: 'Address deleted successfully' });
    } catch (error) {
        console.error('❌ Error deleting address:', error);
        res.status(500).json({ success: false, message: 'Failed to delete address' });
    }
};

const changePassword = async (req, res) => {
  try {
      // Check if user is logged in
      const userId = req.session.user;
      if (!userId) {
          return res.json({
              success: false,
              message: 'Please log in to change your password.'
          });
      }

      // Fetch the user from the database
      const user = await User.findById(userId);
      if (!user) {
          req.session.destroy();
          return res.json({
              success: false,
              message: 'User not found.'
          });
      }

      const email = user.email;
      console.log("🔍 Initiating password reset for email:", email);

      // Generate OTP
      const otp = generateOtp();
      req.session.resetOtp = otp;
      req.session.resetEmail = email;
      req.session.otpType = "reset";
      req.session.resetFlowOrigin = "account-settings"; // Track the origin

      // Send OTP to user's email
      const emailSent = await sendVeriEmail(email, otp);
      if (!emailSent) {
          return res.json({
              success: false,
              message: 'Failed to send OTP. Try again later.'
          });
      }

      console.log("📧 OTP sent to user:", otp);

      // Return success response with redirect URL
      return res.json({
          success: true,
          redirectUrl: '/otp-page',
          message: 'OTP sent successfully.'
      });
  } catch (error) {
      console.error('❌ Error initiating password reset:', error);
      return res.json({
          success: false,
          message: 'An error occurred while initiating password reset.'
      });
  }
};

module.exports = { loadSettings, loadDashboard, addAddress, editAddress, deleteAddress, changePassword };