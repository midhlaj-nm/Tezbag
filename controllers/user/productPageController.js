const Product = require('../../models/productSchema');
const Category = require('../../models/categorySchema');
const Review = require('../../models/reviewSchema');
const Deal = require('../../models/dealSchema');
const Cart = require('../../models/cartSchema')

const loadshop = async (req, res) => {
  try {
    const { search, category, priceRange, sort, page = 1 } = req.query;

    // Fetch listed categories
    const categories = await Category.find({ isListed: true }).lean();

    // Validate category if provided
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

    // Fetch active deals with offerType="Percentage" and status="Active"
    const activeDeals = await Deal.find({
      offerType: 'percentage',
      status: 'Active'
    }).lean();
    console.log('This all are the activeDeals: ', activeDeals);

    // Separate product-specific and category-specific deals
    const productDeals = activeDeals.filter(deal => deal.appliedTo === 'products').reduce((acc, deal) => {
      deal.selectedItems.forEach(itemId => {
        acc[itemId] = deal.offerPrice;
      });
      return acc;
    }, {});
    console.log('This is productDeals: ', productDeals);

    const categoryDeals = activeDeals.filter(deal => deal.appliedTo === 'category').reduce((acc, deal) => {
      deal.selectedItems.forEach(itemId => {
        acc[itemId] = deal.offerPrice;
      });
      return acc;
    }, {});
    console.log('This is categoryDeals :', categoryDeals);

    // Build the product query
    let query = { isBlocked: false };

    if (search) {
      query.productName = { $regex: search, $options: 'i' };
    }

    if (category) {
      query.category = category;
    }

    if (priceRange) {
      const [minPrice, maxPrice] = priceRange.split('-').map(Number);
      if (maxPrice) {
        query.salePrice = { $gte: minPrice, $lte: maxPrice };
      } else {
        query.salePrice = { $gte: minPrice };
      }
    }

    // Pagination
    const limit = 20;
    const skip = (page - 1) * limit;

    // Sorting
    let sortOption = {};
    if (sort === 'price-low-to-high') {
      sortOption.salePrice = 1;
    } else if (sort === 'price-high-to-low') {
      sortOption.salePrice = -1;
    } else if (sort === 'name-a-to-z') {
      sortOption.productName = 1;
    } else if (sort === 'name-z-to-a') {
      sortOption.productName = -1;
    } else {
      sortOption.createdAt = 1;
    }

    // Fetch products with filters, sorting, and pagination
    const products = await Product.find(query)
      .populate('category')
      .sort(sortOption)
      .skip(skip)
      .limit(limit)
      .lean();

    // Transform products and calculate applicable offers
    const transformedProducts = products.map(p => {
      const productOffer = productDeals[p._id.toString()] || 0;
      const categoryOffer = categoryDeals[p.category?._id.toString()] || 0;
      const largestOffer = Math.max(productOffer, categoryOffer);

      let discountPercentage = 0;
      let finalPrice = p.regularPrice; // Main price is regularPrice

      // If a deal applies, use the largest offer and update the price
      if (largestOffer > 0) {
        discountPercentage = largestOffer;
        finalPrice = p.regularPrice * (1 - largestOffer / 100);
      } else {
        // If no deal applies, calculate discount using the template's logic
        const priceDifference = p.salePrice - p.regularPrice;
        discountPercentage = p.salePrice > 0 ? Math.round((priceDifference / p.salePrice) * 100) : 0;
      }

      return {
        ...p,
        name: p.productName,
        image: Array.isArray(p.productImage) ? p.productImage[0] : p.productImage,
        price: finalPrice, // Main price (regularPrice or deal-applied price)
        regularPrice: p.regularPrice,
        salePrice: p.salePrice, // Strikethrough price
        largestOffer: largestOffer > 0 ? largestOffer : null,
        discountPercentage // Add discountPercentage field
      };
    });

    const totalProducts = await Product.countDocuments(query);
    const totalPages = Math.ceil(totalProducts / limit);

    // Fetch the user's cart to get the total
    let cartTotal = 0;
    if (req.session.user) {
      const userId = req.session.user;
      const cart = await Cart.findOne({ userId }).lean();
      if (cart) {
        cartTotal = cart.total || 0; // Use the total field from the cart schema
      }
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
      cartTotal // Pass the cart total to the template
    });
  } catch (err) {
    console.error('❌ Error loading products:', err);
    res.status(404);
  }
};

const loadProductDetails = async (req, res) => {
  try {
    const productId = req.params.id;

    // Fetch the product
    const product = await Product.findById(productId)
      .populate('category')
      .lean();

    if (!product || product.isBlocked) {
      return res.redirect('/shop');
    }

    // Fetch active deals with offerType="Percentage" and status="Active"
    const activeDeals = await Deal.find({
      offerType: 'percentage',
      status: 'Active'
    }).lean();

    // Separate product-specific and category-specific deals
    const productDeals = activeDeals.filter(deal => deal.appliedTo === 'products').reduce((acc, deal) => {
      deal.selectedItems.forEach(itemId => {
        acc[itemId] = deal.offerPrice;
      });
      return acc;
    }, {});

    const categoryDeals = activeDeals.filter(deal => deal.appliedTo === 'category').reduce((acc, deal) => {
      deal.selectedItems.forEach(itemId => {
        acc[itemId] = deal.offerPrice;
      });
      return acc;
    }, {});

    // Helper to transform product for frontend
    const transformProduct = (p) => {
      const productOffer = productDeals[p._id.toString()] || 0;
      const categoryOffer = categoryDeals[p.category?._id.toString()] || 0;
      const largestOffer = Math.max(productOffer, categoryOffer);

      let discountPercentage = 0;
      let finalPrice = p.regularPrice;
      let displaySalePrice = p.salePrice; // This will be the strikethrough price

      if (largestOffer > 0) {
        // If a deal is applied, calculate the discounted price and set salePrice to regularPrice for strikethrough
        discountPercentage = largestOffer;
        finalPrice = p.regularPrice * (1 - largestOffer / 100);
        displaySalePrice = p.regularPrice; // Use regularPrice as the strikethrough price when a deal is applied
      } else {
        // If no deal is applied, calculate discount using the template's logic
        const priceDifference = p.salePrice - p.regularPrice;
        discountPercentage = p.salePrice > 0 ? Math.round((priceDifference / p.salePrice) * 100) : 0;
        // displaySalePrice remains p.salePrice, template will decide if it should be shown as strikethrough
      }

      return {
        ...p,
        name: p.productName,
        image: Array.isArray(p.productImage) ? p.productImage[0] : p.productImage,
        price: finalPrice, // Main price after discount
        regularPrice: p.regularPrice, // Original price
        salePrice: displaySalePrice, // Strikethrough price (adjusted to regularPrice if deal applied)
        largestOffer: largestOffer > 0 ? largestOffer : null,
        discountPercentage
      };
    };

    // Transform the current product
    const transformedProduct = transformProduct(product);

    // Fetch recommended products (same category, exclude current product)
    const recommendedProducts = await Product.find({
      category: product.category?._id,
      _id: { $ne: productId },
      isBlocked: false
    })
      .limit(4)
      .lean();

    const transformedRecommendedProducts = recommendedProducts.map(transformProduct);

    // Fetch reviews associated with this product
    const reviews = await Review.find({ product: productId })
      .populate('user', 'name email')
      .lean();

    console.log('Product:', transformedProduct);
    console.log('Product Images:', transformedProduct.productImage);
    console.log('Recommended Products:', transformedRecommendedProducts);
    console.log('Reviews:', reviews);

    // Render the product page with all data
    res.render('products', {
      product: transformedProduct,
      products: transformedRecommendedProducts,
      reviews,
    });
  } catch (error) {
    console.error('❌ Error loading product details:', error);
    res.redirect('/404Error');
  }
};

module.exports = { loadshop, loadProductDetails };