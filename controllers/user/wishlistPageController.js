const User = require('../../models/userSchema')
const Product = require('../../models/productSchema')
const Wishlist = require('../../models/wishlistSchema')
const Cart = require('../../models/cartSchema')

const loadWishlist = async(req,res) => {
    try {
        const userId = req.session.user
        const user = await User.findById(userId)
        if(!user){
            return res.redirect('/')
        }

        const wishlist = await Wishlist.findOne({userId}).populate('products.productId')

        res.render('wishlist',{
            wishlist,
        })
    } catch (error) {
        console.log(error)
    }
}

const wishlistPrdct = async(req,res,next) => {
    try {
        const userId = req.session.user
        const {productId} = req.body
        console.log('This is user: ',userId)
        console.log('This is productId: ',productId)

        if(!userId || !productId){
            return res.status(400).json({success:false, message: 'Something went wrong'})
        }
            
        const product = await Product.findById(productId)
        console.log('This is the product: ',product)
        if(!product || product.isBlocked){
            return res.status(400).json({success: false, message: 'Product cannot be add into wishlist'})
        }

        const user = await User.findById(userId)
        console.log('This is the user: ',user)
        if(!user){
            return res.redirect('/')
        }

        const cart = await Cart.findOne({userId})
        if(cart && cart.items && cart.items.some(p => p.productId.toString() === productId)){
            return res.status(400).json({success: false, message: 'Product already available Cart'})
        }

        let wishlist = await Wishlist.findOne({userId})
        let inWishlist = false;

        if(!wishlist){
            wishlist = new Wishlist({userId, products: []})
            await wishlist.save()
        } else {
            inWishlist = wishlist.products.some(p => p.productId.toString() === productId)
        }

        if(inWishlist){
            await Wishlist.updateOne(
                {userId},
                {$pull: {products: {productId}}}
            )
            inWishlist = false
        } else {
            await Wishlist.updateOne(
                {userId},
                {$push : {products: {productId}}},
                {upsert: true}
            )
            inWishlist = true
        }

        return res.json({success:true, inWishlist, message: inWishlist ? 'Added to Wishlist' : 'Removed from Wishlist'})
    } catch (error) {
        next(error)
    }
}

module.exports = {loadWishlist, wishlistPrdct}