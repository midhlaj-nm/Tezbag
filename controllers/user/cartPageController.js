const Cart = require('../../models/cartSchema');
const Product = require('../../models/productSchema');
const mongoose = require('mongoose');
const Wishlist = require('../../models/wishlistSchema')

// Load Cart (already correct, included for reference)
const loadCart = async (req, res) => {
    try {
        if (!req.session.user) {
            return res.redirect('/');
        }
        const userId = req.session.user;

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
            return res.render('cart', {
                cart: null,
                cartItems: [],
                cartTotal: 0,
            });
        }

        const validItems = [];
        for (let item of cart.items) {
            const product = item.productId;
            if (!product) continue;

            if (!product.category || product.isBlocked || !product.category.isListed) {
                continue;
            }

            validItems.push(item);
        }

        if (validItems.length !== cart.items.length) {
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
        }

        cart = cart.toObject();

        if (!cart || !cart.items || cart.items.length === 0) {
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
            cartTotal: cart.total,
        });
    } catch (error) {
        console.error('❌ Error loading cart:', error);
        res.status(500);
    }
};

const addToCart = async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).json({ success: false, message: 'Please Login First' });
        }

        const userId = req.session.user;
        const { productId, quantity, cuttingStyle } = req.body;

        if (!mongoose.Types.ObjectId.isValid(productId)) {
            return res.status(400).json({ success: false, message: 'Invalid product ID' });
        }

        if (!quantity || quantity < 1) {
            return res.status(400).json({ success: false, message: 'Quantity must be at least 1' });
        }

        const product = await Product.findById(productId)
            .populate('category', 'name categoryOffer isListed')
            .lean();

        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        if (product.isBlocked) {
            return res.status(400).json({
                success: false,
                message: 'Product is currently unavailable',
                redirect: '/shop',
                delay: 1000
            });
        }

        if (!product.category || !product.category.isListed) {
            return res.status(400).json({
                success: false,
                message: 'Product category is currently unavailable',
                redirect: '/shop',
                delay: 1000
            });
        }

        if (product.quantity < quantity) {
            return res.status(400).json({ success: false, message: 'Insufficient stock' });
        }

        const categoryName = product.category?.name;
        const requiresCuttingStyle = categoryName === 'Meat' || categoryName === 'Fish';
        if (requiresCuttingStyle && (!cuttingStyle || cuttingStyle.trim() === '')) {
            return res.status(400).json({ success: false, message: 'Cutting style is required for this product' });
        }

        // Check if the product is in the wishlist and remove it
        const wishlist = await Wishlist.findOne({ userId });
        if (wishlist) {
            const wishlistItemIndex = wishlist.products.findIndex(item => item.productId.toString() === productId);
            if (wishlistItemIndex > -1) {
                wishlist.products.splice(wishlistItemIndex, 1);
                await wishlist.save();
            }
        }

        let cart = await Cart.findOne({ userId });
        if (!cart) {
            cart = new Cart({ userId, items: [], total: 0 });
        }

        const existingItemIndex = cart.items.findIndex(item =>
            item.productId.toString() === productId &&
            item.cuttingStyle === (cuttingStyle || null)
        );

        const existingQuantity = existingItemIndex > -1 ? cart.items[existingItemIndex].quantity : 0;
        const totalQuantity = existingQuantity + quantity;

        if (totalQuantity > 10) {
            return res.status(400).json({ success: false, message: 'Maximum quantity of 10 reached' });
        }

        if (totalQuantity > product.quantity) {
            return res.status(400).json({ success: false, message: 'Total quantity exceeds available stock' });
        }

        const productOffer = product.productOffer || 0;
        const categoryOffer = product.category?.categoryOffer || 0;
        const largestOffer = Math.max(productOffer, categoryOffer);
        const price = largestOffer > 0
            ? product.regularPrice * (1 - largestOffer / 100)
            : product.regularPrice;

        if (existingItemIndex > -1) {
            cart.items[existingItemIndex].quantity = totalQuantity;
            cart.items[existingItemIndex].price = price;
            cart.items[existingItemIndex].totalPrice = cart.items[existingItemIndex].quantity * price;
            cart.items[existingItemIndex].updatedAt = new Date();
        } else {
            cart.items.push({
                productId,
                quantity,
                price,
                totalPrice: price * quantity,
                cuttingStyle: cuttingStyle || null,
                createdAt: new Date(),
                updatedAt: new Date()
            });
        }

        cart.total = cart.items.reduce((total, item) => total + item.totalPrice, 0);

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

        if (!updatedCart || !updatedCart.items || updatedCart.items.length === 0) {
            return res.status(200).json({
                success: true,
                cartItems: [],
                cartTotal: 0
            });
        }

        for (let item of updatedCart.items) {
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

        const cartItems = updatedCart.items.map(item => ({
            ...item,
            product: {
                ...item.productId,
                image: Array.isArray(item.productId.productImage) ? item.productId.productImage[0] : item.productId.productImage || '/default-product.png'
            }
        }));

        res.status(200).json({
            success: true,
            message: 'Product added to cart successfully',
            cartItems,
            cartTotal: updatedCart.total
        });
    } catch (error) {
        console.error('Error adding to cart:', error);
        res.status(500).json({ success: false, message: 'An error occurred while adding the product to cart' });
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

module.exports = { loadCart, addToCart, increaseQuantity, decreaseQuantity, removeItem, clearCart };  