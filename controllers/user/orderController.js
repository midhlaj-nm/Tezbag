const Cart = require('../../models/cartSchema');
const Product = require('../../models/productSchema');
const User = require('../../models/userSchema');
const Deal = require('../../models/dealSchema');
const Address = require('../../models/addressSchema');
const Order = require('../../models/orderSchema');

const loadCheckout = async (req, res, next) => {
  try {
    if (!req.session.user) return res.redirect('/login');
    const userId = req.session.user;

    const cart = await Cart.findOne({ userId }).populate('items.productId');
    if (!cart || !cart.items.length) return res.redirect('/shop');

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
    if (!user) return res.redirect('/login');

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

    console.log('this is address id: ',addressId)

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
    console.log('This is order details: ',order)
    await Cart.deleteOne({ userId });

    res.status(200).json({ success: true, message: 'Order placed successfully', orderId: order._id });
  } catch (error) {
    console.error('Error confirming order:', error);
    next(error);
  }
};

const loadConfirmation = async(req,res) => {
  try {
    const orderId = req.params.orderId
    console.log('This is orderId: ',orderId)

    const order = await Order.findById(orderId)
      .populate('orderedItems.productId','productName productImage')
      .lean()
    console.log('This is the order: ',order)

    const addrDoc = await Address.findOne({userId: order.userId}).lean()
    console.log('Parent address document: ',addrDoc)

    const addr = addrDoc.address.find(item => item._id.$oid === order.address || item._id.toString() === order.address.toString())
    console.log('This is the correct address: ',addr)

    const billingName = `${addr.firstName} ${addr.lastName}`.trim()
    const billingAddress = `${addr.streetAddress}, ${addr.city}, ${addr.state}`
    const billingPhone = addr.phone
    const billingEmail = addr.email

    res.render('orderDetails', {
      orderId: order.orderId,
      billingName: billingName,
      billingAddress: billingAddress,
      billingPhone: billingPhone,
      billingEmail: billingEmail,
      invoiceDate: order.invoiceDate,
      paymentMethod: order.paymentMethod,
      shipping: 'Normal',
      products: order.orderedItems.map(item => ({
        name: item.productId.productName,
        image: item.productId.productImage,
        cuttingStyle: item.cuttingStyle || '',
      }))
    })
  } catch (error) {
    console.log(error)
    res.status(404)
  }
}

module.exports = { loadCheckout, confirmOrder, loadConfirmation };