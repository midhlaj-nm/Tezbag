const Category = require('../../models/categorySchema');
const Product = require('../../models/productSchema');
const generateSKU = require('../../utils/SKUgenerator');
const validateCuttingStyles = require('../../utils/validateCuttingStyles');
const uploadImagesToCloudinary = require('../../utils/uploadImagesToCloudinary');

const loadProduct = async (req, res) => {
  try {
    const limit = 6;
    const currentPage = parseInt(req.query.page) || 1;
    const search = req.query.search || '';

    const query = {};
    if (search) {
      query.productName = { $regex: search, $options: 'i' };
    }

    const categories = await Category.find().lean();
    const unlistedCategoryIds = categories.filter((c) => !c.isListed).map((c) => c._id);
    if (unlistedCategoryIds.length > 0) {
      query.category = { $nin: unlistedCategoryIds };
    }

    const totalCount = await Product.countDocuments(query);
    const totalPages = Math.ceil(totalCount / limit);

    const products = await Product.find(query)
      .populate('category')
      .skip((currentPage - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 });

    products.forEach((p) => {
      p.status = p.quantity > 0 ? 'Available' : 'Out Of Stock';
    });

    const listedCategories = await Category.find({ isListed: true }).sort({ name: 1 });

    res.render('products-adm', {
      products,
      categories: listedCategories,
      totalPages,
      search,
      currentPage,
    });
  } catch (error) {
    console.error('Error loading products:', error);
    res.redirect('/404Error');
  }
};

const addProduct = async (req, res, next) => {
  try {
    const images = req.files || [];
    if (images.length < 3 || images.length > 5) {
      return res.status(400).json({
        success: false,
        message: 'Please upload between 3 and 5 images.',
      });
    }

    if (!req.body) {
      return res.status(400).json({
        success: false,
        message: 'Form data is missing or malformed.',
      });
    }

    const {
      productName, category, price, mrp, qty, description, cutStyles,
    } = req.body;

    if (!productName || !category || !price || !mrp || !description || !qty) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields.',
      });
    }

    const regularPrice = parseFloat(price);
    const salePrice = parseFloat(mrp);
    const quantity = parseInt(qty);

    if (
      isNaN(regularPrice) || regularPrice <= 0
      || isNaN(salePrice) || salePrice <= 0
      || isNaN(quantity) || quantity < 0
      || regularPrice > salePrice
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid price or quantity.',
      });
    }

    const categoryDoc = await Category.findById(category);
    if (!categoryDoc || !categoryDoc.isListed) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or unlisted category ID.',
      });
    }

    let cuttingStyles = [];
    if (['Meat', 'Fish'].includes(categoryDoc.name)) {
      try {
        cuttingStyles = validateCuttingStyles(categoryDoc, cutStyles);
      } catch (msg) {
        return res.status(400).json({ success: false, message: msg });
      }
    }

    const productExists = await Product.findOne({
      productName: { $regex: new RegExp(`^${productName}$`, 'i') },
      category: categoryDoc._id,
    });
    if (productExists) {
      return res.status(400).json({
        success: false,
        message: 'Product already exists in this category.',
      });
    }

    const resizedImages = await uploadImagesToCloudinary(images);
    const SKU = generateSKU(categoryDoc, productName);

    const newProduct = new Product({
      productName,
      description,
      category: categoryDoc._id,
      regularPrice,
      salePrice,
      productImage: resizedImages,
      SKU,
      quantity,
      cuttingStyle: cuttingStyles,
      status: quantity > 0 ? 'Available' : 'Out Of Stock',
      isBlocked: false,
    });

    await newProduct.save();

    if (req.xhr || req.headers.accept.includes('json')) {
      return res.json({ success: true, message: 'Product added successfully.' });
    }
    return res.redirect('/tezgrani/product-management');
  } catch (err) {
    console.error('Error saving product:', err);
    return req.xhr ? next(err) : res.redirect('/404Error');
  }
};

const toggleProductStatus = async (req, res, next) => {
  const { productId } = req.params;
  const { isBlocked } = req.body;

  if (!productId || isBlocked === undefined) {
    return res.status(400).json({ success: false, message: 'Missing data.' });
  }

  try {
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    product.isBlocked = isBlocked;
    await product.save();

    res.json({ success: true, product });
  } catch (error) {
    console.error('Error toggling product status:', error);
    next(error);
  }
};

const editProduct = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const {
      productName, category, price, mrp, qty, description, cutStyles,
    } = req.body;

    if (!productName || !category || !price || !mrp || !qty || !description) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields.',
      });
    }

    const regularPrice = parseFloat(price);
    const salePrice = parseFloat(mrp);
    const quantity = parseInt(qty);

    if (
      isNaN(regularPrice) || regularPrice <= 0
      || isNaN(salePrice) || salePrice <= 0
      || isNaN(quantity) || quantity < 0
      || regularPrice > salePrice
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid price or quantity.',
      });
    }

    const categoryDoc = await Category.findById(category);
    if (!categoryDoc || !categoryDoc.isListed) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or unlisted category.',
      });
    }

    let cuttingStyles = [];
    if (['Meat', 'Fish'].includes(categoryDoc.name)) {
      try {
        cuttingStyles = validateCuttingStyles(categoryDoc, cutStyles);
      } catch (msg) {
        return res.status(400).json({ success: false, message: msg });
      }
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    if (productName !== product.productName) {
      const duplicate = await Product.findOne({
        productName: { $regex: new RegExp(`^${productName}$`, 'i') },
        category: product.category,
        _id: { $ne: productId },
      });
      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: 'Product name already exists in this category.',
        });
      }
    }

    let deletedImages = req.body.deletedImages || [];
    deletedImages = Array.isArray(deletedImages) ? deletedImages : [deletedImages];

    const existingImages = product.productImage || [];
    const updatedImages = existingImages.filter((url) => !deletedImages.includes(url));

    for (const url of deletedImages) {
      const publicId = url.split('/').slice(-2).join('/').split('.')[0];
      try {
        await cloudinary.uploader.destroy(publicId);
      } catch (err) {
        console.error(`Failed to delete: ${publicId}`, err);
      }
    }

    const newImages = req.files || [];
    const uploadedImages = await uploadImagesToCloudinary(newImages);

    const finalImages = [...updatedImages, ...uploadedImages];

    if (finalImages.length < 3 || finalImages.length > 5) {
      return res.status(400).json({
        success: false,
        message: 'Please upload between 3 and 5 images.',
      });
    }

    let { SKU } = product;
    if (productName !== product.productName || category !== product.category.toString()) {
      SKU = generateSKU(categoryDoc, productName);
    }

    Object.assign(product, {
      productName,
      description,
      category: categoryDoc._id,
      regularPrice,
      salePrice,
      quantity,
      productImage: finalImages,
      SKU,
      cuttingStyle: cuttingStyles,
      status: quantity > 0 ? 'Available' : 'Out Of Stock',
    });

    await product.save();

    if (req.xhr || req.headers.accept.includes('json')) {
      return res.json({ success: true, message: 'Product updated successfully.' });
    }
    return res.redirect('/tezgrani/product-management');
  } catch (error) {
    console.error('Error editing product:', error);
    return req.xhr ? next(error) : res.redirect('/404Error');
  }
};

module.exports = {
  loadProduct,
  addProduct,
  toggleProductStatus,
  editProduct,
};
