const Product = require('../../models/productSchema');
const Category = require('../../models/categorySchema');

const loadshop = async (req, res) => {
  try {
    // Extract query parameters
    const { search, category, priceRange, sort, page = 1 } = req.query;

    // Fetch listed categories
    const categories = await Category.find({ isListed: true }).lean();

    // Build the product query
    let query = { isBlocked: false };

    // Search functionality
    if (search) {
      query.productName = { $regex: search, $options: 'i' }; // Case-insensitive search
    }

    // Filter by category
    if (category) {
      query.category = category;
    }

    // Filter by price range
    if (priceRange) {
      const [minPrice, maxPrice] = priceRange.split('-').map(Number);
      if (maxPrice) {
        query.salePrice = { $gte: minPrice, $lte: maxPrice };
      } else {
        query.salePrice = { $gte: minPrice };
      }
    }

    // Pagination
    const limit = 12; // Products per page
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
      sortOption.createdAt = 1; // Default: first added, first place
    }

    // Fetch products with filters, sorting, and pagination
    const products = await Product.find(query)
      .sort(sortOption)
      .skip(skip)
      .limit(limit)
      .lean();

    // Transform products
    const transformedProducts = products.map(p => ({
      ...p,
      name: p.productName,
      image: Array.isArray(p.productImage) ? p.productImage[0] : p.productImage,
      price: p.salePrice,
      regularPrice: p.regularPrice
    }));

    // Get total product count for pagination
    const totalProducts = await Product.countDocuments(query);
    const totalPages = Math.ceil(totalProducts / limit);

    res.render('shop', {
      categories,
      products: transformedProducts,
      totalPages,
      currentPage: parseInt(page),
      searchQuery: search || '',
      selectedCategory: category || '',
      selectedPriceRange: priceRange || '',
      selectedSort: sort || ''
    });
  } catch (err) {
    console.error('❌ Error loading products:', err);
    res.status(404);
  }
};

const loadProductDetails = async (req, res) => {
  try {
    const productId = req.params.id;
    const product = await Product.findById(productId)
      .populate('category')
      .lean();

    if (!product || product.isBlocked) {
      return res.redirect('/shop');
    }

    console.log('Product:', product); // Add this log to debug
    console.log('Product Images:', product.productImage); // Add this log to debug

    res.render('products', {
      product
    });
  } catch (error) {
    console.error('❌ Error loading product details:', error);
    res.redirect('/404Error');
  }
};

module.exports = { loadshop, loadProductDetails };