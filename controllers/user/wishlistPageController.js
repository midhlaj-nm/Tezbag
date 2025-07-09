const User = require('../../models/userSchema')
const Product = require('../../models/productSchema')
const Wishlist = require('../../models/wishlistSchema')
const Deal = require('../../models/dealSchema')

const loadWishlist = async (req, res) => {
    try {
        const userId = req.session.user;
        const user = await User.findById(userId);
        if (!user) return res.redirect('/');

        const wishlistDoc = await Wishlist.findOne({ userId }).populate('products.productId');
        const products = wishlistDoc?.products || [];

        if (!wishlistDoc) {
            console.log(`No wishlist found for userId: ${userId}`);
        } else if (products.length === 0) {
            console.log(`Wishlist for userId: ${userId} has no products`);
        } else {
            products.forEach(p => {
                console.log(`Raw product data:`, p);
                if (!p.productId) {
                    console.log(`Product ID missing for product in wishlist: ${p._id}`);
                } else {
                    console.log(`Populated productId: ${p.productId._id}, full product:`, p.productId);
                }
            });
        }

        const deals = await Deal.find({
            offerType: 'percentage',
            status: 'Active'
        }).lean();

        const productDeals = {};
        const categoryDeals = {};

        for (const deal of deals) {
            const target = deal.appliedTo === 'products' ? productDeals : categoryDeals;
            deal.selectedItems.forEach(id => target[id] = deal.offerPrice);
        }

        const transformProduct = (p) => {
            const productId = p.productId || {}; // Fallback if population fails
            console.log(`Transforming product:`, productId); // Debug the productId before transformation
            const productOffer = productDeals[productId._id?.toString()] || 0;
            const categoryOffer = categoryDeals[productId.category?._id?.toString()] || 0;
            const largestOffer = Math.max(productOffer, categoryOffer);
            const regularPrice = productId.regularPrice || 0;
            const salePrice = productId.salePrice || regularPrice;
            const finalPrice = largestOffer ? regularPrice * (1 - largestOffer / 100) : regularPrice;
            const discountPercentage = largestOffer || (salePrice > 0 ? Math.round(((salePrice - regularPrice) / salePrice) * 100) : 0);
            return {
                ...p,
                productId: {
                    ...productId,
                    _id: productId._id, // Explicitly preserve _id
                    price: finalPrice,
                    regularPrice: regularPrice,
                    salePrice: salePrice,
                    largestOffer: largestOffer || null,
                    discountPercentage,
                    image: Array.isArray(productId.productImage) ? productId.productImage[0] : productId.productImage || '',
                    status: productId.quantity > 0 ? 'Available' : 'Out Of Stock',
                    name: productId.productName || ''
                }
            };
        };

        const transformedProducts = products.map(transformProduct);

        // Debug the final transformed products
        console.log('Transformed products:', transformedProducts);

        res.render('wishlist', {
            wishlist: { products: transformedProducts },
        });
    } catch (error) {
        console.error('Error in loadWishlist:', error);
        res.status(404).send('Page Not Found');
    }
};

const wishlistPrdct = async (req, res, next) => {
    try {
        const userId = req.session.user
        const { productId } = req.body
        console.log('This is user: ', userId)
        console.log('This is productId: ', productId)

        if (!userId || !productId) {
            return res.status(400).json({ success: false, message: 'Something went wrong' })
        }

        const product = await Product.findById(productId)
        console.log('This is the product: ', product)
        if (!product || product.isBlocked) {
            return res.status(400).json({ success: false, message: 'Product cannot be add into wishlist' })
        }

        const user = await User.findById(userId)
        console.log('This is the user: ', user)
        if (!user) {
            return res.redirect('/')
        }

        let wishlist = await Wishlist.findOne({ userId })
        let inWishlist = false;

        if (!wishlist) {
            wishlist = new Wishlist({ userId, products: [] })
            await wishlist.save()
        } else {
            inWishlist = wishlist.products.some(p => p.productId.toString() === productId)
        }

        if (inWishlist) {
            await Wishlist.updateOne(
                { userId },
                { $pull: { products: { productId } } }
            )
            inWishlist = false
        } else {
            await Wishlist.updateOne(
                { userId },
                { $push: { products: { productId } } },
                { upsert: true }
            )
            inWishlist = true
        }

        return res.json({ success: true, inWishlist, message: inWishlist ? 'Added to Wishlist' : 'Removed from Wishlist' })
    } catch (error) {
        next(error)
    }
}

module.exports = { loadWishlist, wishlistPrdct }