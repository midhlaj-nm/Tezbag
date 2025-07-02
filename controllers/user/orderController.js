const Cart = require('../../models/cartSchema');
const User = require('../../models/userSchema');
const Deal = require('../../models/dealSchema');
const Address = require('../../models/addressSchema');
const Order = require('../../models/orderSchema');
const mongoose = require('mongoose');

const loadCheckout = async (req, res, next) => {
    try {
        // Check if user is logged in
        if (!req.session.user) {
            console.log('User not logged in, redirecting to login');
            return res.redirect('/login');
        }

        const userId = req.session.user;
        console.log('Fetching cart for userId:', userId);

        // Fetch cart and populate product details
        const cart = await Cart.findOne({ userId }).populate('items.productId');
        if (!cart || cart.items.length === 0) {
            console.log('Cart not found or empty for userId:', userId);
            return res.redirect('/shop');
        }
        console.log('Cart items:', cart.items);

        // Calculate totals
        const subtotal = cart.total;
        const shipping = 0;
        const finalTotal = subtotal + shipping;

        // Format order items with image and name
        const orderItems = cart.items.map(item => ({
            productId: item.productId._id.toString(),
            name: item.productId.productName,
            image: item.productId.productImage[0],
            quantity: item.quantity,
            price: item.price,
            total: item.totalPrice,
            cuttingStyle: item.cuttingStyle || null
        }));

        // Fetch active coupons
        const coupons = await Deal.find({
            offerType: 'coupon',
            status: 'Active',
            expireOn: { $gte: new Date() }
        }).lean();
        console.log('Fetched coupons:', coupons);

        const formattedCoupons = coupons.map(coupon => ({
            code: coupon.name,
            description: coupon.description || `Get ${coupon.offerPrice} off your order`,
            offerPrice: coupon.offerPrice,
            minPrice: coupon.minPrice,
            maxPrice: coupon.maxPrice
        }));

        // Fetch user to verify existence
        const user = await User.findById(userId);
        if (!user) {
            console.log('User not found for userId:', userId);
            return res.redirect('/login');
        }

        // Fetch and format addresses
        const savedAddresses = await Address.find({ userId }).lean();
        console.log('Fetched addresses:', savedAddresses);

        const formattedAddresses = savedAddresses.flatMap(address =>
            address.address.map(addr => ({
                _id:addr._id,
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

        // Determine default address
        const defaultAddress = formattedAddresses.find(addr => addr.isDefault) || formattedAddresses[0] || null;

        // Prepare cart details
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
        next(err)
    }
};

const confirmOrder = async (req, res, next) => {
  try {
    const { paymentMethod, orderNotes, address, coupon, finalAmount } = req.body;

    const userId = req.session.user;
    const addressId = req.body.address._id
    console.log('User Id: ',userId)
    console.log('addressId: ',addressId)
    
    if (!paymentMethod || !address || !finalAmount) {
      return res.status(400).json({ success: false, message: 'Something went wrong' });
    }
    console.log('This are the data', req.body);

    const requiredFields = ['firstName', 'lastName', 'streetAddress', 'city', 'state', 'country', 'pinCode', 'landmark', 'email', 'phone'];
    let missing = requiredFields.filter(field => !address[field]);
    if (missing.length > 0) {
      return res.status(400).json({ success: false, message: 'Address is not acceptable' });
    }

    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    if(!addressId){
        return res.status(401).json({success: false, message: 'Address is not available'})
    }

    const cart = await Cart.findOne({ userId }).populate('items');

    if (!cart || !cart.items || cart.items.length === 0) {
      return res.status(400).json({ success: false, message: 'Cart is empty or not found' });
    }

    // Map ordered items from cart, using 'price' if 'totalPrice' is unavailable
    const orderedItems = cart.items.map(item => ({
      productId: item.productId,
      quantity: item.quantity,
      price: item.price
    }));

    if (orderedItems.length === 0) {
      return res.status(400).json({ success: false, message: 'No items in cart' });
    }

    // Calculate totalPrice
    const totalPrice = orderedItems.reduce((sum, item) => sum + (item.quantity * item.price), 0);
    const discount =  totalPrice - parseFloat(finalAmount);

    const order = new Order({
      orderedItems,
      totalPrice,
      discount,
      finalAmount: parseFloat(finalAmount),
      paymentMethod,
      userId: userId,
      address: addressId,
      orderNotes: orderNotes || '',
      invoiceDate: new Date(),
      status: 'Pending',
      couponApplied: !!coupon
    });

    const newOrder = await order.save();
    console.log('New Order:', newOrder);

    await Cart.deleteOne({ userId });

    return res.status(200).json({ success: true, message: 'Order placed successfully', orderId: newOrder.orderId });
  } catch (error) {
    console.log('Internal error occurred', error);
    next(error);
  }
};

module.exports = { loadCheckout, confirmOrder };