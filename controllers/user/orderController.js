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
      console.debug('loadCheckout: User not authenticated, redirecting to login.');
      return res.redirect('/login');
    }
    const userId = req.session.user;
    console.debug('loadCheckout: Processing for user:', userId);

    let itemsToCheckout = [];
    let subtotal = 0;
    let isRetryFlow = false;
    let retryOrderData = null;

    const { productId, quantity, cuttingStyle, retry, orderId: retryOrderIdParam } = req.query;

    if (retry === 'true' && retryOrderIdParam) {
      console.debug('loadCheckout: Entering retry payment flow for order:', retryOrderIdParam);
      isRetryFlow = true;
      const orderToRetry = await Order.findOne({ orderId: retryOrderIdParam }).populate('orderedItems.productId'); // Use custom orderId
      if (!orderToRetry || orderToRetry.userId.toString() !== userId.toString()) {
        console.debug('loadCheckout: Retry order not found or unauthorized:', retryOrderIdParam);
        return res.status(404);
      }
      if (!(orderToRetry.paymentStatus === 'Failed' || orderToRetry.paymentStatus === 'Not Paid')) {
        console.debug('loadCheckout: Order not retryable, status:', orderToRetry.status, 'payment:', orderToRetry.paymentStatus);
        return res.status(400);
      }
      itemsToCheckout = orderToRetry.orderedItems.map(item => ({
        productId: item.productId,
        quantity: item.quantity,
        price: item.price,
        totalPrice: item.quantity * item.price,
        cuttingStyle: item.cuttingStyle || null
      }));
      subtotal = orderToRetry.totalPrice;
      retryOrderData = {
        orderId: orderToRetry.orderId, // Use custom orderId
        amount: orderToRetry.finalAmount,
        razorpayKey: process.env.RAZORPAY_KEY_ID,
        razorpayOrderId: orderToRetry.razorpayOrderId,
      };
      console.debug('loadCheckout: Prepared retry for order, subtotal:', subtotal);
    } else if (productId && quantity) {
      console.debug('loadCheckout: Entering buy now flow for product:', productId);
      const product = await Product.findById(productId);
      if (!product) {
        console.debug('loadCheckout: Product not found:', productId);
        return res.redirect('/shop');
      }
      const itemQuantity = parseInt(quantity);
      const itemPrice = product.regularPrice;
      itemsToCheckout.push({
        productId: product,
        quantity: itemQuantity,
        price: itemPrice,
        totalPrice: itemPrice * itemQuantity,
        cuttingStyle: cuttingStyle || null
      });
      subtotal = itemPrice * itemQuantity;
      console.debug('loadCheckout: Buy now subtotal:', subtotal);
    } else {
      console.debug('loadCheckout: Entering standard cart checkout flow for user:', userId);
      const cart = await Cart.findOne({ userId }).populate('items.productId');
      if (!cart || !cart.items.length) {
        console.debug('loadCheckout: Cart empty for user:', userId);
        return res.redirect('/shop');
      }
      itemsToCheckout = cart.items;
      subtotal = itemsToCheckout.reduce((acc, item) => acc + item.totalPrice, 0);
      console.debug('loadCheckout: Cart subtotal:', subtotal);
    }

    const shipping = 0;
    const finalTotal = subtotal + shipping;
    console.debug('loadCheckout: Final total:', finalTotal);

    const wallet = await Wallet.findOne({ user: userId }).lean() || { balance: 0 };
    const user = await User.findById(userId);
    if (!user) {
      console.debug('loadCheckout: User not found:', userId);
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

    const coupons = await Deal.find({ offerType: 'coupon', status: 'Active', expireOn: { $gte: new Date() } }).lean();
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
      defaultAddress,
      retryOrderData: isRetryFlow ? retryOrderData : null
    });
    console.debug('loadCheckout: Checkout page rendered for user:', userId);
  } catch (error) {
    console.error('loadCheckout: Error occurred:', error);
    return next({ status: 500, message: 'Failed to load checkout page' });
  }
};

const verifyPayment = async (req, res, next) => {
  let orderId;
  try {
    console.debug('verifyPayment: Initiated for request body:', req.body);
    const { paymentResponse, orderId: requestOrderId } = req.body;
    orderId = requestOrderId;
    console.debug('verifyPayment: Destructured orderId:', orderId);
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = paymentResponse;
    console.debug('verifyPayment: Received Razorpay payment response - order_id:', razorpay_order_id, 'payment_id:', razorpay_payment_id);

    const generatedSignature = crypto.createHmac('sha256', razorpay.key_secret)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');
    console.debug('verifyPayment: Generated signature:', generatedSignature);

    if (generatedSignature !== razorpay_signature) {
      console.debug('verifyPayment: Signature mismatch detected for order:', orderId);
      const order = await Order.findOne({ orderId: orderId }) || await Order.findById(orderId);
      if (order) {
        order.paymentStatus = 'Failed';
        order.status = 'Payment Failed';
        order.paymentDetails = { failureReason: 'Signature mismatch' };
        await order.save();
        console.debug('verifyPayment: Order status updated to Payment Failed and paymentStatus to Failed for _id:', order._id);
      }
      return res.status(400).json({ success: false, message: 'Payment verification failed due to signature mismatch' });
    }

    let order = await Order.findOne({ orderId: orderId });
    if (!order) {
      order = await Order.findById(orderId);
      if (order) orderId = order.orderId;
    }
    console.debug('verifyPayment: Found order by ID:', orderId, 'Order existence:', !!order);
    if (!order) {
      console.debug('verifyPayment: Order not found for ID:', orderId);
      return res.status(400).json({ success: false, message: 'Order not found' });
    }

    order.status = 'Pending';
    order.paymentStatus = 'Paid';
    order.paymentDetails = {
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      signature: razorpay_signature,
      method: req.body.paymentMethod || order.paymentMethod,
      amount: order.finalAmount,
      date: new Date(),
      transactionId: paymentResponse.razorpay_transaction_id,
      status: 'captured',
    };
    const savedOrder = await order.save();
    console.debug('verifyPayment: Payment verified and order saved for _id:', savedOrder._id, 'New paymentStatus:', savedOrder.paymentStatus);

    await Cart.deleteOne({ userId: order.userId });
    console.debug('verifyPayment: Cart cleared for user:', order.userId);

    setImmediate(async () => {
      try {
        console.debug('verifyPayment: Initiating async invoice generation for order _id:', order._id);
        const addrDoc = await Address.findOne({ userId: order.userId }).lean();
        const addr = addrDoc.address.find(item => item._id.toString() === order.address.toString());
        const invoice = await createInvoice(order, addr);
        const pdfUrl = await pdfGenerator(invoice, order);
        order.pdfUrl = pdfUrl;
        await order.save();
        console.debug('verifyPayment: Invoice generated and saved with PDF URL:', pdfUrl);
      } catch (err) {
        console.error('verifyPayment: Async invoice generation failed for order _id:', order._id, 'Error:', err.message);
      }
    });

    res.status(200).json({ success: true, message: 'Payment verified', orderId: order.orderId, pdfUrl: null });
  } catch (error) {
    console.error('verifyPayment: Error during verification for orderId:', orderId, 'Error:', error.message);
    const order = await Order.findOne({ orderId: orderId }) || await Order.findById(orderId);
    if (order) {
      order.paymentStatus = 'Failed';
      order.status = 'Payment Failed';
      order.paymentDetails = { failureReason: error.message || 'Verification error' };
      await order.save();
      console.debug('verifyPayment: Order marked as Payment Failed and paymentStatus to Failed in catch block for _id:', order._id);
    }
    return next({ status: 500, message: 'Payment verification failed' });
  }
};

const paymentFailed = async (req, res, next) => {
  try {
    console.debug('paymentFailed: Rendering retry page for user:', req.session.user);
    const userId = req.session.user;
    const latestFailedOrder = await Order.findOne({ 
      userId, 
      paymentStatus: 'Failed',
      $or: [
        { status: 'Pending' },
        { status: 'Payment Failed' }
      ]
    })
      .sort({ invoiceDate: -1 })
      .populate('orderedItems.productId');
    if (!latestFailedOrder) {
      console.debug('paymentFailed: No failed order found for user:', userId);
      return res.redirect('/shop');
    }
    const razorpayKey = process.env.RAZORPAY_KEY_ID;
    const amount = latestFailedOrder.finalAmount;
    console.debug('paymentFailed: Retry data - Order:', latestFailedOrder._id, 'Amount:', amount);

    res.render('retryPayment', {
      orderId: latestFailedOrder.orderId, // Use custom orderId instead of _id
      amount,
      razorpayKey,
      razorpayOrderId: latestFailedOrder.razorpayOrderId,
      userId,
    });
    console.debug('paymentFailed: Retry page rendered for order:', latestFailedOrder._id);
  } catch (error) {
    console.error('paymentFailed: Error rendering retry page for user:', userId, 'error:', error);
    return next({ status: 500, message: 'Error loading payment failure page' });
  }
};

const confirmOrder = async (req, res, next) => {
  let order = null;
  let productsToUpdate = [];
  const userId = req.session.user;
  console.debug('confirmOrder: Initiated for user:', userId, 'Request body:', req.body);

  try {
    const { paymentMethod, orderNotes, addressId, coupon, finalAmount, productId, quantity, cuttingStyle, retryOrderId } = req.body;

    if (!addressId) {
      console.debug('confirmOrder: Missing addressId for user:', userId);
      return res.status(400);
    }

    const addrDoc = await Address.findOne({ userId }).lean();
    const addr = addrDoc ? addrDoc.address.find(item => item._id.toString() === addressId) : null;
    console.debug('confirmOrder: Address found for ID:', addressId, 'Existence:', !!addr);
    if (!addr) {
      console.debug('confirmOrder: Address not found for user:', userId, 'Address ID:', addressId);
      return res.status(400);
    }

    if (!paymentMethod || !finalAmount) {
      console.debug('confirmOrder: Missing payment method or finalAmount for user:', userId);
      return res.status(400);
    }

    const requiredAddressFields = ['firstName', 'lastName', 'streetAddress', 'city', 'state', 'country', 'pinCode', 'landMark', 'phone'];
    const missingAddressFields = requiredAddressFields.filter(field => !addr[field]);
    if (missingAddressFields.length > 0) {
      console.debug('confirmOrder: Incomplete address information for user:', userId, 'Missing fields:', missingAddressFields.join(', '));
      return res.status(400);
    }

    if (!userId) {
      console.debug('confirmOrder: User not authenticated.');
      return res.status(401);
    }

    let orderedItems = [];
    let totalPrice = 0;
    let isBuyNow = false;

    if (retryOrderId) {
      console.debug('confirmOrder: Processing retry flow for order:', retryOrderId);
      order = await Order.findById(retryOrderId);
      console.debug('confirmOrder: Retry order found:', !!order, 'Order userId matches session:', order.userId.toString() === userId.toString());
      if (!order || order.userId.toString() !== userId.toString()) {
        console.debug('confirmOrder: Invalid or unauthorized retry order:', retryOrderId);
        return res.status(404);
      }
      if (order.paymentStatus === 'Paid' && order.status !== 'Payment Failed') {
        console.debug('confirmOrder: Order already paid and not in failed state, cannot retry:', retryOrderId);
        return res.status(400);
      }
      orderedItems = order.orderedItems;
      totalPrice = order.totalPrice;
      if (parseFloat(finalAmount) !== order.finalAmount) {
        console.warn('confirmOrder: Amount mismatch for retry, using order finalAmount:', order.finalAmount, 'Received finalAmount:', finalAmount);
      }
      const discount = order.totalPrice - order.finalAmount;
      for (const item of orderedItems) {
        const product = await Product.findById(item.productId);
        console.debug('confirmOrder: Checking stock for product:', item.productId, 'Quantity:', product ? product.quantity : 'N/A', 'Needed:', item.quantity);
        if (!product || product.quantity < item.quantity) {
          console.debug('confirmOrder: Product out of stock for retry:', item.productId);
          return res.status(400);
        }
        product.quantity -= item.quantity;
        product.status = product.quantity === 0 ? 'Out Of Stock' : 'Available';
        productsToUpdate.push({ ...item, product });
      }
      await Promise.all(productsToUpdate.map(item => item.product.save()));
      console.debug('confirmOrder: Product quantities deducted for retry order:', retryOrderId);
    } else if (productId && quantity) {
      console.debug('confirmOrder: Processing buy now order for product:', productId, 'Quantity:', quantity);
      isBuyNow = true;
      const product = await Product.findById(productId).populate('category', 'name categoryOffer isListed');
      console.debug('confirmOrder: Buy now product found:', !!product, 'Product quantity:', product ? product.quantity : 'N/A', 'Requested quantity:', quantity);
      if (!product || product.quantity < quantity) {
        console.debug('confirmOrder: Product not found or insufficient stock for buy now:', productId);
        return res.status(400);
      }
      const productOffer = product.productOffer || 0;
      const categoryOffer = product.category?.categoryOffer || 0;
      const largestOffer = Math.max(productOffer, categoryOffer);
      const price = largestOffer > 0 ? product.regularPrice * (1 - largestOffer / 100) : product.regularPrice;
      orderedItems.push({
        productId: product._id,
        quantity: parseInt(quantity),
        price: price,
        cuttingStyle: cuttingStyle
      });
      totalPrice = price * parseInt(quantity);
      product.quantity -= parseInt(quantity);
      product.status = product.quantity === 0 ? 'Out Of Stock' : 'Available';
      productsToUpdate.push({ productId: product._id, quantity: parseInt(quantity), product });
      await product.save();
      console.debug('confirmOrder: Product quantity deducted for buy now:', productId);
    } else {
      console.debug('confirmOrder: Processing cart-based order for user:', userId);
      const cart = await Cart.findOne({ userId }).populate('items.productId');
      console.debug('confirmOrder: Cart found for user:', !!cart, 'Cart items count:', cart ? cart.items.length : 0);
      if (!cart || !cart.items.length) {
        console.debug('confirmOrder: Cart empty or invalid for user:', userId);
        return res.status(400);
      }
      orderedItems = cart.items.map(item => ({
        productId: item.productId._id,
        quantity: item.quantity,
        price: item.price,
        cuttingStyle: item.cuttingStyle
      }));
      totalPrice = cart.total;
      for (const item of orderedItems) {
        const product = await Product.findById(item.productId);
        console.debug('confirmOrder: Checking cart product stock for:', item.productId, 'Quantity:', product ? product.quantity : 'N/A', 'Needed:', item.quantity);
        if (!product || product.quantity < item.quantity) {
          console.debug('confirmOrder: Product out of stock in cart:', item.productId);
          await Promise.all(productsToUpdate.map(pItem => pItem.product.save()));
          return res.status(400);
        }
        product.quantity -= item.quantity;
        product.status = product.quantity === 0 ? 'Out Of Stock' : 'Available';
        productsToUpdate.push({ ...item, product });
      }
      await Promise.all(productsToUpdate.map(item => item.product.save()));
      console.debug('confirmOrder: Product quantities deducted from cart for user:', userId);
    }

    const discount = totalPrice - parseFloat(finalAmount);
    order = new Order({
      orderedItems,
      totalPrice,
      discount,
      finalAmount: parseFloat(finalAmount),
      paymentMethod,
      userId,
      address: addressId,
      orderNotes: orderNotes,
      invoiceDate: new Date(),
      status: 'Pending',
      couponApplied: !!coupon,
      paymentStatus: 'Not Paid',
    });
    await order.save();
    console.debug('confirmOrder: New order saved with _id:', order._id, 'Custom orderId:', order.orderId);

    if (paymentMethod === 'upi') {
      console.debug('confirmOrder: Processing UPI payment for order _id:', order._id);
      const options = {
        amount: parseFloat(order.finalAmount) * 100,
        currency: 'INR',
        receipt: `order_rcptid_${order._id.toString()}`,
      };
      const razorpayOrder = await razorpay.orders.create(options);
      order.razorpayOrderId = razorpayOrder.id;
      await order.save();
      console.debug('confirmOrder: UPI order initiated with Razorpay order ID:', razorpayOrder.id);
      res.status(200).json({
        success: true,
        message: 'Order initiated for UPI',
        orderId: order.orderId,
        razorpayKey: process.env.RAZORPAY_KEY_ID,
        razorpayOrderId: razorpayOrder.id,
        finalAmount: order.finalAmount,
      });
    } else if (paymentMethod === 'wallet') {
      console.debug('confirmOrder: Processing wallet payment for order _id:', order._id);
      const userWallet = await Wallet.findOne({ user: userId });
      console.debug('confirmOrder: User wallet found:', !!userWallet, 'Balance:', userWallet ? userWallet.balance : 'N/A');
      if (!userWallet || userWallet.balance < parseFloat(order.finalAmount)) {
        console.debug('confirmOrder: Wallet invalid or insufficient balance for user:', userId);
        await Promise.all(productsToUpdate.map(item => item.product.save()));
        if (!retryOrderId) await Order.deleteOne({ _id: order._id });
        return res.status(400).json({ success: false, message: 'Insufficient wallet balance' });
      }
      userWallet.balance -= parseFloat(order.finalAmount);
      userWallet.transactions.push({ type: 'debit', amount: order.finalAmount, reason: `Order payment (Order ID: ${order._id.toString().slice(0, 6)})`, date: new Date() });
      await userWallet.save();
      order.paymentStatus = 'Paid';
      await order.save();
      console.debug('confirmOrder: Wallet payment processed and order updated for _id:', order._id);
      if (!isBuyNow) await Cart.deleteOne({ userId });
      setImmediate(async () => {
        const invoice = await createInvoice(order, addr);
        const pdfUrl = await pdfGenerator(invoice, order);
        order.pdfUrl = pdfUrl;
        await order.save();
        console.debug('confirmOrder: Invoice generated for wallet payment, PDF URL:', pdfUrl);
      });
      res.status(200).json({ success: true, message: 'Order placed with wallet', orderId: order.orderId, pdfUrl: null });
    } else if (paymentMethod === 'cod') {
      console.debug('confirmOrder: Processing COD payment for order _id:', order._id);
      order.paymentStatus = 'Not Paid';
      await order.save();
      console.debug('confirmOrder: COD order saved with status Pending and paymentStatus Not Paid for _id:', order._id);
      if (!isBuyNow) await Cart.deleteOne({ userId });
      setImmediate(async () => {
        const invoice = await createInvoice(order, addr);
        const pdfUrl = await pdfGenerator(invoice, order);
        order.pdfUrl = pdfUrl;
        await order.save();
        console.debug('confirmOrder: Invoice generated for COD payment, PDF URL:', pdfUrl);
      });
      res.status(200).json({ success: true, message: 'Order placed with COD', orderId: order.orderId, pdfUrl: null });
    } else {
      console.debug('confirmOrder: Unsupported payment method:', paymentMethod, 'for user:', userId);
      await Promise.all(productsToUpdate.map(item => item.product.save()));
      if (!retryOrderId && order) await Order.deleteOne({ _id: order._id });
      return res.status(400).json({ success: false, message: 'Unsupported payment method' });
    }
  } catch (error) {
    console.error('confirmOrder: Error processing order for user:', userId, 'Error:', error.message);
    if (productsToUpdate.length > 0) {
      await Promise.all(productsToUpdate.map(item => {
        item.product.quantity += item.quantity;
        item.product.status = item.product.quantity > 0 ? 'Available' : 'Out Of Stock';
        return item.product.save();
      }));
      console.debug('confirmOrder: Product quantities reversed due to error for user:', userId);
    }
    if (order && !retryOrderId && order.paymentStatus === 'Not Paid' && order.status === 'Pending') {
      await Order.deleteOne({ _id: order._id });
      console.debug('confirmOrder: New order deleted due to error for user:', userId);
    } else if (order && retryOrderId) {
      order.paymentStatus = 'Failed';
      order.status = 'Payment Failed';
      await order.save();
      console.debug('confirmOrder: Retry order marked as Failed and Payment Failed due to error for _id:', retryOrderId);
    }
    return next({ status: 500, message: 'Order processing failed' });
  }
};

const checkInvoiceStatus = async (req, res, next) => {
  try {
    const userId = req.session?.user;
    const orderId = req.params.orderId;
    console.debug('checkInvoiceStatus: Checking for user:', userId, 'orderId:', orderId);

    if (!userId) {
      console.debug('checkInvoiceStatus: User not authenticated or session unavailable for orderId:', orderId);
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const user = await User.findById(userId);
    if (!user) {
      console.debug('checkInvoiceStatus: User not found:', userId);
      return res.status(401).json({ error: 'User not found' });
    }

    const order = await Order.findOne({ orderId }).lean();
    if (!order) {
      console.debug('checkInvoiceStatus: Order not found for orderId:', orderId);
      return res.status(404).json({ error: 'Order not found' });
    }

    const invoice = await Invoice.findOne({ orderId: order.orderId }).lean();
    const invoicePdf = invoice?.pdfUrl || order.pdfUrl || null;
    const invoiceNumber = invoice?.invoiceNumber.slice(-6) || order.orderId.slice(-6) || null;

    res.json({ success: true, invoicePdf, invoiceNumber });
    console.debug('checkInvoiceStatus: Invoice status checked for orderId:', orderId, 'pdfUrl:', invoicePdf);
  } catch (error) {
    console.error('checkInvoiceStatus: Error occurred for user:', userId, 'orderId:', orderId, 'error:', error);
    return next({ status: 500, message: 'Error checking invoice status' });
  }
};

const cancelOrder = async (req, res, next) => {
  const orderId = req.params.orderId;
  console.debug('cancelOrder: Processing cancellation for order ID:', orderId);

  try {
    const order = await Order.findOne({ orderId });
    console.debug('cancelOrder: Order found for ID:', orderId, 'Existence:', !!order);
    if (!order) {
      console.debug('cancelOrder: Order not found for ID:', orderId);
      return res.status(404);
    }

    if (order.paymentStatus === 'Paid') {
      if (order.status === 'Cancelled') {
        console.debug('cancelOrder: Order already cancelled for ID:', orderId);
        return res.status(200);
      }
      order.status = 'Cancelled';
      await order.save();
      let userWallet = await Wallet.findOne({ user: order.userId });
      if (!userWallet) {
        userWallet = new Wallet({ user: order.userId, balance: 0 });
        console.debug('cancelOrder: New wallet created for user:', order.userId);
      }
      userWallet.balance += order.finalAmount;
      userWallet.transactions.push({ type: 'credit', amount: order.finalAmount, reason: `Refund for order ${order._id.toString().slice(0, 6)}`, date: new Date() });
      await userWallet.save();
      console.debug('cancelOrder: Refund processed and wallet updated for user:', order.userId, 'Amount:', order.finalAmount);

      for (const item of order.orderedItems) {
        const product = await Product.findById(item.productId);
        if (product) {
          product.quantity += item.quantity;
          product.status = product.quantity > 0 ? 'Available' : 'Out Of Stock';
          await product.save();
          console.debug('cancelOrder: Product quantity restored for product:', product._id, 'New quantity:', product.quantity);
        }
      }
      console.debug('cancelOrder: Order cancelled and refunded for order _id:', order._id);
      res.status(200).json({ success: true, message: 'Order cancelled and refunded.' });
    } else if (order.paymentStatus === 'Not Paid' || order.paymentStatus === 'Failed') {
      if (order.status === 'Pending' && order.paymentStatus === 'Not Paid') {
        order.status = 'Payment Failed';
        order.paymentStatus = 'Failed';
        order.paymentDetails = { failureReason: 'Cancelled by user' };
        for (const item of order.orderedItems) {
          const product = await Product.findById(item.productId);
          if (product) {
            product.quantity += item.quantity;
            product.status = product.quantity > 0 ? 'Available' : 'Out Of Stock';
            await product.save();
            console.debug('cancelOrder: Product quantity restored (unpaid order) for product:', product._id, 'New quantity:', product.quantity);
          }
        }
        await order.save();
        console.debug('cancelOrder: Order marked as Payment Failed for _id:', order._id);
        res.status(200).json({ success: true, message: 'Order marked as Payment Failed.' });
      } else if (order.status === 'Pending' && order.paymentStatus === 'Failed') {
        console.debug('cancelOrder: Order already failed for ID:', orderId);
        res.status(200).json({ success: true, message: 'Order already failed.' });
      } else {
        for (const item of order.orderedItems) {
          const product = await Product.findById(item.productId);
          if (product) {
            product.quantity += item.quantity;
            product.status = product.quantity > 0 ? 'Available' : 'Out Of Stock';
            await product.save();
            console.debug('cancelOrder: Product quantity restored (status updated) for product:', product._id, 'New quantity:', product.quantity);
          }
        }
        order.status = 'Request Declined';
        order.paymentStatus = 'Failed';
        await order.save();
        console.debug('cancelOrder: Order status updated to Request Declined for _id:', order._id);
        res.status(200).json({ success: true, message: 'Order status updated.' });
      }
    } else {
      console.debug('cancelOrder: Invalid order state for cancellation for ID:', orderId, 'Status:', order.status, 'Payment Status:', order.paymentStatus);
      return res.status(400);
    }
  } catch (error) {
    console.error('cancelOrder: Error during cancellation for orderId:', orderId, 'Error:', error.message);
    return next({ status: 500, message: 'Failed to process order cancellation' });
  }
};

const loadConfirmation = async (req, res, next) => {
    try {
        const userId = req.session.user;
        if (!userId) {
            console.debug('loadConfirmation: User session not found, redirecting to login.');
            return res.redirect('/login');
        }
        const orderId = req.params.orderId; // This is your custom UUID-like orderId
        console.debug('loadConfirmation: Loading for user:', userId, 'orderId:', orderId);

        const user = await User.findById(userId);
        if (!user) {
            console.debug('loadConfirmation: User not found:', userId);
            return res.redirect('/login');
        }

        // FIX: Only query by the custom 'orderId' field, not '_id'
        const order = await Order.findOne({ orderId: orderId }).populate('orderedItems.productId', 'productName productImage').lean();
        console.debug('loadConfirmation: Order found by custom orderId:', !!order, 'for orderId:', orderId);

        if (!order) {
            console.debug('loadConfirmation: Order not found for custom orderId:', orderId);
            return res.status(404).json({ message: 'Order not found' });
        }

        // Previous FIX: Ensure this is findOne({ userId: ... })
        const addrDoc = await Address.findOne({ userId: order.userId }).lean();
        console.debug('loadConfirmation: Address document found:', !!addrDoc, 'for user:', order.userId);

        if (!addrDoc || !addrDoc.address) {
            console.debug('loadConfirmation: Address not found or empty for user:', order.userId);
            return res.status(404).json({ message: 'Address information missing' });
        }
        const addr = addrDoc.address.find(item => item._id.toString() === order.address.toString());
        console.debug('loadConfirmation: Delivery address found for order:', order.orderId, 'Existence:', !!addr);

        if (!addr) {
            console.debug('loadConfirmation: Delivery address not found within document for order:', orderId);
            return res.status(404).json({ message: 'Delivery address not found for the order' });
        }

        const billingName = `${addr.firstName} ${addr.lastName}`.trim();
        const billingAddress = `${addr.streetAddress}, ${addr.city}, ${addr.state}`;
        const invoice = await Invoice.findOne({ orderId: order.orderId });
        console.debug('loadConfirmation: Invoice found for order:', order.orderId, 'Existence:', !!invoice);

        res.render('orderDetails', {
            order,
            orderId: order.orderId,
            billingName,
            billingAddress,
            billingPhone: addr.phone,
            billingEmail: addr.email,
            invoiceDate: order.invoiceDate,
            paymentMethod: order.paymentMethod,
            shipping: 'Normal',
            invoicePdf: invoice?.pdfUrl,
            invoiceNumber: invoice?.invoiceNumber.slice(-6),
            products: order.orderedItems,
            subtotal: order.totalPrice,
            discount: order.discount,
            finalAmount: order.finalAmount
        });
        console.debug('loadConfirmation: Confirmation page rendered for orderId:', order.orderId);
    } catch (error) {
        console.error('loadConfirmation: Unhandled error in confirmation page:', error);
        return next({ status: 500, message: 'Failed to load order confirmation' });
    }
};

const downloadInvoice = async (req, res, next) => {
  try {
    const pdfUrl = decodeURIComponent(req.query.url);
    console.debug('downloadInvoice: Downloading from url:', pdfUrl);
    const response = await axios({ url: pdfUrl, method: 'GET', responseType: 'stream' });
    const filename = req.query.filename || 'invoice.pdf';
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    response.data.pipe(res);
    console.debug('downloadInvoice: Download initiated for file:', filename);
  } catch (error) {
    console.error('downloadInvoice: Download failed for url:', pdfUrl, 'error:', error.message);
    return next({ status: 500, message: 'Error downloading invoice' });
  }
};

const loadOrderHistory = async (req, res, next) => {
  try {
    if (!req.session.user) {
      console.debug('loadOrderHistory: User not authenticated, redirecting to login.');
      return res.redirect('/login');
    }
    const userId = req.session.user;
    const searchQuery = req.query.query || '';
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    console.debug('loadOrderHistory: Loading for user:', userId);

    const cart = await Cart.findOne({ userId }).select('total');
    const cartTotal = cart ? `${cart.total.toFixed(2)}₹` : '0.00₹';

    const allOrders = await Order.find({ userId }).populate('orderedItems.productId', 'productName').sort({ invoiceDate: -1});
    const orders = searchQuery
      ? allOrders.filter(x => x.orderId.match(new RegExp(searchQuery, 'i')) || x.status.match(new RegExp(searchQuery, 'i')) || x.orderedItems.some(item => item.productId?.productName?.match(new RegExp(searchQuery, 'i'))))
      : allOrders;
    const totalOrders = orders.length;
    const totalPages = Math.ceil(totalOrders / limit);
    const skip = (page - 1) * limit;
    const paginationOrders = orders.slice(skip, skip + limit);

    res.render('orderHistory', { searchQuery, orders: paginationOrders, currentPage: page, totalPages, cartTotal });
    console.debug('loadOrderHistory: History page rendered for user:', userId, 'page:', page);
  } catch (error) {
    console.error('loadOrderHistory: Error occurred for user:', userId, 'error:', error);
    return next({ status: 500, message: 'Error loading order history' });
  }
};

const returnOrder = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;
    const userId = req.session.user;
    console.debug('returnOrder: Processing return for orderId:', orderId, 'user:', userId);

    if (!orderId || !userId) {
      console.debug('returnOrder: Missing orderId or userId for request.');
      return res.status(400);
    }

    const order = await Order.findOne({ orderId });
    if (!order) {
      console.debug('returnOrder: Order not found for orderId:', orderId);
      return res.status(404);
    }

    const returnRequest = new Return({ userId, orderId: order._id, delivered: true, reason, refundedAmount: order.finalAmount });
    await returnRequest.save();
    await Order.findByIdAndUpdate(order._id, { status: 'Return Requested' }, { new: true });
    console.debug('returnOrder: Return requested for orderId:', orderId);

    res.status(200).json({ success: true, message: 'Return request sent' });
    console.debug('returnOrder: Return request processed for orderId:', orderId);
  } catch (error) {
    console.error('returnOrder: Error occurred for orderId:', orderId, 'user:', userId, 'error:', error);
    return next({ status: 500, message: 'Failed to process return' });
  }
};

module.exports = { loadCheckout, verifyPayment, paymentFailed, confirmOrder, loadConfirmation, checkInvoiceStatus, downloadInvoice, loadOrderHistory, cancelOrder, returnOrder };