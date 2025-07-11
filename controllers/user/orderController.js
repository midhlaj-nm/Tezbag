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
    if (!req.session.user) return res.redirect('/');
    const userId = req.session.user;

    const cart = await Cart.findOne({ userId }).populate('items.productId');
    console.log('Cart data:', cart);
    if (!cart || !cart.items.length) return res.redirect('/shop');
    const wallet = await Wallet.findOne({ user: userId }).lean() || { balance: 0 };
    console.log('User wallet:', wallet);

    const subtotal = cart.total;
    const shipping = 0;
    const finalTotal = subtotal + shipping;

    const orderItems = cart.items.map(item => ({
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

    const user = await User.findById(userId);
    if (!user) return res.redirect('/');
    const name = `${user.f_Name} ${user.l_Name}`;

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

    const cartDetails = {
      total: cart.total,
      items: cart.items.map(item => ({
        productId: item.productId._id.toString(),
        quantity: item.quantity,
        price: item.price,
        totalPrice: item.totalPrice,
        cuttingStyle: item.cuttingStyle || null
      }))
    };

    res.render('checkout', {
      userId,
      name,
      wallet,
      total: cartDetails.total.toFixed(2) + '₹',
      coupons: formattedCoupons,
      orderItems,
      subtotal: subtotal.toFixed(2),
      shipping: shipping.toFixed(2),
      finalTotal: finalTotal.toFixed(2),
      savedAddresses: formattedAddresses,
      cartDetails,
      defaultAddress
    });
  } catch (error) {
    console.error('Error in loadCheckout:', error);
    next(error);
  }
};

const verifyPayment = async (req, res, next) => {
  try {
    console.log('Starting verifyPayment for orderId:', req.body.orderId);
    const { paymentResponse, orderId } = req.body;

    // Extract payment details from the response
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = paymentResponse;
    console.log('Received payment response:', { razorpay_order_id, razorpay_payment_id, razorpay_signature });

    // Generate signature to verify payment using the secret key from config
    const generatedSignature = crypto
      .createHmac('sha256', razorpay.key_secret)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');
    console.log('Generated signature:', generatedSignature);

    // Verify signature
    if (generatedSignature !== razorpay_signature) {
      console.log('Signature mismatch detected, marking payment as failed');
      const order = await Order.findOne({ orderId });
      if (order) {
        order.status = 'Payment Failed';
        order.paymentStatus = 'Failed';
        order.paymentDetails = order.paymentDetails || {};
        order.paymentDetails.failureReason = 'Signature mismatch';
        await order.save();
        console.log('Order updated to Payment Failed:', order);
      } else {
        console.log('No order found to update for orderId:', orderId);
      }
      return res.status(400).json({ success: false, message: 'Payment verification failed due to signature mismatch', redirect: '/retry-payment' });
    }
    console.log('Signature verified successfully');

    // Fetch the order from your database
    const order = await Order.findOne({ orderId });
    console.log('Fetched order:', order);
    if (!order) {
      console.log('Order not found for orderId:', orderId);
      return res.status(404).json({ success: false, message: 'Order not found', redirect: '/retry-payment' });
    }

    // Update order with payment details and set payment status to 'Paid'
    order.status = 'Pending';
    order.paymentStatus = 'Paid';
    order.paymentDetails = {
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      signature: razorpay_signature,
      method: req.body.paymentMethod || order.paymentMethod,
      amount: order.finalAmount,
      date: new Date(),
      transactionId: paymentResponse.razorpay_transaction_id || null,
      status: 'captured',
    };
    console.log('Updated payment details:', order.paymentDetails);
    await order.save();
    console.log('Order saved successfully with payment status:', order.paymentStatus);

    // Clear cart after successful payment
    await Cart.deleteOne({ userId: order.userId });
    console.log('Cart cleared for user:', order.userId);

    // Generate invoice if payment is successful
    const addrDoc = await Address.findOne({ userId: order.userId }).lean();
    const addr = addrDoc.address.find(item => item._id.toString() === order.address.toString());
    const invoice = await createInvoice(order, addr);
    console.log('Generated invoice:', invoice);
    const pdfUrl = await pdfGenerator(invoice, order);
    console.log('PDF URL generated:', pdfUrl);

    res.status(200).json({ success: true, message: 'Payment verified successfully', orderId, pdfUrl });
    console.log('Verification response sent:', { success: true, orderId, pdfUrl });
  } catch (error) {
    console.error('Error in verifyPayment:', error);
    const order = await Order.findOne({ orderId: req.body.orderId });
    if (order) {
      order.status = 'Payment Failed';
      order.paymentStatus = 'Failed';
      order.paymentDetails = order.paymentDetails || {};
      order.paymentDetails.failureReason = error.message || 'Unexpected error during verification';
      await order.save();
      console.log('Order updated to Payment Failed due to error:', order);
    } else {
      console.log('No order found to update for error case, orderId:', req.body.orderId);
    }
    return res.status(500).json({ success: false, message: 'Payment verification failed due to an error', redirect: '/retry-payment' });
  }
};

const paymentFailed = async (req, res) => {
  try {
    console.log('Rendering retryPayment page');
    res.render('retryPayment');
  } catch (error) {
    console.error('Error rendering retryPayment:', error);
    res.status(404);
  }
};

const confirmOrder = async (req, res, next) => {
  try {
    console.log('Starting confirmOrder with paymentMethod:', req.body.paymentMethod);
    const { paymentMethod, orderNotes, address, coupon, finalAmount } = req.body;
    const userId = req.session.user;
    const addressId = address._id;

    console.log('Address ID:', addressId);

    const addrDoc = await Address.findOne({ userId }).lean();
    console.log('Parent address document:', addrDoc);

    const addr = addrDoc.address.find(item => item._id.$oid === addressId || item._id.toString() === addressId);
    console.log('Selected address:', addr);

    if (!paymentMethod || !address || !finalAmount) {
      console.log('Missing required fields:', { paymentMethod, address, finalAmount });
      return res.status(400).json({ success: false, message: 'Missing required fields', redirect: '/retry-payment' });
    }

    const requiredFields = ['firstName', 'lastName', 'streetAddress', 'city', 'state', 'country', 'pinCode', 'landmark', 'email', 'phone'];
    const missing = requiredFields.filter(field => !address[field]);
    if (missing.length > 0) {
      console.log('Incomplete address fields:', missing);
      return res.status(400).json({ success: false, message: 'Incomplete address information', redirect: '/retry-payment' });
    }

    if (!userId || !addressId) {
      console.log('User or address missing:', { userId, addressId });
      return res.status(401).json({ success: false, message: 'User or address missing', redirect: '/retry-payment' });
    }

    const cart = await Cart.findOne({ userId }).populate('items');
    console.log('Cart data:', cart);
    if (!cart || !cart.items.length) {
      console.log('Cart is empty or not found');
      return res.status(400).json({ success: false, message: 'Cart is empty or not found', redirect: '/retry-payment' });
    }

    const orderedItems = cart.items.map(item => ({
      productId: item.productId,
      quantity: item.quantity,
      price: item.price,
      id: item._id,
      cuttingStyle: item.cuttingStyle
    }));
    console.log('Ordered items:', orderedItems);

    const totalPrice = orderedItems.reduce((sum, item) => sum + item.quantity * item.price, 0);
    const discount = totalPrice - parseFloat(finalAmount);
    console.log('Calculated totals:', { totalPrice, discount, finalAmount });

    const valid = [];
    for (const item of orderedItems) {
      const product = await Product.findById(item.productId);
      if (!product || product.quantity < item.quantity) {
        console.log('Out of stock product:', item.productId);
        return res.status(400).json({ success: false, message: 'Some products are out of stock', redirect: '/shop', delay: 2000 });
      }
      product.quantity -= item.quantity;
      product.status = product.quantity === 0 ? 'Out Of Stock' : 'Available';
      valid.push({ ...item, product });
    }
    console.log('Valid items after stock check:', valid);

    await Promise.all(valid.map(item => item.product.save()));
    console.log('Product quantities updated');

    // Create Razorpay order for UPI
    let razorpayOrder = null;
    if (paymentMethod === 'upi') {
      try {
        const options = {
          amount: parseFloat(finalAmount) * 100,
          currency: 'INR',
          receipt: `order_rcptid_${Date.now()}`,
        };
        console.log('Razorpay options:', options);
        razorpayOrder = await razorpay.orders.create(options);
        console.log('Razorpay order created:', razorpayOrder);
      } catch (razorpayError) {
        console.error('Razorpay order creation failed:', razorpayError.message);
        return res.status(400).json({ success: false, message: 'Failed to create Razorpay order', redirect: '/retry-payment' });
      }
    }

    const order = new Order({
      orderedItems: valid,
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
      ...(razorpayOrder && { razorpayOrderId: razorpayOrder.id }),
    });
    console.log('Order object before save:', order);
    await order.save();
    console.log('Order saved with ID:', order.orderId);

    // Handle wallet payment after order is saved
    if (paymentMethod === 'wallet') {
      const userWallet = await Wallet.findOne({ user: userId });
      console.log('User wallet:', userWallet);
      if (!userWallet) {
        console.log('Wallet not found for user:', userId);
        return res.status(400).json({ success: false, message: 'Wallet not found for the user', redirect: '/retry-payment' });
      }

      const amountToDeduct = parseFloat(finalAmount);
      if (userWallet.balance < amountToDeduct) {
        console.log('Insufficient wallet balance:', { balance: userWallet.balance, amountToDeduct });
        return res.status(400).json({ success: false, message: 'Insufficient wallet balance', redirect: '/retry-payment' });
      }

      userWallet.balance -= amountToDeduct;
      userWallet.transactions.push({
        type: 'debit',
        amount: amountToDeduct,
        reason: `Order payment (Order ID: ${order.orderId.slice(0, 6)})`,
        date: new Date()
      });
      console.log('Wallet transaction added:', userWallet.transactions[userWallet.transactions.length - 1]);
      await userWallet.save();
      console.log('Wallet updated with balance:', userWallet.balance);

      order.paymentStatus = 'Paid';
      order.paymentDetails = {
        method: 'Wallet',
        amount: order.finalAmount,
        date: new Date(),
      };
      await order.save();
      console.log('Order payment details updated for wallet');

      // Clear cart only after successful wallet payment
      await Cart.deleteOne({ userId });
      console.log('Cart cleared for user:', userId);
    }

    // Conditionally skip invoice generation for now (to be handled post-payment verification)
    let pdfUrl = null;
    if ((paymentMethod !== 'upi' && order.paymentStatus === 'Paid') || (paymentMethod === 'wallet' && order.paymentStatus === 'Paid')) {
      const invoice = await createInvoice(order, addr);
      console.log('Generated invoice:', invoice);
      pdfUrl = await pdfGenerator(invoice, order);
      console.log('PDF URL generated:', pdfUrl);

      // Clear cart after successful non-UPI payment or wallet payment
      await Cart.deleteOne({ userId });
      console.log('Cart cleared for user:', userId);
    }

    res.status(200).json({
      success: true,
      message: 'Order initiated successfully',
      orderId: order.orderId,
      pdfUrl,
      razorpayKey: paymentMethod === 'upi' ? process.env.RAZORPAY_KEY_ID : null,
      razorpayOrderId: paymentMethod === 'upi' ? razorpayOrder.id : null,
    });
    console.log('Response sent to client:', { success: true, orderId: order.orderId, pdfUrl });
  } catch (error) {
    console.error('Error in confirmOrder:', error);
    // Revert product quantities on failure
    const cart = await Cart.findOne({ userId }).populate('items');
    if (cart) {
      for (const item of cart.items) {
        const product = await Product.findById(item.productId);
        if (product) {
          product.quantity += item.quantity;
          product.status = product.quantity > 0 ? 'Available' : 'Out Of Stock';
          await product.save();
          console.log('Reverted quantity for product on error:', item.productId);
        }
      }
    }
    return res.status(500).json({ success: false, message: 'Order initiation failed due to an error', redirect: '/retry-payment' });
  }
};

const cancelOrder = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    console.log('Attempting to cancel or mark payment failure for orderId:', orderId);

    const order = await Order.findOne({ orderId });
    if (!order) {
      console.log('Order not found for cancellation/failure:', orderId);
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.paymentStatus === 'Paid') {
      console.log('Order already paid, cannot cancel:', orderId);
      return res.status(400).json({ success: false, message: 'Order already paid, cannot cancel' });
    }

    // If payment is not yet processed (e.g., UPI dismissal), mark as Payment Failed
    if (order.paymentStatus === 'Not Paid') {
      order.status = 'Payment Failed';
      order.paymentStatus = 'Failed';
      order.paymentDetails = order.paymentDetails || {};
      order.paymentDetails.failureReason = 'Payment canceled by user';
      await order.save();
      console.log('Order marked as Payment Failed:', order);
    } else {
      // Revert product quantities only if not already processed
      for (const item of order.orderedItems) {
        const product = await Product.findById(item.productId);
        if (product) {
          product.quantity += item.quantity;
          product.status = product.quantity > 0 ? 'Available' : 'Out Of Stock';
          await product.save();
          console.log('Reverted quantity for product:', item.productId);
        }
      }
      await Order.deleteOne({ orderId });
      console.log('Order cancelled and deleted:', orderId);
    }

    res.status(200).json({ success: true, message: 'Order processed as failed or cancelled successfully' });
  } catch (error) {
    console.error('Error in cancelOrder:', error);
    next(error);
  }
};

const loadConfirmation = async (req, res) => {
  try {
    const userId = req.session.user;
    const orderId = req.params.orderId;
    console.log('OrderId:', orderId);
    console.log('UserId:', userId);

    const user = await User.findById(userId);
    if (!user) return res.redirect('/');

    const order = await Order.findOne({ orderId })
      .populate('orderedItems.productId', 'productName productImage')
      .lean();
    console.log('Order details:', order);

    const addrDoc = await Address.findOne({ userId: order.userId }).lean();
    console.log('Parent address document:', addrDoc);

    const addr = addrDoc.address.find(item => item._id.$oid === order.address || item._id.toString() === order.address.toString());
    console.log('Selected address:', addr);

    const billingName = `${addr.firstName} ${addr.lastName}`.trim();
    const billingAddress = `${addr.streetAddress}, ${addr.city}, ${addr.state}`;
    const billingPhone = addr.phone;
    const billingEmail = addr.email;

    const invoice = await Invoice.findOne({ orderId: order.orderId });
    console.log('Invoice details:', invoice);

    res.render('orderDetails', {
      order: order,
      orderId,
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
    console.log('Error in loadConfirmation:', error);
    res.status(404);
  }
};

const downloadInvoice = async (req, res) => {
  try {
    const pdfUrl = decodeURIComponent(req.query.url);
    console.log('Attempting to download from URL:', pdfUrl);
    const response = await axios({
      url: pdfUrl,
      method: 'GET',
      responseType: 'stream',
    });

    const filename = req.query.filename || 'invoice.pdf';
    console.log('Using filename:', filename);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');

    response.data.pipe(res);
  } catch (error) {
    console.error('Error downloading invoice:', error.message);
    res.status(500)
  }
};

const loadOrderHistory = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect('/login');
    }

    const userId = req.session.user;
    const searchQuery = req.query.query || '';
    const page = parseInt(req.query.page) || 1;
    const limit = 10;

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
    });
  } catch (error) {
    console.error('Error loading order history:', error);
    return res.status(404);
  }
};

const returnOrder = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;
    const userId = req.session.user;

    if (!orderId || !userId) {
      return res.status(400).json({ success: false, message: "Something went wrong" });
    }

    const existingOrder = await Order.findOne({ orderId });

    if (!existingOrder) {
      return res.status(404).json({ success: false, message: "Order not found" });
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

    const order = await Order.findByIdAndUpdate(
      existingOrder._id,
      { status: "Return Requested" },
      { new: true, runValidators: true }
    );

    if (!order) {
      return res.status(500).json({ success: false, message: "Failed to update order status" });
    }

    res.status(200).json({ success: true, message: "request sent successfully" });
  } catch (error) {
    console.error('Error processing return request:', error);
    next(error);
  }
};

module.exports = { loadCheckout, verifyPayment, paymentFailed, confirmOrder, loadConfirmation, downloadInvoice, loadOrderHistory, cancelOrder, returnOrder };