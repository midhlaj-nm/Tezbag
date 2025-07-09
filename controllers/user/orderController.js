const axios = require('axios');
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

const loadCheckout = async (req, res, next) => {
  try {
    if (!req.session.user) return res.redirect('/');
    const userId = req.session.user;

    const cart = await Cart.findOne({ userId }).populate('items.productId');
    console.log(cart);
    if (!cart || !cart.items.length) return res.redirect('/shop');
    const wallet = await Wallet.findOne({ user: userId }).lean()
    console.log('This is user wallet: ',wallet)

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

const confirmOrder = async (req, res, next) => {
  try {
    const { paymentMethod, orderNotes, address, coupon, finalAmount } = req.body;
    const userId = req.session.user;
    const addressId = address._id;

    console.log('this is address id: ', addressId);

    const addrDoc = await Address.findOne({ userId }).lean();
    console.log('this is the parent address document: ', addrDoc);

    const addr = addrDoc.address.find(item => item._id.$oid === addressId || item._id.toString() === addressId);
    console.log('this is the address: ', addr);

    if (!paymentMethod || !address || !finalAmount) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const requiredFields = ['firstName', 'lastName', 'streetAddress', 'city', 'state', 'country', 'pinCode', 'landmark', 'email', 'phone'];
    const missing = requiredFields.filter(field => !address[field]);

    if (missing.length > 0) {
      return res.status(400).json({ success: false, message: 'Incomplete address information' });
    }

    if (!userId || !addressId) {
      return res.status(401).json({ success: false, message: 'User or address missing' });
    }

    const cart = await Cart.findOne({ userId }).populate('items');
    if (!cart || !cart.items.length) {
      return res.status(400).json({ success: false, message: 'Cart is empty or not found' });
    }

    const orderedItems = cart.items.map(item => ({
      productId: item.productId,
      quantity: item.quantity,
      price: item.price,
      id: item._id,
      cuttingStyle: item.cuttingStyle
    }));

    const totalPrice = orderedItems.reduce((sum, item) => sum + item.quantity * item.price, 0);
    const discount = totalPrice - parseFloat(finalAmount);

    const valid = [];
    for (const item of orderedItems) {
      const product = await Product.findById(item.productId);
      if (!product || product.quantity < item.quantity) {
        return res.status(400).json({ success: false, message: 'Some products are out of stock', redirect: '/shop', delay: 2000 });
      }
      product.quantity -= item.quantity;
      product.status = product.quantity === 0 ? 'Out Of Stock' : 'Available';
      valid.push({ ...item, product });
    }

    await Promise.all(valid.map(item => item.product.save()));

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
      couponApplied: !!coupon
    });

    await order.save();
    console.log('This is order details: ', order);
    await Cart.deleteOne({ userId });

    const invoice = await createInvoice(order, addr);
    const pdfUrl = await pdfGenerator(invoice, order);

    res.status(200).json({ success: true, message: 'Order placed successfully', orderId: order.orderId, pdfUrl });
  } catch (error) {
    console.error('Error confirming order:', error);
    next(error);
  }
};

const loadConfirmation = async (req, res) => {
  try {
    const userId = req.session.user;
    const orderId = req.params.orderId;
    console.log('This is orderId: ', orderId);
    console.log('This is the user: ', userId);

    const user = await User.findById(userId);
    if (!user) return res.redirect('/');

    const order = await Order.findOne({ orderId })
      .populate('orderedItems.productId', 'productName productImage')
      .lean();
    console.log('This is the order: ', order);

    const addrDoc = await Address.findOne({ userId: order.userId }).lean();
    console.log('Parent address document: ', addrDoc);

    const addr = addrDoc.address.find(item => item._id.$oid === order.address || item._id.toString() === order.address.toString());
    console.log('This is the correct address: ', addr);

    const billingName = `${addr.firstName} ${addr.lastName}`.trim();
    const billingAddress = `${addr.streetAddress}, ${addr.city}, ${addr.state}`;
    const billingPhone = addr.phone;
    const billingEmail = addr.email;

    const invoice = await Invoice.findOne({ orderId: order.orderId });
    console.log('This is the invoice: ', invoice);

    res.render('orderDetails', {
      order,
      orderId: order.orderId,
      billingName,
      billingAddress,
      billingPhone,
      billingEmail,
      invoiceDate: order.invoiceDate,
      paymentMethod: order.paymentMethod,
      shipping: 'Normal',
      invoicePdf: invoice.pdfUrl,
      invoiceNumber: invoice.invoiceNumber.slice(-6),
      products: order.orderedItems.map(item => ({
        name: item.productId.productName,
        image: item.productId.productImage[0],
        cuttingStyle: item.cuttingStyle || '',
        price: item.price,
        quantity: item.quantity,
      })),
      subtotal: order.totalPrice,
      discount: order.discount,
      finalAmount: order.finalAmount
    });
  } catch (error) {
    console.log(error);
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
    res.status(500).send('Error downloading invoice');
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

const cancelOrder = async (req, res, next) => {
  try {
    const orderId = req.params.orderId;
    const userId = req.session.user;
    const order = await Order.findOne({ orderId });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.status === 'Completed' || order.status === 'Delivered') {
      return res.status(400).json({ success: false, message: 'Cannot cancel a completed or delivered order' });
    }

    const refundAmount = order.finalAmount;

    for (const item of order.orderedItems) {
      const product = await Product.findById(item.productId);
      if (product) {
        product.quantity += item.quantity;
        product.status = product.quantity > 0 ? 'Available' : 'Out Of Stock';
        await product.save();
      }
    }

    order.status = 'Cancelled';
    await order.save();

    const reason = req.body.reason || 'No reason provided'; 
    console.log('This is the reason:', reason);
    const cancelRecord = new Return({
      userId: userId,
      orderId: order._id,
      delivered: false, 
      reason: reason,
      refundedAmount: refundAmount 
    });
    await cancelRecord.save();

    let wallet = await Wallet.findOne({ user: userId });
    if (!wallet) {
      wallet = new Wallet({ user: userId, balance: 0 });
    }

    if (order.paymentMethod && order.paymentMethod.toLowerCase() !== 'cod') {
      wallet.balance += refundAmount;
      wallet.transactions.push({
        type: 'credit',
        amount: refundAmount,
        reason: `Refund from Order #${orderId.slice(0, 6)}`,
        date: new Date()
      });
      await wallet.save();
    }

    res.status(200).json({ success: true, message: 'Order cancelled successfully' });
  } catch (error) {
    console.error('Error cancelling order:', error);
    next(error);
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

    const refundAmount = existingOrder.finalAmount

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

module.exports = { loadCheckout, confirmOrder, loadConfirmation, downloadInvoice, loadOrderHistory, cancelOrder, returnOrder };