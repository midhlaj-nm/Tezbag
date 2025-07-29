const Cart = require('../../models/cartSchema');
const Product = require('../../models/productSchema');
const mongoose = require('mongoose');
const Wishlist = require('../../models/wishlistSchema')

const loadCart = async (req, res) => {
    try {
        if (!req.session.user) {
            console.log('User not logged in, redirecting to home.');
            return res.redirect('/');
        }
        const userId = req.session.user;
        console.log('Fetching cart for user:', userId);

        let cart = await Cart.findOne({ userId })
            .populate({
                path: 'items.productId',
                select: 'productName productImage regularPrice productOffer quantity isBlocked',
                populate: {
                    path: 'category',
                    select: 'categoryOffer isListed name'
                }
            });

        if (!cart) {
            console.log('Cart not found for user. Rendering empty cart.');
            return res.render('cart', {
                cart: null,
                cartItems: [],
                cartTotal: 0,
            });
        }
        
        console.log('Initial cart document:', cart);
        console.log('Initial cart total:', cart.total);

        const validItems = [];
        for (let item of cart.items) {
            const product = item.productId;
            if (!product) continue;

            if (!product.category || product.isBlocked || !product.category.isListed) {
                console.log(`Removing item from cart: ${product.productName}`);
                continue;
            }
            validItems.push(item);
        }

        console.log('Original number of items:', cart.items.length);
        console.log('Number of valid items:', validItems.length);

        if (validItems.length !== cart.items.length) {
            console.log('Cart needs to be updated. Removing invalid items and recalculating totals.');
            cart.items = validItems;
            for (let item of cart.items) {
                const product = item.productId;
                const productOffer = product.productOffer || 0;
                const categoryOffer = product.category?.categoryOffer || 0;
                const largestOffer = Math.max(productOffer, categoryOffer);
                const price = largestOffer > 0
                    ? product.regularPrice * (1 - largestOffer / 100)
                    : product.regularPrice;

                item.price = price;
                item.totalPrice = item.quantity * price;
            }
            cart.total = cart.items.reduce((total, item) => total + item.totalPrice, 0);
            await cart.save();
        } else {
            console.log('All items are valid. No update needed.');
        }

        const calculatedTotal = cart.items.reduce((total, item) => total + item.totalPrice, 0);
        console.log('Manually calculated cart total for rendering:', calculatedTotal);

        cart = cart.toObject();

        if (!cart || !cart.items || cart.items.length === 0) {
            console.log('Cart is now empty after validation. Rendering empty cart.');
            return res.render('cart', {
                cart: null,
                cartItems: [],
                cartTotal: 0,
            });
        }

        const cartItems = cart.items.map(item => ({
            ...item,
            product: {
                ...item.productId,
                image: Array.isArray(item.productId.productImage) ? item.productId.productImage[0] : item.productId.productImage || '/default-product.png'
            }
        }));

        res.render('cart', {
            cart,
            cartItems,
            cartTotal: calculatedTotal,
        });

    } catch (error) {
        console.error('❌ Error loading cart:', error);
        res.status(500);
    }
};


// Increase Quantity
const increaseQuantity = async (req, res) => {
    try {
        const { productId, itemId } = req.body;
        const userId = req.session.user;

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Please Login First' });
        }

        if (!mongoose.Types.ObjectId.isValid(productId) || !mongoose.Types.ObjectId.isValid(itemId)) {
            return res.status(400).json({ success: false, message: 'Invalid product' });
        }

        const cart = await Cart.findOne({ userId });
        if (!cart) {
            return res.status(404).json({ success: false, message: 'Cart not found' });
        }

        const itemIndex = cart.items.findIndex(item => item._id.toString() === itemId && item.productId.toString() === productId);
        if (itemIndex === -1) {
            return res.status(404).json({ success: false, message: 'Item not found in cart' });
        }

        const item = cart.items[itemIndex];
        if (item.quantity >= 10) {
            return res.status(400).json({ success: false, message: 'Maximum quantity reached' });
        }

        const product = await Product.findById(productId)
            .populate('category', 'categoryOffer isListed')
            .lean();
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        if (product.isBlocked || !product.category?.isListed) {
            return res.status(400).json({ success: false, message: 'Product or category is currently unavailable' });
        }

        const newQuantity = item.quantity + 1;
        if (newQuantity > product.quantity) {
            return res.status(400).json({ success: false, message: 'Insufficient stock' });
        }

        const productOffer = product.productOffer || 0;
        const categoryOffer = product.category?.categoryOffer || 0;
        const largestOffer = Math.max(productOffer, categoryOffer);
        const price = largestOffer > 0
            ? product.regularPrice * (1 - largestOffer / 100)
            : product.regularPrice;

        item.quantity = newQuantity;
        item.price = price;
        item.totalPrice = item.quantity * price;
        item.updatedAt = new Date();

        cart.total = cart.items.reduce((total, item) => total + item.totalPrice, 0);

        await cart.save();

        const cartItems = await Cart.findOne({ userId })
            .populate({
                path: 'items.productId',
                select: 'productName productImage regularPrice productOffer quantity',
                populate: {
                    path: 'category',
                    select: 'categoryOffer'
                }
            })
            .lean();

        if (!cartItems || !cartItems.items || cartItems.items.length === 0) {
            return res.status(200).json({
                success: true,
                cartItems: [],
                cartTotal: 0
            });
        }

        for (let item of cartItems.items) {
            const prod = item.productId;
            if (!prod) continue;

            const productOffer = prod.productOffer || 0;
            const categoryOffer = prod.category?.categoryOffer || 0;
            const largestOffer = Math.max(productOffer, categoryOffer);
            item.price = largestOffer > 0
                ? prod.regularPrice * (1 - largestOffer / 100)
                : prod.regularPrice;
            item.totalPrice = item.quantity * item.price;
        }

        const updatedCartItems = cartItems.items.map(item => ({
            ...item,
            product: {
                ...item.productId,
                image: Array.isArray(item.productId.productImage) ? item.productId.productImage[0] : item.productId.productImage || '/default-product.png'
            }
        }));

        res.status(200).json({
            success: true,
            cartItems: updatedCartItems,
            cartTotal: cartItems.total
        });
    } catch (error) {
        console.error('Error increasing quantity:', error);
        res.status(500).json({ success: false, message: 'An error occurred while increasing quantity' });
    }
};

// Decrease Quantity
const decreaseQuantity = async (req, res) => {
    try {
        const { productId, itemId } = req.body;
        const userId = req.session.user;

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Please Login First' });
        }

        if (!mongoose.Types.ObjectId.isValid(productId) || !mongoose.Types.ObjectId.isValid(itemId)) {
            return res.status(400).json({ success: false, message: 'Invalid product or item ID' });
        }

        const cart = await Cart.findOne({ userId });
        if (!cart) {
            return res.status(404).json({ success: false, message: 'Cart not found' });
        }

        const itemIndex = cart.items.findIndex(item => item._id.toString() === itemId && item.productId.toString() === productId);
        if (itemIndex === -1) {
            return res.status(404).json({ success: false, message: 'Item not found in cart' });
        }

        const item = cart.items[itemIndex];
        if (item.quantity <= 1) {
            cart.items.splice(itemIndex, 1);
        } else {
            const product = await Product.findById(productId)
                .populate('category', 'categoryOffer isListed')
                .lean();
            if (!product) {
                return res.status(404).json({ success: false, message: 'Product not found' });
            }

            if (product.isBlocked || !product.category?.isListed) {
                return res.status(400).json({ success: false, message: 'Product or category is currently unavailable' });
            }

            const productOffer = product.productOffer || 0;
            const categoryOffer = product.category?.categoryOffer || 0;
            const largestOffer = Math.max(productOffer, categoryOffer);
            const price = largestOffer > 0
                ? product.regularPrice * (1 - largestOffer / 100)
                : product.regularPrice;

            item.quantity -= 1;
            item.price = price;
            item.totalPrice = item.quantity * price;
            item.updatedAt = new Date();
        }

        cart.total = cart.items.reduce((total, item) => total + item.totalPrice, 0);

        await cart.save();

        const cartItems = await Cart.findOne({ userId })
            .populate({
                path: 'items.productId',
                select: 'productName productImage regularPrice productOffer quantity',
                populate: {
                    path: 'category',
                    select: 'categoryOffer'
                }
            })
            .lean();

        if (!cartItems || !cartItems.items || cartItems.items.length === 0) {
            return res.status(200).json({
                success: true,
                cartItems: [],
                cartTotal: 0
            });
        }

        for (let item of cartItems.items) {
            const prod = item.productId;
            if (!prod) continue;

            const productOffer = prod.productOffer || 0;
            const categoryOffer = prod.category?.categoryOffer || 0;
            const largestOffer = Math.max(productOffer, categoryOffer);
            item.price = largestOffer > 0
                ? prod.regularPrice * (1 - largestOffer / 100)
                : prod.regularPrice;
            item.totalPrice = item.quantity * item.price;
        }

        const updatedCartItems = cartItems.items.map(item => ({
            ...item,
            product: {
                ...item.productId,
                image: Array.isArray(item.productId.productImage) ? item.productId.productImage[0] : item.productId.productImage
            }
        }));

        res.status(200).json({
            success: true,
            cartItems: updatedCartItems,
            cartTotal: cartItems.total
        });
    } catch (error) {
        console.error('Error decreasing quantity:', error);
        res.status(500).json({ success: false, message: 'An error occurred while decreasing quantity' });
    }
};

// Remove Item
const removeItem = async (req, res) => {
    try {
        const { productId, itemId } = req.body;
        const userId = req.session.user;

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Please Login First' });
        }

        if (!mongoose.Types.ObjectId.isValid(productId) || !mongoose.Types.ObjectId.isValid(itemId)) {
            return res.status(400).json({ success: false, message: 'Invalid product or item ID' });
        }

        const cart = await Cart.findOne({ userId });
        if (!cart) {
            return res.status(404).json({ success: false, message: 'Cart not found' });
        }

        const itemIndex = cart.items.findIndex(item => item._id.toString() === itemId && item.productId.toString() === productId);
        if (itemIndex === -1) {
            return res.status(404).json({ success: false, message: 'Item not found in cart' });
        }

        cart.items.splice(itemIndex, 1);

        cart.total = cart.items.reduce((total, item) => total + item.totalPrice, 0);

        await cart.save();

        const cartItems = await Cart.findOne({ userId })
            .populate({
                path: 'items.productId',
                select: 'productName productImage regularPrice productOffer quantity',
                populate: {
                    path: 'category',
                    select: 'categoryOffer'
                }
            })
            .lean();

        if (!cartItems || !cartItems.items || cartItems.items.length === 0) {
            return res.status(200).json({
                success: true,
                cartItems: [],
                cartTotal: 0
            });
        }

        for (let item of cartItems.items) {
            const prod = item.productId;
            if (!prod) continue;

            const productOffer = prod.productOffer || 0;
            const categoryOffer = prod.category?.categoryOffer || 0;
            const largestOffer = Math.max(productOffer, categoryOffer);
            item.price = largestOffer > 0
                ? prod.regularPrice * (1 - largestOffer / 100)
                : prod.regularPrice;
            item.totalPrice = item.quantity * item.price;
        }

        const updatedCartItems = cartItems.items.map(item => ({
            ...item,
            product: {
                ...item.productId,
                image: Array.isArray(item.productId.productImage) ? item.productId.productImage[0] : item.productId.productImage || '/default-product.png'
            }
        }));

        res.status(200).json({
            success: true,
            cartItems: updatedCartItems,
            cartTotal: cartItems.total
        });
    } catch (error) {
        console.error('Error removing item:', error);
        res.status(500).json({ success: false, message: 'An error occurred while removing item' });
    }
};

const clearCart = async (req, res) => {
    try {
        const userId = req.session.user;

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Please Login First' });
        }

        const cart = await Cart.findOne({ userId });
        if (!cart || cart.items.length === 0) {
            return res.status(200).json({
                success: true,
                cartItems: [],
                cartTotal: 0
            });
        }

        cart.items = [];
        cart.total = 0;

        await cart.save();

        const updatedCart = await Cart.findOne({ userId })
            .populate({
                path: 'items.productId',
                select: 'productName productImage regularPrice productOffer quantity',
                populate: {
                    path: 'category',
                    select: 'categoryOffer'
                }
            })
            .lean();

        res.status(200).json({
            success: true,
            cartItems: updatedCart && updatedCart.items ? updatedCart.items.map(item => ({
                ...item,
                product: {
                    ...item.productId,
                    image: Array.isArray(item.productId.productImage) ? item.productId.productImage[0] : item.productId.productImage || '/default-product.png'
                }
            })) : [],
            cartTotal: updatedCart?.total || 0
        });
    } catch (error) {
        console.error('Error clearing cart:', error);
        res.status(500).json({ success: false, message: 'An error occurred while clearing cart' });
    }
};

module.exports = { loadCart, increaseQuantity, decreaseQuantity, removeItem, clearCart };  