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
      return res.redirect('/login');
    }
    const userId = req.session.user;

    let itemsToCheckout = [];
    let subtotal = 0;
    let isRetryFlow = false;
    let retryOrderData = null;
    let isCartCheckout = false;

    const { productId, quantity, cuttingStyle, retry, orderId: retryOrderIdParam } = req.query;

    if (retry === 'true' && retryOrderIdParam) {
      isRetryFlow = true;
      const orderToRetry = await Order.findOne({ orderId: retryOrderIdParam }).populate('orderedItems.productId');
      if (!orderToRetry || orderToRetry.userId.toString() !== userId.toString()) {
        return res.redirect('/shop');
      }
      if (!(orderToRetry.paymentStatus === 'Failed' || orderToRetry.paymentStatus === 'Not Paid')) {
        return res.redirect('/shop');
      }
      itemsToCheckout = orderToRetry.orderedItems.map(item => ({
        productId: item.productId,
        quantity: item.quantity,
        price: item.price,
        totalPrice: item.quantity * item.price,
        cuttingStyle: item.cuttingStyle || null
      }));
      // Check for blocked products in retry order
      const blockedProducts = itemsToCheckout.filter(item => item.productId.isBlocked);
      if (blockedProducts.length > 0) {
        return res.redirect('/shop');
      }
      subtotal = orderToRetry.totalPrice;
      retryOrderData = {
        orderId: orderToRetry.orderId,
        amount: orderToRetry.finalAmount,
        razorpayKey: process.env.RAZORPAY_KEY_ID,
        razorpayOrderId: orderToRetry.razorpayOrderId,
      };
    } else if (productId && quantity) {
      const product = await Product.findById(productId).lean();
      if (!product) {
        return res.redirect('/shop');
      }
      if (product.isBlocked) {
        return res.redirect('/shop');
      }
      const itemQuantity = parseInt(quantity);
      if (itemQuantity > product.quantity) {
        return res.status(400).json({
          success: false,
          message: 'Insufficient Stock.'
        });
      }
      const itemPrice = product.regularPrice;
      itemsToCheckout.push({
        productId: product,
        quantity: itemQuantity,
        price: itemPrice,
        totalPrice: itemPrice * itemQuantity,
        cuttingStyle: cuttingStyle || null
      });
      subtotal = itemPrice * itemQuantity;
    } else {
      isCartCheckout = true;
      const cart = await Cart.findOne({ userId }).populate('items.productId');
      if (!cart || !cart.items.length) {
        return res.redirect('/shop');
      }
      itemsToCheckout = cart.items;
      // Check for blocked products in cart
      const blockedProducts = itemsToCheckout.filter(item => item.productId.isBlocked);
      if (blockedProducts.length > 0) {
        return res.redirect('/shop');
      }
      subtotal = itemsToCheckout.reduce((acc, item) => acc + item.totalPrice, 0);
    }

    const shipping = 0;
    const finalTotal = subtotal + shipping;

    const wallet = await Wallet.findOne({ user: userId }).lean() || { balance: 0 };
    const user = await User.findById(userId).lean();
    if (!user) {
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
      retryOrderData: isRetryFlow ? retryOrderData : null,
      isCartCheckout
    });
  } catch (error) {
    return next({ status: 500, message: 'Failed to load checkout page' });
  }
};

const verifyPayment = async (req, res, next) => {
  let orderId;
  try {
    console.debug('verifyPayment: Initiated for request body:', req.body);
    const { paymentResponse, orderId: requestOrderId } = req.body;
    orderId = requestOrderId;
    console.debug('verifyPayment: Destructured orderId:', orderId, 'Payment response:', paymentResponse);

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = paymentResponse;
    console.debug('verifyPayment: Extracted payment details - order_id:', razorpay_order_id, 'payment_id:', razorpay_payment_id, 'signature:', razorpay_signature);

    const generatedSignature = crypto.createHmac('sha256', razorpay.key_secret)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');
    console.debug('verifyPayment: Generated signature:', generatedSignature);

    if (generatedSignature !== razorpay_signature) {
      console.debug('verifyPayment: Signature mismatch detected for order:', orderId, 'Generated vs Received:', generatedSignature, razorpay_signature);
      const order = await Order.findOne({ orderId: orderId }) || await Order.findById(orderId);
      console.debug('verifyPayment: Order for mismatch:', order ? 'Found' : 'Not found');
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
    console.debug('verifyPayment: Found order by ID:', orderId, 'Order existence:', !!order, 'orderedItems count:', order?.orderedItems.length);
    if (!order) {
      console.debug('verifyPayment: Order not found for ID:', orderId);
      return res.render('404');
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
    console.debug('verifyPayment: Payment verified and order saved for _id:', savedOrder._id, 'New paymentStatus:', savedOrder.paymentStatus, 'orderedItems count:', savedOrder.orderedItems.length);

    await Cart.deleteOne({ userId: order.userId });
    console.debug('verifyPayment: Cart cleared for user:', order.userId, 'Deleted cart count:', await Cart.countDocuments({ userId: order.userId }));

    setImmediate(async () => {
      try {
        console.debug('verifyPayment: Initiating async invoice generation for order _id:', order._id);
        const addrDoc = await Address.findOne({ userId: order.userId }).lean();
        console.debug('verifyPayment: Address document found:', !!addrDoc);
        const addr = addrDoc.address.find(item => item._id.toString() === order.address.toString());
        const invoice = await createInvoice(order, addr);
        const pdfUrl = await pdfGenerator(invoice, order);
        order.pdfUrl = pdfUrl;
        await order.save();
        console.debug('verifyPayment: Invoice generated and saved with PDF URL:', pdfUrl);
      } catch (err) {
        console.error('verifyPayment: Async invoice generation failed for order _id:', order._id, 'Error:', err.message, 'Stack:', err.stack);
      }
    });

    res.status(200).json({ success: true, message: 'Payment verified', orderId: order.orderId, pdfUrl: null });
    console.debug('verifyPayment: Response sent for orderId:', orderId);
  } catch (error) {
    console.error('verifyPayment: Error during verification for orderId:', orderId, 'Error:', error.message, 'Stack:', error.stack);
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
    console.debug('paymentFailed: Rendering retry page for user:', req.session.user, 'Request params:', req.params);
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
    console.debug('paymentFailed: Latest failed order found:', !!latestFailedOrder, 'Order details:', latestFailedOrder);
    if (!latestFailedOrder) {
      console.debug('paymentFailed: No failed order found for user:', userId);
      return res.redirect('/shop');
    }
    const razorpayKey = process.env.RAZORPAY_KEY_ID;
    const amount = latestFailedOrder.finalAmount;
    console.debug('paymentFailed: Retry data - Order:', latestFailedOrder._id, 'Amount:', amount, 'orderedItems count:', latestFailedOrder.orderedItems.length);

    res.render('retryPayment', {
      orderId: latestFailedOrder.orderId,
      amount,
      razorpayKey,
      razorpayOrderId: latestFailedOrder.razorpayOrderId,
      userId,
    });
    console.debug('paymentFailed: Retry page rendered for order:', latestFailedOrder._id);
  } catch (error) {
    console.error('paymentFailed: Error rendering retry page for user:', userId, 'Error:', error.message, 'Stack:', error.stack);
    return next({ status: 500, message: 'Error loading payment failure page' });
  }
};

const confirmOrder = async (req, res, next) => {
  let order = null; // Using let to allow reassignment
  let productsToUpdate = [];
  const userId = req.session.user;
  console.debug('confirmOrder: Initiated for user:', userId, 'Request body:', req.body);

  try {
    const { paymentMethod, orderNotes, addressId, coupon, finalAmount, productId, quantity, cuttingStyle, retryOrderId, isCartCheckout } = req.body;
    console.debug('confirmOrder: Parsed request data - paymentMethod:', paymentMethod, 'finalAmount:', finalAmount, 'productId:', productId, 'quantity:', quantity, 'isCartCheckout:', isCartCheckout);

    if (!addressId) {
      console.debug('confirmOrder: Missing addressId for user:', userId);
      return res.status(400).json({ success: false, message: 'Address ID is required' });
    }

    const addrDoc = await Address.findOne({ userId }).lean();
    console.debug('confirmOrder: Address document found for user:', userId, 'Document:', !!addrDoc);
    const addr = addrDoc ? addrDoc.address.find(item => item._id.toString() === addressId) : null;
    console.debug('confirmOrder: Address found for ID:', addressId, 'Existence:', !!addr, 'Address details:', addr);
    if (!addr) {
      console.debug('confirmOrder: Address not found for user:', userId, 'Address ID:', addressId);
      return res.status(400).json({ success: false, message: 'Address not found' });
    }

    if (!paymentMethod || !finalAmount) {
      console.debug('confirmOrder: Missing payment method or finalAmount for user:', userId, 'Payment method:', paymentMethod, 'Final amount:', finalAmount);
      return res.status(400).json({ success: false, message: 'Payment method and final amount are required' });
    }

    const requiredAddressFields = ['firstName', 'lastName', 'streetAddress', 'city', 'state', 'country', 'pinCode', 'landMark', 'phone'];
    const missingAddressFields = requiredAddressFields.filter(field => !addr[field]);
    if (missingAddressFields.length > 0) {
      console.debug('confirmOrder: Incomplete address information for user:', userId, 'Missing fields:', missingAddressFields.join(', '));
      return res.status(400).json({ success: false, message: 'Incomplete address information' });
    }

    if (!userId) {
      console.debug('confirmOrder: User not authenticated.');
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    let orderedItems = [];
    let totalPrice = 0;
    let isBuyNow = false;

    if (retryOrderId) {
      console.debug('confirmOrder: Processing retry flow for order:', retryOrderId);
      order = await Order.findById(retryOrderId);
      console.debug('confirmOrder: Retry order found:', !!order, 'Order userId matches session:', order?.userId.toString() === userId.toString(), 'Order details:', order);
      if (!order || order.userId.toString() !== userId.toString()) {
        console.debug('confirmOrder: Invalid or unauthorized retry order:', retryOrderId);
        return res.status(400).json({ success: false, message: 'Invalid or unauthorized retry order' });
      }
      if (order.paymentStatus === 'Paid' && order.status !== 'Payment Failed') {
        console.debug('confirmOrder: Order already paid and not in failed state, cannot retry:', retryOrderId, 'Status:', order.status);
        return res.status(400).json({ success: false, message: 'Order cannot be retried' });
      }
      orderedItems = order.orderedItems;
      totalPrice = order.totalPrice;
      console.debug('confirmOrder: Retry orderedItems:', orderedItems.map(item => ({ productId: item.productId, quantity: item.quantity })));
      if (parseFloat(finalAmount) !== order.finalAmount) {
        console.warn('confirmOrder: Amount mismatch for retry, using order finalAmount:', order.finalAmount, 'Received finalAmount:', finalAmount);
      }
      let discount = order.totalPrice - order.finalAmount;
      for (const item of orderedItems) {
        const product = await Product.findById(item.productId);
        console.debug('confirmOrder: Checking stock for product:', item.productId, 'Quantity:', product?.quantity, 'Needed:', item.quantity);
        if (!product || product.quantity < item.quantity) {
          console.debug('confirmOrder: Product out of stock for retry:', item.productId, 'Available:', product?.quantity);
          return res.status(400).json({ success: false, message: 'Product out of stock' });
        }
        product.quantity -= item.quantity;
        product.status = product.quantity === 0 ? 'Out Of Stock' : 'Available';
        productsToUpdate.push({ ...item, product });
      }
      await Promise.all(productsToUpdate.map(item => item.product.save()));
      console.debug('confirmOrder: Product quantities deducted for retry order:', retryOrderId, 'Updated products count:', productsToUpdate.length);
    } else if (productId && quantity && !isCartCheckout) {
      console.debug('confirmOrder: Processing buy now order for product:', productId, 'Quantity:', quantity);
      isBuyNow = true;
      const product = await Product.findById(productId).populate('category', 'name categoryOffer isListed');
      console.debug('confirmOrder: Buy now product found:', !!product, 'Product quantity:', product?.quantity, 'Requested quantity:', quantity, 'Product details:', product);
      if (!product || product.quantity < parseInt(quantity)) {
        console.debug('confirmOrder: Product not found or insufficient stock for buy now:', productId, 'Available:', product?.quantity);
        return res.status(400).json({
          success: false,
          message: `Insufficient Stock.Only ${product?.quantity || 0} left`,
          redirect: false
        });
      }
      const productOffer = product.productOffer || 0;
      const categoryOffer = product.category?.categoryOffer || 0;
      const largestOffer = Math.max(productOffer, categoryOffer);
      const price = largestOffer > 0 ? product.regularPrice * (1 - largestOffer / 100) : product.regularPrice;
      orderedItems.push({
        productId: product._id,
        name: product.productName,
        image: product.productImage[0],
        quantity: parseInt(quantity),
        price: price,
        total: price * parseInt(quantity),
        cuttingStyle: cuttingStyle
      });
      totalPrice = price * parseInt(quantity);
      product.quantity -= parseInt(quantity);
      product.status = product.quantity === 0 ? 'Out Of Stock' : 'Available';
      productsToUpdate.push({ productId: product._id, quantity: parseInt(quantity), product });
      await product.save();
      console.debug('confirmOrder: Product quantity deducted for buy now:', productId, 'orderedItems count:', orderedItems.length, 'Updated product:', product);
    } else if (isCartCheckout) {
      console.debug('confirmOrder: Processing cart-based order for user:', userId);
      const cart = await Cart.findOne({ userId }).populate('items.productId');
      console.debug('confirmOrder: Cart found for user:', !!cart, 'Cart items count:', cart?.items.length, 'Cart total:', cart?.total, 'Cart items:', cart?.items);
      if (!cart || !cart.items.length) {
        console.debug('confirmOrder: Cart empty or invalid for user:', userId, 'Cart:', cart);
        return res.status(400).json({ success: false, message: 'Cart is empty or invalid' });
      }
      orderedItems = cart.items.map(item => ({
        productId: item.productId._id,
        name: item.productId.productName,
        image: item.productId.productImage[0],
        quantity: item.quantity,
        price: item.price,
        total: item.totalPrice,
        cuttingStyle: item.cuttingStyle
      }));
      console.debug('confirmOrder: Mapped orderedItems from cart:', orderedItems);
      totalPrice = cart.total;
      for (const item of orderedItems) {
        const product = await Product.findById(item.productId);
        console.debug('confirmOrder: Checking cart product stock for:', item.productId, 'Quantity:', product?.quantity, 'Needed:', item.quantity);
        if (!product || product.quantity < item.quantity) {
          console.debug('confirmOrder: Product out of stock in cart:', item.productId, 'Available:', product?.quantity);
          await Promise.all(productsToUpdate.map(pItem => pItem.product.save()));
          return res.status(400).json({ success: false, message: 'Some products are out of stock' });
        }
        product.quantity -= item.quantity;
        product.status = product.quantity === 0 ? 'Out Of Stock' : 'Available';
        productsToUpdate.push({ ...item, product });
      }
      await Promise.all(productsToUpdate.map(item => item.product.save()));
      console.debug('confirmOrder: Product quantities deducted from cart for user:', userId, 'orderedItems count:', orderedItems.length, 'Updated products:', productsToUpdate.map(p => p.productId));
    } else {
      console.debug('confirmOrder: No valid order type specified for user:', userId);
      return res.status(400).json({ success: false, message: 'No valid order type specified' });
    }

    let discount = totalPrice - parseFloat(finalAmount);
    console.debug('confirmOrder: Calculated discount:', discount, 'totalPrice:', totalPrice, 'finalAmount:', finalAmount, 'Is discount valid:', discount >= 0);
    if (discount < 0 && !coupon) {
      console.warn('confirmOrder: Negative discount detected without coupon, adjusting to 0:', discount);
      discount = 0;
    }
    order = new Order({
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
    console.debug('confirmOrder: Order object before save:', order);
    await order.save();
    console.debug('confirmOrder: New order saved with _id:', order._id, 'Custom orderId:', order.orderId, 'orderedItems count:', order.orderedItems.length);

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
      console.debug('confirmOrder: UPI order initiated with Razorpay order ID:', razorpayOrder.id, 'Options:', options);
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
      console.debug('confirmOrder: User wallet found:', !!userWallet, 'Balance:', userWallet?.balance);
      if (!userWallet || userWallet.balance < parseFloat(order.finalAmount)) {
        console.debug('confirmOrder: Wallet invalid or insufficient balance for user:', userId, 'Required:', order.finalAmount, 'Available:', userWallet?.balance);
        await Promise.all(productsToUpdate.map(item => item.product.save()));
        if (!retryOrderId) await Order.deleteOne({ _id: order._id });
        return res.status(400).json({ success: false, message: 'Insufficient wallet balance' });
      }
      userWallet.balance -= parseFloat(order.finalAmount);
      userWallet.transactions.push({ type: 'debit', amount: order.finalAmount, reason: `Order payment (Order ID: ${order._id.toString().slice(0, 6)})`, date: new Date() });
      await userWallet.save();
      order.paymentStatus = 'Paid';
      await order.save();
      console.debug('confirmOrder: Wallet payment processed and order updated for _id:', order._id, 'New balance:', userWallet.balance);
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
      console.debug('confirmOrder: COD order saved with status Pending and paymentStatus Not Paid for _id:', order._id, 'Order details:', order);
      if (!isBuyNow) await Cart.deleteOne({ userId }); // Clear cart only for cart checkout
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
    console.error('confirmOrder: Error processing order for user:', userId, 'Error:', error.message, 'Stack:', error.stack);
    if (productsToUpdate.length > 0) {
      await Promise.all(productsToUpdate.map(item => {
        item.product.quantity += item.quantity;
        item.product.status = item.product.quantity > 0 ? 'Available' : 'Out Of Stock';
        return item.product.save();
      }));
      console.debug('confirmOrder: Product quantities reversed due to error for user:', userId, 'Reverted products:', productsToUpdate.map(p => p.productId));
    }
    if (order && !retryOrderId && order.paymentStatus === 'Not Paid' && order.status === 'Pending') {
      await Order.deleteOne({ _id: order._id });
      console.debug('confirmOrder: New order deleted due to error for user:', userId, 'Deleted orderId:', order?.orderId);
    } else if (order && retryOrderId) {
      order.paymentStatus = 'Failed';
      order.status = 'Payment Failed';
      await order.save();
      console.debug('confirmOrder: Retry order marked as Failed and Payment Failed due to error for _id:', retryOrderId, 'Order details:', order);
    }
    return next({ status: 500, message: 'Order processing failed' });
  }
};

const checkInvoiceStatus = async (req, res, next) => {
  try {
    const userId = req.session?.user;
    const orderId = req.params.orderId;
    if (orderId === null || orderId === undefined) {
      return res.render('404')
    }
    console.debug('checkInvoiceStatus: Checking for user:', userId, 'orderId:', orderId, 'Request params:', req.params);

    if (!userId) {
      console.debug('checkInvoiceStatus: User not authenticated or session unavailable for orderId:', orderId);
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const user = await User.findById(userId);
    console.debug('checkInvoiceStatus: User found:', !!user, 'UserId:', userId);
    if (!user) {
      console.debug('checkInvoiceStatus: User not found:', userId);
      return res.status(401).json({ error: 'User not found' });
    }

    const order = await Order.findOne({ orderId }).lean();
    console.debug('checkInvoiceStatus: Order found:', !!order, 'Order details:', order);
    if (!order) {
      console.debug('checkInvoiceStatus: Order not found for orderId:', orderId);
      return res.status(404);
    }

    const invoice = await Invoice.findOne({ orderId: order.orderId }).lean();
    console.debug('checkInvoiceStatus: Invoice found:', !!invoice, 'Invoice details:', invoice);
    const invoicePdf = invoice?.pdfUrl || order.pdfUrl || null;
    const invoiceNumber = invoice?.invoiceNumber.slice(-6) || order.orderId.slice(-6) || null;

    res.json({ success: true, invoicePdf, invoiceNumber });
    console.debug('checkInvoiceStatus: Invoice status checked for orderId:', orderId, 'pdfUrl:', invoicePdf, 'invoiceNumber:', invoiceNumber);
  } catch (error) {
    console.error('checkInvoiceStatus: Error occurred for user:', userId, 'orderId:', orderId, 'Error:', error.message, 'Stack:', error.stack);
    return next({ status: 500, message: 'Error checking invoice status' });
  }
};

const cancelOrder = async (req, res, next) => {
  const orderId = req.params.orderId;
  if (orderId === null || orderId === undefined) {
    return res.render('404')
  }
  console.debug('cancelOrder: Processing cancellation for order ID:', orderId, 'Request params:', req.params);

  try {
    const order = await Order.findOne({ orderId });
    console.debug('cancelOrder: Order found for ID:', orderId, 'Existence:', !!order, 'orderedItems count:', order?.orderedItems.length, 'Order details:', order);
    if (!order) {
      console.debug('cancelOrder: Order not found for ID:', orderId);
      return res.render('404');
    }

    if (order.paymentStatus === 'Paid') {
      if (order.status === 'Cancelled') {
        console.debug('cancelOrder: Order already cancelled for ID:', orderId);
        return res.status(200);
      }
      order.status = 'Cancelled';
      await order.save();
      let userWallet = await Wallet.findOne({ user: order.userId });
      console.debug('cancelOrder: Wallet found for user:', order.userId, 'Wallet:', !!userWallet);
      if (!userWallet) {
        userWallet = new Wallet({ user: order.userId, balance: 0 });
        console.debug('cancelOrder: New wallet created for user:', order.userId);
      }
      userWallet.balance += order.finalAmount;
      userWallet.transactions.push({ type: 'credit', amount: order.finalAmount, reason: `Refund for order ${order._id.toString().slice(0, 6)}`, date: new Date() });
      await userWallet.save();
      console.debug('cancelOrder: Refund processed and wallet updated for user:', order.userId, 'Amount:', order.finalAmount, 'New balance:', userWallet.balance);

      for (const item of order.orderedItems) {
        const product = await Product.findById(item.productId);
        if (product) {
          product.quantity += item.quantity;
          product.status = product.quantity > 0 ? 'Available' : 'Out Of Stock';
          await product.save();
          console.debug('cancelOrder: Product quantity restored for product:', product._id, 'New quantity:', product.quantity);
        }
      }
      console.debug('cancelOrder: Order cancelled and refunded for order _id:', order._id, 'Updated order:', order);
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
        console.debug('cancelOrder: Order marked as Payment Failed for _id:', order._id, 'Updated order:', order);
        res.status(200).json({ success: true, message: 'Order marked as Payment Failed.' });
      } else if (order.status === 'Pending' && order.paymentStatus === 'Failed') {
        console.debug('cancelOrder: Order already failed for ID:', orderId, 'Order details:', order);
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
        console.debug('cancelOrder: Order status updated to Request Declined for _id:', order._id, 'Updated order:', order);
        res.status(200).json({ success: true, message: 'Order status updated.' });
      }
    } else {
      console.debug('cancelOrder: Invalid order state for cancellation for ID:', orderId, 'Status:', order.status, 'Payment Status:', order.paymentStatus);
      return res.status(400);
    }
  } catch (error) {
    console.error('cancelOrder: Error during cancellation for orderId:', orderId, 'Error:', error.message, 'Stack:', error.stack);
    return next({ status: 500, message: 'Failed to process order cancellation' });
  }
};

const loadConfirmation = async (req, res, next) => {
  try {
    const userId = req.session.user;
    console.debug('loadConfirmation: Loading for user:', userId, 'Request params:', req.params);
    if (!userId) {
      console.debug('loadConfirmation: User session not found, redirecting to login.');
      return res.redirect('/login');
    }
    const orderId = req.params.orderId;
    if (orderId === null || orderId === undefined) {
      return res.render('404');
    }
    console.debug('loadConfirmation: OrderId from params:', orderId);

    const user = await User.findById(userId);
    console.debug('loadConfirmation: User found:', !!user, 'User details:', user);
    if (!user) {
      console.debug('loadConfirmation: User not found:', userId);
      return res.redirect('/login');
    }

    const order = await Order.findOne({ orderId: orderId }).populate('orderedItems.productId', 'productName productImage').lean();
    console.debug('loadConfirmation: Order found by custom orderId:', !!order, 'for orderId:', orderId, 'orderedItems count:', order?.orderedItems.length, 'Order details:', order);
    if (!order) {
      console.debug('loadConfirmation: Order not found for custom orderId:', orderId);
      return res.render('404');
    }

    const addrDoc = await Address.findOne({ userId: order.userId }).lean();
    console.debug('loadConfirmation: Address document found:', !!addrDoc, 'for user:', order.userId, 'Document:', addrDoc);
    if (!addrDoc || !addrDoc.address) {
      console.debug('loadConfirmation: Address not found or empty for user:', order.userId);
      return res.status(400).json({ message: 'Address information missing' });
    }
    const addr = addrDoc.address.find(item => item._id.toString() === order.address.toString());
    console.debug('loadConfirmation: Delivery address found for order:', order.orderId, 'Existence:', !!addr, 'Address:', addr);

    if (!addr) {
      console.debug('loadConfirmation: Delivery address not found within document for order:', orderId);
      return res.status(400).json({ message: 'Delivery address not found for the order' });
    }

    const billingName = `${addr.firstName} ${addr.lastName}`.trim();
    const billingAddress = `${addr.streetAddress}, ${addr.city}, ${addr.state}`;
    const invoice = await Invoice.findOne({ orderId: order.orderId });
    console.debug('loadConfirmation: Invoice found for order:', order.orderId, 'Existence:', !!invoice, 'Invoice details:', invoice);

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
      finalAmount: order.finalAmount,
      razorpayKey: process.env.RAZORPAY_KEY_ID, // Ensure this is set in .env
      razorpayOrderId: order.razorpayOrderId || '', // Fallback if not present
      createdAt: order.invoiceDate // Ensure createdAt is passed
    });
    console.debug('loadConfirmation: Confirmation page rendered for orderId:', order.orderId, 'Rendered data:', { subtotal: order.totalPrice, discount: order.discount, finalAmount: order.finalAmount });
  } catch (error) {
    console.error('loadConfirmation: Unhandled error in confirmation page:', error.message, 'Stack:', error.stack);
    return next({ status: 500, message: 'Failed to load order confirmation' });
  }
};

const downloadInvoice = async (req, res, next) => {
  try {
    const pdfUrl = decodeURIComponent(req.query.url);
    console.debug('downloadInvoice: Downloading from url:', pdfUrl, 'Query params:', req.query);
    const response = await axios({ url: pdfUrl, method: 'GET', responseType: 'stream' });
    const filename = req.query.filename || 'invoice.pdf';
    console.debug('downloadInvoice: Setting headers for file:', filename);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    response.data.pipe(res);
    console.debug('downloadInvoice: Download initiated for file:', filename, 'Response stream started');
  } catch (error) {
    console.error('downloadInvoice: Download failed for url:', pdfUrl, 'Error:', error.message, 'Stack:', error.stack);
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
    console.debug('loadOrderHistory: Loading for user:', userId, 'Query params:', req.query);
    const searchQuery = req.query.query || '';
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    console.debug('loadOrderHistory: Pagination - Page:', page, 'Limit:', limit, 'Search query:', searchQuery);

    const cart = await Cart.findOne({ userId }).select('total');
    console.debug('loadOrderHistory: Cart found:', !!cart, 'Cart total:', cart?.total);
    const cartTotal = cart ? `${cart.total.toFixed(2)}₹` : '0.00₹';

    const allOrders = await Order.find({ userId }).populate('orderedItems.productId', 'productName').sort({ invoiceDate: -1 });
    console.debug('loadOrderHistory: Total orders retrieved:', allOrders.length);
    const orders = searchQuery
      ? allOrders.filter(x => x.orderId.match(new RegExp(searchQuery, 'i')) || x.status.match(new RegExp(searchQuery, 'i')) || x.orderedItems.some(item => item.productId?.productName?.match(new RegExp(searchQuery, 'i'))))
      : allOrders;
    const totalOrders = orders.length;
    const totalPages = Math.ceil(totalOrders / limit);
    const skip = (page - 1) * limit;
    const paginationOrders = orders.slice(skip, skip + limit);
    console.debug('loadOrderHistory: Paginated orders count:', paginationOrders.length, 'Total pages:', totalPages);

    res.render('orderHistory', { searchQuery, orders: paginationOrders, currentPage: page, totalPages, cartTotal });
    console.debug('loadOrderHistory: History page rendered for user:', userId, 'page:', page, 'Orders count:', paginationOrders.length);
  } catch (error) {
    console.error('loadOrderHistory: Error occurred for user:', userId, 'Error:', error.message, 'Stack:', error.stack);
    return next({ status: 500, message: 'Error loading order history' });
  }
};

const returnOrder = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    if (orderId === null || orderId === undefined) {
      return res.render('404')
    }
    const { reason } = req.body;
    const userId = req.session.user;
    console.debug('returnOrder: Processing return for orderId:', orderId, 'user:', userId, 'Request body:', req.body);

    if (!orderId || !userId) {
      console.debug('returnOrder: Missing orderId or userId for request:', { orderId, userId });
      return res.status(400);
    }

    const order = await Order.findOne({ orderId });
    console.debug('returnOrder: Order found:', !!order, 'Order details:', order);
    if (!order) {
      console.debug('returnOrder: Order not found for orderId:', orderId);
      return res.render('404');
    }

    const returnRequest = new Return({ userId, orderId: order._id, delivered: true, reason, refundedAmount: order.finalAmount });
    await returnRequest.save();
    console.debug('returnOrder: Return request saved with _id:', returnRequest._id);
    await Order.findByIdAndUpdate(order._id, { status: 'Return Requested' }, { new: true });
    console.debug('returnOrder: Order status updated to Return Requested for _id:', order._id);

    res.status(200).json({ success: true, message: 'Return request sent' });
    console.debug('returnOrder: Return request processed for orderId:', orderId, 'Return request:', returnRequest);
  } catch (error) {
    console.error('returnOrder: Error occurred for orderId:', orderId, 'user:', userId, 'Error:', error.message, 'Stack:', error.stack);
    return next({ status: 500, message: 'Failed to process return' });
  }
};

module.exports = { loadCheckout, verifyPayment, paymentFailed, confirmOrder, loadConfirmation, checkInvoiceStatus, downloadInvoice, loadOrderHistory, cancelOrder, returnOrder };