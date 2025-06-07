const Cart = require('../../models/cartSchema');

const loadCart = async (req, res) => {
    try {
        // Check if user is logged in
        if (!req.session.user) {
            return res.redirect('/login'); // Redirect to login if user is not authenticated
        }

        const userId = req.session.user;
        console.log('yeah!, it stored', userId)

        // Fetch the user's cart and populate product details
        let cart = await Cart.findOne({ userId })
            .populate('items.productId', 'productName productImage regularPrice salePrice')
            .lean();

        if (!cart) {
            // If no cart exists, render an empty cart
            return res.render('cart', {
                cart: null,
                cartItems: [],
                cartTotal: 0
            });
        }

        // Sort items by createdAt in descending order (-1)
        cart.items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        // Calculate cart total
        const cartTotal = cart.items.reduce((total, item) => total + item.totalPrice, 0);

        // Prepare cart items for frontend
        const cartItems = cart.items.map(item => ({
            ...item,
            product: {
                ...item.productId,
                image: Array.isArray(item.productId.productImage) ? item.productId.productImage[0] : item.productId.productImage
            }
        }));

        // Render the cart page with sorted items
        res.render('cart', {
            cart,
            cartItems,
            cartTotal
        });
    } catch (error) {
        console.error('❌ Error loading cart:', error);
        res.status(500).send('Server Error');
    }
};

module.exports = { loadCart };