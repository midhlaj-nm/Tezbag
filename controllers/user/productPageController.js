const Product = require('../../models/productSchema');
const Category = require('../../models/categorySchema');
const Review = require('../../models/reviewSchema');
const Deal = require('../../models/dealSchema');
const Cart = require('../../models/cartSchema');
const Wishlist = require('../../models/wishlistSchema');

const loadshop = async (req, res) => {
  try {
    const { search, category, priceRange, sort, page = 1 } = req.query;

    const categories = await Category.find({ isListed: true }).lean();

    if (category) {
      const selectedCategory = await Category.findOne({ _id: category, isListed: true }).lean();
      if (!selectedCategory) {
        const queryParams = { search, priceRange, sort, page };
        const filteredParams = Object.fromEntries(
          Object.entries(queryParams).filter(([_, value]) => value != null && value !== '')
        );
        const queryString = new URLSearchParams(filteredParams).toString();
        return res.redirect(`/shop${queryString ? `?${queryString}` : ''}`);
      }
    }

    const activeDeals = await Deal.find({
      offerType: 'percentage',
      status: 'Active'
    }).lean();

    const productDeals = activeDeals.filter(d => d.appliedTo === 'products').reduce((acc, d) => {
      d.selectedItems.forEach(id => acc[id] = d.offerPrice);
      return acc;
    }, {});

    const categoryDeals = activeDeals.filter(d => d.appliedTo === 'category').reduce((acc, d) => {
      d.selectedItems.forEach(id => acc[id] = d.offerPrice);
      return acc;
    }, {});

    let query = { isBlocked: false };
    if (search) query.productName = { $regex: search, $options: 'i' };
    if (category) query.category = category;

    if (priceRange) {
      let [min, max] = priceRange === '300+' ? [300, Infinity] : priceRange.split('-').map(Number);
      if (isNaN(min)) min = 0;
      if (isNaN(max)) max = Infinity;
      query.regularPrice = { $gte: min };
      if (max !== Infinity) query.regularPrice.$lte = max;
    }

    const unlistedCategoryIds = (await Category.find().lean())
      .filter(c => !c.isListed)
      .map(c => c._id);
    if (unlistedCategoryIds.length > 0) {
      query.category = query.category || {};
      query.category.$nin = unlistedCategoryIds;
    }

    const limit = 20;
    const skip = (page - 1) * limit;

    const sortOption = {
      'price-low-to-high': { regularPrice: 1 },
      'price-high-to-low': { regularPrice: -1 },
      'name-a-to-z': { productName: 1 },
      'name-z-to-a': { productName: -1 },
    }[sort] || { createdAt: 1 };

    const products = await Product.find(query)
      .populate('category')
      .sort(sortOption)
      .skip(skip)
      .limit(limit)
      .lean();

    const transformedProducts = products.map(p => {
      const productOffer = productDeals[p._id.toString()] || 0;
      const categoryOffer = categoryDeals[p.category?._id.toString()] || 0;
      const largestOffer = Math.max(productOffer, categoryOffer);
      const finalPrice = largestOffer ? p.regularPrice * (1 - largestOffer / 100) : p.regularPrice;
      const discountPercentage = largestOffer || (p.salePrice > 0 ? Math.round(((p.salePrice - p.regularPrice) / p.salePrice) * 100) : 0);
      return {
        ...p,
        name: p.productName,
        image: Array.isArray(p.productImage) ? p.productImage[0] : p.productImage,
        price: finalPrice,
        largestOffer: largestOffer || null,
        discountPercentage,
        status: p.quantity > 0 ? 'Available' : 'Out Of Stock'
      };
    });

    const totalProducts = await Product.countDocuments(query);
    const totalPages = Math.ceil(totalProducts / limit);

    let cartTotal = 0;
    let wishlist = [];
    if (req.session.user) {
      const cart = await Cart.findOne({ userId: req.session.user }).lean();
      if (cart) cartTotal = cart.total || 0;
      const wishlistDoc = await Wishlist.findOne({ userId: req.session.user }).populate('products.productId');
      if (wishlistDoc) wishlist = wishlistDoc.products.map(p => p.productId._id.toString());
    }

    res.render('shop', {
      categories,
      products: transformedProducts,
      totalPages,
      currentPage: parseInt(page),
      searchQuery: search || '',
      selectedCategory: category || '',
      selectedPriceRange: priceRange || '',
      selectedSort: sort || '',
      cartTotal,
      wishlist 
    });
  } catch (err) {
    console.error('❌ Error loading products:', err);
    res.status(404);
  }
};

const loadProductDetails = async (req, res) => {
  try {
    const productId = req.params.id;
    const product = await Product.findById(productId).populate('category').lean();
    if (!product || product.isBlocked || (product.category && !product.category.isListed)) {
      return res.redirect('/shop');
    }

    const userId = req.session.user
    if(!userId){
      return res.redirect('/')
    }

    const activeDeals = await Deal.find({
      offerType: 'percentage',
      status: 'Active'
    }).lean();

    const productDeals = activeDeals.filter(d => d.appliedTo === 'products').reduce((acc, d) => {
      d.selectedItems.forEach(id => acc[id] = d.offerPrice);
      return acc;
    }, {});

    const categoryDeals = activeDeals.filter(d => d.appliedTo === 'category').reduce((acc, d) => {
      d.selectedItems.forEach(id => acc[id] = d.offerPrice);
      return acc;
    }, {});

    const transformProduct = (p) => {
      const productOffer = productDeals[p._id.toString()] || 0;
      const categoryOffer = categoryDeals[p.category?._id.toString()] || 0;
      const largestOffer = Math.max(productOffer, categoryOffer);
      const finalPrice = largestOffer ? p.regularPrice * (1 - largestOffer / 100) : p.regularPrice;
      const discountPercentage = largestOffer || (p.salePrice > 0 ? Math.round(((p.salePrice - p.regularPrice) / p.salePrice) * 100) : 0);
      return {
        ...p,
        name: p.productName,
        image: Array.isArray(p.productImage) ? p.productImage[0] : p.productImage,
        price: finalPrice,
        salePrice: largestOffer ? p.regularPrice : p.salePrice,
        largestOffer: largestOffer || null,
        discountPercentage
      };
    };

    const transformedProduct = transformProduct(product);

    const recommendedProducts = await Product.find({
      category: product.category?._id,
      _id: { $ne: productId },
      isBlocked: false
    })
      .populate('category')
      .limit(4)
      .lean();

    const transformedRecommendedProducts = recommendedProducts.map(transformProduct);

    const reviews = await Review.find({ product: productId })
      .populate('user', 'name email')
      .lean();

    let wishlist = [];
    if (req.session.user) {
      const wishlistDoc = await Wishlist.findOne({ userId: req.session.user }).populate('products.productId');
      if (wishlistDoc) wishlist = wishlistDoc.products.map(p => p.productId._id.toString());
    }

    res.render('products', {
      product: transformedProduct,
      products: transformedRecommendedProducts,
      reviews,
      wishlist 
    });
  } catch (error) {
    console.error('❌ Error loading product details:', error);
    res.redirect('/404Error');
  }
};

module.exports = { loadshop, loadProductDetails };