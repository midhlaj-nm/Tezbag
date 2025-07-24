const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();
const Cart = require('../../models/cartSchema');
const Product = require('../../models/productSchema');
const User = require('../../models/userSchema');
const Deal = require('../../models/dealSchema');
const Address = require('../../models/addressSchema');
const Order = require('../../models/orderSchema');
const Invoice = require('../../models/invoiceSchema');
const Return = require('../../models/returnSchema');
const Wallet = require('../../models/walletSchema');
const createInvoice = require('../../utils/invoiceGenerator');
const pdfGenerator = require('../../utils/pdfGenerator');
const razorpay = require('../../config/razorpay');

const loadCheckout = async (req, res, next) => {
    try {
        if (!req.session.user) {
            console.log('User not authenticated, redirecting to login.');
            return res.redirect('/login');
        }
        const userId = req.session.user;

        console.log('Checkout request received for user:', userId);
        console.log('Query parameters:', req.query);

        let itemsToCheckout = [];
        let subtotal = 0;

        const { productId, quantity, cuttingStyle } = req.query;

        if (productId && quantity) {
            console.log('--- Buy Now Flow ---');
            const product = await Product.findById(productId);
            if (!product) {
                console.log('Product not found for Buy Now flow, redirecting.');
                return res.redirect('/shop');
            }
            
            const itemQuantity = parseInt(quantity);
            const itemPrice = product.regularPrice;
            const itemTotal = itemPrice * itemQuantity;

            itemsToCheckout.push({
                productId: product, 
                quantity: itemQuantity,
                price: itemPrice,
                totalPrice: itemTotal,
                cuttingStyle: cuttingStyle || null
            });
            subtotal = itemTotal;
            console.log('Buy Now subtotal:', subtotal);

        } else {
            console.log('--- Standard Checkout Flow ---');
            const cart = await Cart.findOne({ userId }).populate('items.productId');
            console.log('Fetched cart:', cart);

            if (!cart || !cart.items.length) {
                console.log('Cart is empty, redirecting to shop.');
                return res.redirect('/shop');
            }

            itemsToCheckout = cart.items;
            // Manually calculate the subtotal by summing the totalPrice of each item
            subtotal = itemsToCheckout.reduce((acc, item) => acc + item.totalPrice, 0);
            console.log('Manually calculated subtotal from cart items:', subtotal);
        }

        const shipping = 0;
        const finalTotal = subtotal + shipping;
        console.log('Final Subtotal:', subtotal);
        console.log('Final Total:', finalTotal);
        console.log('Number of items to checkout:', itemsToCheckout.length);

        const wallet = await Wallet.findOne({ user: userId }).lean() || { balance: 0 };
        const user = await User.findById(userId);
        if (!user) {
            console.log('User not found in DB, redirecting to login.');
            return res.redirect('/login');
        }
        const name = `${user.f_Name} ${user.l_Name}`;

        const orderItems = itemsToCheckout.map(item => ({
            productId: item.productId._id.toString(),
            name: item.productId.productName,
            image: item.productId.productImage[0],
            quantity: item.quantity,
            price: item.price,
            total: item.totalPrice,
            cuttingStyle: item.cuttingStyle || null
        }));

        const coupons = await Deal.find({
            offerType: 'coupon',
            status: 'Active',
            expireOn: { $gte: new Date() }
        }).lean();

        const formattedCoupons = coupons.map(coupon => ({
            code: coupon.name,
            description: coupon.description || `Get ${coupon.offerPrice} off your order`,
            offerPrice: coupon.offerPrice,
            minPrice: coupon.minPrice,
            maxPrice: coupon.maxPrice
        }));

        const savedAddresses = await Address.find({ userId }).lean();
        const formattedAddresses = savedAddresses.flatMap(address =>
            address.address.map(addr => ({
                _id: addr._id,
                firstName: addr.firstName,
                lastName: addr.lastName,
                company: addr.company || '',
                streetAddress: addr.streetAddress,
                city: addr.city,
                state: addr.state,
                country: addr.country,
                pinCode: addr.pinCode,
                landmark: addr.landMark || '',
                email: addr.email || '',
                phone: addr.phone,
                altPhone: addr.altPhone || '',
                isDefault: addr.isDefault || false
            }))
        );

        const defaultAddress = formattedAddresses.find(addr => addr.isDefault) || formattedAddresses[0] || null;

        const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

        console.log('Rendering checkout page with data:');
        console.log('  subtotal:', subtotal);
        console.log('  finalTotal:', finalTotal);
        console.log('  orderItems:', orderItems);

        res.render('checkout', {
            userId,
            name,
            wallet,
            GOOGLE_API_KEY,
            total: finalTotal.toFixed(2), 
            coupons: formattedCoupons,
            orderItems,
            subtotal: subtotal.toFixed(2),
            shipping: shipping.toFixed(2),
            finalTotal: finalTotal.toFixed(2),
            savedAddresses: formattedAddresses,
            defaultAddress
        });

    } catch (error) {
        console.error('Error in loadCheckout:', error);
        return next({ status: 500, message: 'Failed to load checkout page' });
    }
};

const verifyPayment = async (req, res, next) => {
  try {
    console.log('verifyPayment: Starting verification for orderId:', req.body.orderId);
    const { paymentResponse, orderId } = req.body; // orderId here should be the MongoDB _id

    // Extract payment details from the response
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = paymentResponse;
    console.log('verifyPayment: Received payment response:', { razorpay_order_id, razorpay_payment_id, razorpay_signature });

    // Generate signature to verify payment using the secret key from config
    const generatedSignature = crypto
      .createHmac('sha256', razorpay.key_secret)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');
    console.log('verifyPayment: Generated signature:', generatedSignature);

    // Verify signature
    if (generatedSignature !== razorpay_signature) {
      console.log('verifyPayment: Signature mismatch detected, marking payment as failed');
      const order = await Order.findById(orderId); // **Using findById**
      if (order) {
        order.status = 'Payment Failed';
        order.paymentStatus = 'Failed';
        order.paymentDetails = order.paymentDetails || {};
        order.paymentDetails.failureReason = 'Signature mismatch';
        await order.save();
        console.log('verifyPayment: Order updated to Payment Failed:', order);
      } else {
        console.log('verifyPayment: No order found to update for signature mismatch, orderId (MongoDB _id):', orderId);
      }
      return res.status(400).json({ success: false, message: 'Payment verification failed due to signature mismatch', redirect: '/retry-payment' });
    }
    console.log('verifyPayment: Signature verified successfully');

    // Fetch the order from your database using the MongoDB _id
    const order = await Order.findById(orderId); // **Using findById**
    console.log('verifyPayment: Fetched order:', order);
    if (!order) {
      console.log('verifyPayment: Order not found for orderId (MongoDB _id):', orderId);
      return res.status(400).json({ success: false, message: 'Order not found for payment verification. Please try again.', redirect: '/retry-payment' });
    }

    // Update order with payment details and set payment status to 'Paid'
    order.status = 'Pending';
    order.paymentStatus = 'Paid';
    order.paymentDetails = {
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id, // This is Razorpay's order ID
      signature: razorpay_signature,
      method: req.body.paymentMethod || order.paymentMethod,
      amount: order.finalAmount,
      date: new Date(),
      transactionId: paymentResponse.razorpay_transaction_id || null,
      status: 'captured',
    };
    console.log('verifyPayment: Updated payment details:', order.paymentDetails);
    await order.save();
    console.log('verifyPayment: Order saved successfully with payment status:', order.paymentStatus);

    // Clear cart after successful payment
    await Cart.deleteOne({ userId: order.userId });
    console.log('verifyPayment: Cart cleared for user:', order.userId);

    // --- ASYNCHRONOUS INVOICE GENERATION AND UPLOAD ---
    setImmediate(async () => {
      try {
        console.log('verifyPayment: Starting asynchronous invoice generation and PDF upload for order:', orderId);
        const addrDoc = await Address.findOne({ userId: order.userId }).lean();
        const addr = addrDoc.address.find(item => item._id.toString() === order.address.toString());
        const invoice = await createInvoice(order, addr);
        console.log('verifyPayment: Asynchronously generated invoice doc:', invoice);
        const pdfUrl = await pdfGenerator(invoice, order);
        console.log('verifyPayment: Asynchronously generated PDF and updated invoice with URL:', pdfUrl);

        order.pdfUrl = pdfUrl;
        await order.save();
        console.log('verifyPayment: Order updated with PDF URL:', order.pdfUrl);
      } catch (err) {
        console.error(`verifyPayment: Error during asynchronous invoice generation/PDF upload for order ${orderId}:`, err);
      }
    });
    // Send response immediately, without waiting for PDF generation
    // Make sure your frontend redirects to /order-confirmation/:orderId using the order._id
    res.status(200).json({ success: true, message: 'Payment verified successfully', orderId: order._id, pdfUrl: null }); // **Sending order._id**
    console.log('verifyPayment: Verification response sent: success=true, orderId=', order._id, ' (PDF generation in background)');
  } catch (error) {
    console.error('verifyPayment: Error in verifyPayment:', error);
    const order = await Order.findById(req.body.orderId); // **Using findById**
    if (order) {
      order.status = 'Payment Failed';
      order.paymentStatus = 'Failed';
      order.paymentDetails = order.paymentDetails || {};
      order.paymentDetails.failureReason = error.message || 'Unexpected error during verification';
      await order.save();
      console.log('verifyPayment: Order updated to Payment Failed due to error:', order);
    } else {
      console.log('verifyPayment: No order found to update for error case, orderId (MongoDB _id):', req.body.orderId);
    }
    return next({ status: 500, message: 'Payment verification failed due to an error' });
  }
};

const paymentFailed = async (req, res) => {
  try {
    console.log('paymentFailed: Rendering paymentFailed page');
    const userId = req.session.user;
    const latestFailedOrder = await Order.findOne({ userId, status: 'Payment Failed' })
      .sort({ invoiceDate: -1 })
      .populate('orderedItems.productId');

    if (!latestFailedOrder) {
      console.log('paymentFailed: No latest failed order found for userId:', userId);
      return res.status(404).json({ success: false, message: 'No failed orders found.' });
    }

    const razorpayKey = process.env.RAZORPAY_KEY_ID;
    const razorpayOrderId = latestFailedOrder.razorpayOrderId;
    console.log('paymentFailed: Razorpay Order ID for retry: ', razorpayOrderId);
    const amount = latestFailedOrder.finalAmount;

    res.render('retryPayment', {
      orderId: latestFailedOrder._id, // **This passes MongoDB _id for retry**
      amount: amount,
      razorpayKey: razorpayKey,
      razorpayOrderId: razorpayOrderId,
      userId,
    });
  } catch (error) {
    console.error('paymentFailed: Error rendering paymentFailed:', error);
    return next({ status: 500, message: 'Error loading payment failure page.' });
  }
};

const confirmOrder = async (req, res, next) => {
    try {
        const { paymentMethod, orderNotes, address, coupon, finalAmount } = req.body;
        const userId = req.session.user;
        const addressId = address._id;

        const addrDoc = await Address.findOne({ userId }).lean();
        const addr = addrDoc.address.find(item => item._id.$oid === addressId || item._id.toString() === addressId);

        if (!addr) {
            return res.status(400).json({ success: false, message: 'Address not found' });
        }

        if (!paymentMethod || !address || !finalAmount) {
            return res.status(400).json({ success: false, message: 'Missing required fields', redirect: '/retry-payment' });
        }

        const requiredFields = ['firstName', 'lastName', 'streetAddress', 'city', 'state', 'country', 'pinCode', 'landmark', 'phone'];
        const missing = requiredFields.filter(field => !address[field]);
        console.log('This is missing:', missing)
        if (missing.length > 0) {
            return res.status(400).json({ success: false, message: 'Incomplete address information', redirect: '/retry-payment' });
        }

        if (!userId || !addressId) {
            return res.status(401).json({ success: false, message: 'User or address missing', redirect: '/retry-payment' });
        }

        let orderedItems = [];
        let totalPrice = 0;
        let isBuyNow = false;

        const cart = await Cart.findOne({ userId }).populate('items');
        
        if (cart && cart.items.length) {
            orderedItems = cart.items.map(item => ({
                productId: item.productId,
                quantity: item.quantity,
                price: item.price,
                id: item._id,
                cuttingStyle: item.cuttingStyle
            }));
            totalPrice = cart.total;
        } else if (req.body.productId) {
            isBuyNow = true;
            const { productId, quantity, cuttingStyle } = req.body;
            
            const product = await Product.findById(productId)
                .populate('category', 'name categoryOffer isListed');

            if (!product || product.quantity < quantity) {
                return res.status(400).json({ success: false, message: 'Product not found or insufficient stock' });
            }

            const productOffer = product.productOffer || 0;
            const categoryOffer = product.category?.categoryOffer || 0;
            const largestOffer = Math.max(productOffer, categoryOffer);
            const price = largestOffer > 0
                ? product.regularPrice * (1 - largestOffer / 100)
                : product.regularPrice;

            orderedItems.push({
                productId: product._id,
                quantity: quantity,
                price: price,
                id: null,
                cuttingStyle: cuttingStyle || null
            });
            totalPrice = price * quantity;
        } else {
            return res.status(400).json({ success: false, message: 'Cart is empty or no product specified for checkout', redirect: '/retry-payment' });
        }
        
        const discount = totalPrice - parseFloat(finalAmount);

        const productsToUpdate = [];
        for (const item of orderedItems) {
            const product = await Product.findById(item.productId);
            if (!product || product.quantity < item.quantity) {
                await Promise.all(productsToUpdate.map(pItem => {
                    pItem.product.quantity += pItem.quantity;
                    pItem.product.status = pItem.product.quantity > 0 ? 'Available' : 'Out Of Stock';
                    return pItem.product.save();
                }));
                return res.status(400).json({ success: false, message: 'Some products are out of stock', redirect: '/shop', delay: 2000 });
            }
            product.quantity -= item.quantity;
            product.status = product.quantity === 0 ? 'Out Of Stock' : 'Available';
            productsToUpdate.push({ ...item, product });
        }

        await Promise.all(productsToUpdate.map(item => item.product.save()));

        let order = new Order({
            orderedItems,
            totalPrice,
            discount,
            finalAmount: parseFloat(finalAmount),
            paymentMethod,
            userId,
            address: addressId,
            orderNotes: orderNotes || '',
            invoiceDate: new Date(),
            status: 'Pending',
            couponApplied: !!coupon,
            paymentStatus: 'Not Paid',
        });
        await order.save();
        
        if (paymentMethod === 'upi') {
            let razorpayOrder = null;
            try {
                const options = {
                    amount: parseFloat(finalAmount) * 100,
                    currency: 'INR',
                    receipt: `order_rcptid_${Date.now()}`,
                };
                razorpayOrder = await razorpay.orders.create(options);
                order.razorpayOrderId = razorpayOrder.id;
                await order.save();
            } catch (razorpayError) {
                await Promise.all(productsToUpdate.map(item => {
                    item.product.quantity += item.quantity;
                    item.product.status = item.product.quantity > 0 ? 'Available' : 'Out Of Stock';
                    return item.product.save();
                }));
                order.status = 'Payment Failed';
                order.paymentStatus = 'Failed';
                await order.save();
                return res.status(400).json({ success: false, message: 'Failed to create Razorpay order', redirect: '/retry-payment' });
            }
            res.status(200).json({
                success: true,
                message: 'Order initiated successfully',
                orderId: order._id,
                pdfUrl: null,
                razorpayKey: process.env.RAZORPAY_KEY_ID,
                razorpayOrderId: razorpayOrder.id,
            });
        } else if (paymentMethod === 'wallet') {
            const userWallet = await Wallet.findOne({ user: userId });
            if (!userWallet) {
                await Promise.all(productsToUpdate.map(item => {
                    item.product.quantity += item.quantity;
                    item.product.status = item.product.quantity > 0 ? 'Available' : 'Out Of Stock';
                    return item.product.save();
                }));
                await Order.deleteOne({ _id: order._id });
                return res.status(400).json({ success: false, message: 'Wallet not found for the user', redirect: '/retry-payment' });
            }

            const amountToDeduct = parseFloat(finalAmount);
            if (userWallet.balance < amountToDeduct) {
                await Promise.all(productsToUpdate.map(item => {
                    item.product.quantity += item.quantity;
                    item.product.status = item.product.quantity > 0 ? 'Available' : 'Out Of Stock';
                    return item.product.save();
                }));
                await Order.deleteOne({ _id: order._id });
                return res.status(400).json({ success: false, message: 'Insufficient wallet balance', redirect: '/retry-payment' });
            }

            userWallet.balance -= amountToDeduct;
            userWallet.transactions.push({
                type: 'debit',
                amount: amountToDeduct,
                reason: `Order payment (Order ID: ${order.orderId.slice(0, 6)})`,
                date: new Date()
            });
            await userWallet.save();

            order.paymentStatus = 'Paid';
            order.paymentDetails = {
                method: 'Wallet',
                amount: order.finalAmount,
                date: new Date(),
            };
            await order.save();

            if (!isBuyNow) {
                await Cart.deleteOne({ userId });
            }

            setImmediate(async (orderContext, addrContext) => {
                try {
                    const invoice = await createInvoice(orderContext, addrContext);
                    const pdfUrl = await pdfGenerator(invoice, orderContext);
                    orderContext.pdfUrl = pdfUrl;
                    await orderContext.save();
                } catch (err) {
                    next({ status: 500, message: 'Error generating invoice for wallet payment' });
                }
            }, order, addr);

            res.status(200).json({
                success: true,
                message: 'Order placed successfully with wallet',
                orderId: order._id,
                pdfUrl: null
            });
        } else if (paymentMethod === 'cod') {
            order.paymentStatus = 'Not Paid';
            order.status = 'Pending';
            order.paymentDetails = {
                method: 'COD',
                amount: order.finalAmount,
                date: new Date(),
            };
            await order.save();

            if (!isBuyNow) {
                await Cart.deleteOne({ userId });
            }

            setImmediate(async (orderContext, addrContext) => {
                try {
                    const invoice = await createInvoice(orderContext, addrContext);
                    const pdfUrl = await pdfGenerator(invoice, orderContext);
                    orderContext.pdfUrl = pdfUrl;
                    await orderContext.save();
                } catch (err) {
                    next({ status: 500, message: 'Error generating invoice for COD payment' });
                }
            }, order, addr);

            res.status(200).json({
                success: true,
                message: 'Order placed successfully with COD',
                orderId: order._id,
                pdfUrl: null,
            });
        }
    } catch (error) {
        console.error('confirmOrder: Error in confirmOrder:', error);
        const cart = await Cart.findOne({ User }).populate('items');
        if (cart) {
            for (const item of cart.items) {
                const product = await Product.findById(item.productId);
                if (product) {
                    product.quantity += item.quantity;
                    product.status = product.quantity > 0 ? 'Available' : 'Out Of Stock';
                    await product.save();
                }
            }
        }
        return next({ status: 500, message: 'Order initiation failed due to an error' });
    }
};

const checkInvoiceStatus = async (req, res, next) => {
    try {
        const userId = req.session.user;
        const orderId = req.params.orderId;

        const user = await User.findById(userId);
        if (!user) return res.status(401).json({ success: false, message: 'User not found' });

        const order = await Order.findById(orderId).lean();
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        const invoice = await Invoice.findOne({ orderId: order.orderId });
        const invoicePdf = invoice ? invoice.pdfUrl : order.pdfUrl || null;
        const invoiceNumber = invoice ? invoice.invoiceNumber.slice(-6) : null;

        res.json({
            success: true,
            invoicePdf,
            invoiceNumber
        });
    } catch (error) {
        console.error('checkInvoiceStatus: Error in checkInvoiceStatus:', error);
        return next({ status: 500, message: 'Error checking invoice status' });
    }
};

const cancelOrder = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    console.log('cancelOrder: Attempting to cancel or mark payment failure for orderId:', orderId);

    const order = await Order.findById(orderId); // **Using findById**
    if (!order) {
      console.log('cancelOrder: Order not found for cancellation/failure:', orderId);
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.paymentStatus === 'Paid') {
      console.log('cancelOrder: Order is paid, processing refund to wallet for orderId:', orderId);

      // Update order status to Cancelled
      order.status = 'Cancelled';
      await order.save();
      console.log('cancelOrder: Order status updated to Cancelled:', order);

      // Find or create wallet for the user
      let userWallet = await Wallet.findOne({ user: order.userId });
      if (!userWallet) {
        userWallet = new Wallet({ user: order.userId, balance: 0 });
        console.log('cancelOrder: Created new wallet for user:', order.userId);
      }

      // Add refunded amount to wallet
      const refundAmount = order.finalAmount;
      userWallet.balance += refundAmount;
      userWallet.transactions.push({
        type: 'credit',
        amount: refundAmount,
        reason: `Refund for cancelled order (Order ID: ${order.orderId.slice(0, 6)})`,
        date: new Date()
      });
      console.log('cancelOrder: Wallet transaction added:', userWallet.transactions[userWallet.transactions.length - 1]);
      await userWallet.save();
      console.log('cancelOrder: Wallet updated with balance:', userWallet.balance);

      // Revert product quantities
      for (const item of order.orderedItems) {
        const product = await Product.findById(item.productId);
        if (product) {
          product.quantity += item.quantity;
          product.status = product.quantity > 0 ? 'Available' : 'Out Of Stock';
          await product.save();
          console.log('cancelOrder: Reverted quantity for product:', item.productId);
        }
      }
    } else if (order.paymentStatus === 'Not Paid') {
      console.log('cancelOrder: Order not paid, marking as Payment Failed:', orderId);
      order.status = 'Payment Failed';
      order.paymentStatus = 'Failed';
      order.paymentDetails = order.paymentDetails || {};
      order.paymentDetails.failureReason = 'Payment canceled by user';
      await order.save();
      console.log('cancelOrder: Order marked as Payment Failed:', order);
    } else {
      console.log('cancelOrder: Order already processed or in invalid state, reverting quantities:', orderId);
      // Revert product quantities only if not already processed
      for (const item of order.orderedItems) {
        const product = await Product.findById(item.productId);
        if (product) {
          product.quantity += item.quantity;
          product.status = product.quantity > 0 ? 'Available' : 'Out Of Stock';
          await product.save();
          console.log('cancelOrder: Reverted quantity for product:', item.productId);
        }
      }
      await Order.deleteOne({ _id: order._id }); // **Use _id for deletion**
      console.log('cancelOrder: Order cancelled and deleted:', orderId);
    }

    res.status(200).json({ success: true, message: 'Order processed as failed, cancelled, or refunded successfully' });
  } catch (error) {
    console.error('cancelOrder: Error in cancelOrder:', error);
    return next({ status: 500, message: 'Failed to process order cancellation' });
  }
};

const loadConfirmation = async (req, res, next) => {
  try {
    const userId = req.session.user;
    const orderId = req.params.orderId; // This is the ID coming from the URL

    console.log('loadConfirmation: Incoming URL parameter orderId:', orderId); // Log the raw incoming ID
    console.log('loadConfirmation: Session UserId:', userId);

    const user = await User.findById(userId);
    if (!user) {
      console.log('loadConfirmation: User not found for session ID:', userId);
      return res.redirect('/login'); // Redirect to login if user session is invalid
    }

    // Attempt to find the order using the MongoDB _id
    const order = await Order.findById(orderId) // **CRITICAL: Using findById here**
      .populate('orderedItems.productId', 'productName productImage')
      .lean();

    console.log('loadConfirmation: Order details fetched from DB:', order);

    if (!order) {
      console.error('loadConfirmation: Order NOT FOUND in DB for ID:', orderId);
      return res.status(404).json({ success: false, message: `Order with ID ${orderId} not found.` });
    }

    // Debugging order.userId to match the error:
    console.log('loadConfirmation: Order found. Order userId:', order.userId); // Ensure order.userId is not null here

    const addrDoc = await Address.findOne({ userId: order.userId }).lean();
    console.log('loadConfirmation: Parent address document:', addrDoc);

    if (!addrDoc || !addrDoc.address) {
      console.error('loadConfirmation: Address document or addresses not found for user:', order.userId);
      return res.status(404).json({ success: false, message: 'Address details not found for this order.' });
    }

    // Check if order.address exists before using it
    if (!order.address) {
      console.error('loadConfirmation: Order document is missing address field.');
      return res.status(400).json({ success: false, message: 'Order address is missing.' });
    }

    const addr = addrDoc.address.find(item => item._id.$oid === order.address || item._id.toString() === order.address.toString());
    console.log('loadConfirmation: Selected address:', addr);

    if (!addr) {
      console.error('loadConfirmation: Specific address within document not found for address ID:', order.address);
      return res.status(404).json({ success: false, message: 'Specific delivery address not found for this order.' });
    }

    const billingName = `${addr.firstName} ${addr.lastName}`.trim();
    const billingAddress = `${addr.streetAddress}, ${addr.city}, ${addr.state}`;
    const billingPhone = addr.phone;
    const billingEmail = addr.email;

    const invoice = await Invoice.findOne({ orderId: order.orderId }); // This 'orderId' is your custom string UUID
    console.log('loadConfirmation: Invoice details:', invoice);

    res.render('orderDetails', {
      order: order,
      orderId: order._id.toString(), // Ensure _id is passed as string
      billingName: billingName,
      billingAddress: billingAddress,
      billingPhone: billingPhone,
      billingEmail: billingEmail,
      invoiceDate: order.invoiceDate,
      paymentMethod: order.paymentMethod,
      shipping: 'Normal',
      invoicePdf: invoice ? invoice.pdfUrl : null,
      invoiceNumber: invoice ? invoice.invoiceNumber.slice(-6) : null,
      products: order.orderedItems,
      subtotal: order.totalPrice,
      discount: order.discount,
      finalAmount: order.finalAmount
    });
  } catch (error) {
    console.error('loadConfirmation: Caught error in loadConfirmation:', error); // More specific error log
    return next({ status: 500, message: 'An unexpected error occurred while loading order confirmation.' });
  }
};

const downloadInvoice = async (req, res, next) => {
  try {
    const pdfUrl = decodeURIComponent(req.query.url);
    console.log('downloadInvoice: Attempting to download from URL:', pdfUrl);
    const response = await axios({
      url: pdfUrl,
      method: 'GET',
      responseType: 'stream',
    });

    const filename = req.query.filename || 'invoice.pdf';
    console.log('downloadInvoice: Using filename:', filename);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');

    response.data.pipe(res);
  } catch (error) {
    console.error('downloadInvoice: Error downloading invoice:', error.message);
    return next({ status: 500, message: 'Error downloading invoice.' });
  }
};

const loadOrderHistory = async (req, res, next) => {
  try {
    if (!req.session.user) {
      return res.redirect('/login');
    }

    const userId = req.session.user;
    const searchQuery = req.query.query || '';
    const page = parseInt(req.query.page) || 1;
    const limit = 10;

    const cart = await Cart.findOne({ userId }).select('total');
    let cartTotal = '0.00₹';
    if (cart) {
      cartTotal = cart.total.toFixed(2) + '₹';
    }
    console.log('loadOrderHistory: This is the cart Total: ', cartTotal);

    const allOrders = await Order.find({ userId })
      .populate('orderedItems.productId', 'productName')
      .sort({ invoiceDate: -1 });

    const orders = searchQuery
      ? allOrders.filter(x =>
        x.orderId.match(new RegExp(searchQuery, 'i')) ||
        x.status.match(new RegExp(searchQuery, 'i')) ||
        x.finalAmount.toString().match(new RegExp(searchQuery, 'i')) ||
        x.orderedItems.some(item => item.productId?.productName?.match(new RegExp(searchQuery, 'i')))
      )
      : allOrders;

    const totalOrders = orders.length;
    const totalPages = Math.ceil(totalOrders / limit);
    const skip = (page - 1) * limit;
    const paginationOrders = orders.slice(skip, skip + limit);

    res.render('orderHistory', {
      searchQuery,
      orders: paginationOrders,
      currentPage: page,
      totalPages,
      cartTotal
    });
  } catch (error) {
    console.error('loadOrderHistory: Error loading order history:', error);
    return next({ status: 500, message: 'Error loading order history.' });
  }
};

const returnOrder = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;
    const userId = req.session.user;

    if (!orderId || !userId) {
      console.log('returnOrder: Missing orderId or userId for return request.');
      return res.status(400).json({ success: false, message: 'Something went wrong' });
    }

    const existingOrder = await Order.findById(orderId); // **Using findById**

    if (!existingOrder) {
      console.log('returnOrder: Order not found for return request:', orderId);
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const refundAmount = existingOrder.finalAmount;

    const returnRequest = new Return({
      userId,
      orderId: existingOrder._id,
      delivered: true,
      reason: reason || null,
      refundedAmount: refundAmount
    });

    await returnRequest.save();
    console.log('returnOrder: Return request saved:', returnRequest);

    const order = await Order.findByIdAndUpdate(
      existingOrder._id,
      { status: 'Return Requested' },
      { new: true, runValidators: true }
    );
    console.log('returnOrder: Order status updated to "Return Requested":', order);

    if (!order) {
      console.log('returnOrder: Failed to update order status for return:', existingOrder._id);
      return res.status(500).json({ success: false, message: 'Failed to update order status' });
    }

    res.status(200).json({ success: true, message: 'Request sent successfully' });
  } catch (error) {
    console.error('returnOrder: Error processing return request:', error);
    return next({ status: 500, message: 'Failed to process return request' });
  }
};

module.exports = { loadCheckout, verifyPayment, paymentFailed, confirmOrder, loadConfirmation, checkInvoiceStatus, downloadInvoice, loadOrderHistory, cancelOrder, returnOrder };