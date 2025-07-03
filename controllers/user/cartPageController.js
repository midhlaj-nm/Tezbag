const Cart = require('../../models/cartSchema');
const Product = require('../../models/productSchema');
const mongoose = require('mongoose');

// Helper to calculate best price
const calculatePrice = (product) => {
  const productOffer = product.productOffer || 0;
  const categoryOffer = product.category?.categoryOffer || 0;
  const discount = Math.max(productOffer, categoryOffer);
  return discount > 0 ? product.regularPrice * (1 - discount / 100) : product.regularPrice;
};

// Helper to populate cart
const getPopulatedCart = async (userId) => {
  return await Cart.findOne({ userId })
    .populate({
      path: 'items.productId',
      select: 'productName productImage regularPrice productOffer quantity isBlocked',
      populate: {
        path: 'category',
        select: 'categoryOffer isListed name'
      }
    })
    .lean();
};

const transformCartItems = (cart) => {
  const items = cart.items || [];
  const validItems = items.filter(item => {
    const product = item.productId;
    return product && product.quantity > 0 && !product.isBlocked && product.category?.isListed;
  }).map(item => {
    const price = calculatePrice(item.productId);
    item.price = price;
    item.totalPrice = item.quantity * price;
    return item;
  });

  return {
    items: validItems.map(item => ({
      ...item,
      product: {
        ...item.productId,
        image: Array.isArray(item.productId.productImage)
          ? item.productId.productImage[0]
          : item.productId.productImage || '/default-product.png'
      }
    })),
    total: validItems.reduce((acc, item) => acc + item.totalPrice, 0)
  };
};

const loadCart = async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/');

    const cart = await getPopulatedCart(req.session.user);
    if (!cart) return res.render('cart', { cart: null, cartItems: [], cartTotal: 0 });

    const { items, total } = transformCartItems(cart);

    await Cart.updateOne({ _id: cart._id }, { items, total });

    res.render('cart', {
      cart,
      cartItems: items,
      cartTotal: total
    });
  } catch (err) {
    console.error('❌ Error loading cart:', err);
    res.status(500).send('Server Error');
  }
};

const updateCartTotals = async (userId) => {
  const cart = await getPopulatedCart(userId);
  if (!cart || !cart.items.length) return { items: [], total: 0 };

  const { items, total } = transformCartItems(cart);
  await Cart.updateOne({ userId }, { items, total });
  return { items, total };
};

const addToCart = async (req, res) => {
  try {
    const userId = req.session.user;
    const { productId, quantity, cuttingStyle } = req.body;

    if (!userId) return res.status(401).json({ success: false, message: 'Please Login First' });
    if (!mongoose.Types.ObjectId.isValid(productId)) return res.status(400).json({ success: false, message: 'Invalid product ID' });
    if (!quantity || quantity < 1) return res.status(400).json({ success: false, message: 'Quantity must be at least 1' });

    const product = await Product.findById(productId).populate('category').lean();
    if (!product || product.isBlocked || !product.category?.isListed)
      return res.status(400).json({ success: false, message: 'Product or category unavailable', redirect: '/shop', delay: 1000 });
    if (product.quantity < quantity)
      return res.status(400).json({ success: false, message: 'Insufficient stock' });

    const requiresCuttingStyle = ['Meat', 'Fish'].includes(product.category.name);
    if (requiresCuttingStyle && !cuttingStyle?.trim())
      return res.status(400).json({ success: false, message: 'Cutting style required' });

    let cart = await Cart.findOne({ userId }) || new Cart({ userId, items: [], total: 0 });
    const index = cart.items.findIndex(item => item.productId.toString() === productId && item.cuttingStyle === (cuttingStyle || null));
    const existingQty = index > -1 ? cart.items[index].quantity : 0;
    const newQty = existingQty + quantity;

    if (newQty > 10 || newQty > product.quantity)
      return res.status(400).json({ success: false, message: 'Quantity limit exceeded' });

    const price = calculatePrice(product);

    if (index > -1) {
      cart.items[index].quantity = newQty;
      cart.items[index].price = price;
      cart.items[index].totalPrice = newQty * price;
      cart.items[index].updatedAt = new Date();
    } else {
      cart.items.push({ productId, quantity, price, totalPrice: quantity * price, cuttingStyle: cuttingStyle || null, createdAt: new Date(), updatedAt: new Date() });
    }

    cart.total = cart.items.reduce((sum, item) => sum + item.totalPrice, 0);
    await cart.save();

    const updated = await updateCartTotals(userId);
    res.status(200).json({ success: true, message: 'Product added', cartItems: updated.items, cartTotal: updated.total });
  } catch (err) {
    console.error('Add to cart error:', err);
    res.status(500).json({ success: false, message: 'Error adding product' });
  }
};

const changeQuantity = async (req, res, isIncrease = true) => {
  try {
    const { productId, itemId } = req.body;
    const userId = req.session.user;

    if (!userId) return res.status(401).json({ success: false, message: 'Please Login First' });
    if (!mongoose.Types.ObjectId.isValid(productId) || !mongoose.Types.ObjectId.isValid(itemId))
      return res.status(400).json({ success: false, message: 'Invalid IDs' });

    const cart = await Cart.findOne({ userId });
    if (!cart) return res.status(404).json({ success: false, message: 'Cart not found' });

    const index = cart.items.findIndex(item => item._id.toString() === itemId && item.productId.toString() === productId);
    if (index === -1) return res.status(404).json({ success: false, message: 'Item not in cart' });

    const product = await Product.findById(productId).populate('category').lean();
    if (!product || product.isBlocked || !product.category?.isListed)
      return res.status(400).json({ success: false, message: 'Product unavailable' });

    const item = cart.items[index];
    const newQty = isIncrease ? item.quantity + 1 : item.quantity - 1;

    if (newQty > 10 || newQty > product.quantity)
      return res.status(400).json({ success: false, message: 'Quantity exceeded' });

    if (newQty < 1) {
      cart.items.splice(index, 1);
    } else {
      const price = calculatePrice(product);
      item.quantity = newQty;
      item.price = price;
      item.totalPrice = newQty * price;
      item.updatedAt = new Date();
    }

    cart.total = cart.items.reduce((sum, item) => sum + item.totalPrice, 0);
    await cart.save();

    const updated = await updateCartTotals(userId);
    res.status(200).json({ success: true, cartItems: updated.items, cartTotal: updated.total });
  } catch (err) {
    console.error('Change qty error:', err);
    res.status(500).json({ success: false, message: 'Error updating quantity' });
  }
};

const increaseQuantity = (req, res) => changeQuantity(req, res, true);
const decreaseQuantity = (req, res) => changeQuantity(req, res, false);

const removeItem = async (req, res) => {
  try {
    const { productId, itemId } = req.body;
    const userId = req.session.user;

    if (!userId) return res.status(401).json({ success: false, message: 'Please Login First' });
    if (!mongoose.Types.ObjectId.isValid(productId) || !mongoose.Types.ObjectId.isValid(itemId))
      return res.status(400).json({ success: false, message: 'Invalid IDs' });

    const cart = await Cart.findOne({ userId });
    if (!cart) return res.status(404).json({ success: false, message: 'Cart not found' });

    cart.items = cart.items.filter(item => !(item._id.toString() === itemId && item.productId.toString() === productId));
    cart.total = cart.items.reduce((sum, item) => sum + item.totalPrice, 0);
    await cart.save();

    const updated = await updateCartTotals(userId);
    res.status(200).json({ success: true, cartItems: updated.items, cartTotal: updated.total });
  } catch (err) {
    console.error('Remove item error:', err);
    res.status(500).json({ success: false, message: 'Error removing item' });
  }
};

const clearCart = async (req, res) => {
  try {
    const userId = req.session.user;
    if (!userId) return res.status(401).json({ success: false, message: 'Please Login First' });

    await Cart.updateOne({ userId }, { items: [], total: 0 });
    res.status(200).json({ success: true, cartItems: [], cartTotal: 0 });
  } catch (err) {
    console.error('Clear cart error:', err);
    res.status(500).json({ success: false, message: 'Error clearing cart' });
  }
};

module.exports = { loadCart, addToCart, increaseQuantity, decreaseQuantity, removeItem, clearCart };