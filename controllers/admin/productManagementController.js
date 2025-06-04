const Category = require('../../models/categorySchema');
const Product = require('../../models/productSchema');
const generateSKU = require('../../utils/SKUgenerator');
const User = require('../../models/userSchema');
const cloudinary = require('../../config/cloudinary');

const loadProduct = async (req, res) => {
  try {
    const limit = 6;
    const currentPage = parseInt(req.query.page) || 1;
    const search = req.query.search || '';

    const query = search
      ? { productName: { $regex: new RegExp(search, 'i') }, isBlocked: false } // Only show unblocked products
      : { isBlocked: false };

    const totalCount = await Product.countDocuments(query);
    const totalPages = Math.ceil(totalCount / limit);

    // Fetch paginated and populated products
    const products = await Product.find(query)
      .populate('category')
      .skip((currentPage - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 });

    // Fetch all listed categories (for the form)
    const categories = await Category.find({ isListed: true }).sort({ name: 1 });

    console.log(
      'Fetched Products:',
      products.map(p => ({
        productName: p.productName,
        category: p.category?.name,
        cuttingStyle: p.cuttingStyle,
      }))
    );

    res.render('products-adm', { products, categories, totalPages, search, currentPage });
  } catch (error) {
    console.error('Error loading products:', error);
    res.redirect('/404Error');
  }
};

const addProduct = async (req, res, next) => {
  try {

    // Validate image count
    const images = req.files || [];
    if (images.length < 3 || images.length > 5) {
      return res.status(400).json({
        success: false,
        message: 'Please upload between 3 and 5 images.',
      });
    }

    // Check if req.body exists
    if (!req.body) {
      return res.status(400).json({
        success: false,
        message: 'Form data is missing or malformed.',
      });
    }

    // Extract form data
    const { productName, category, price, mrp, qty, description, cutStyles } = req.body;

    // Validate required fields
    if (!productName || !category || !price || !mrp || !description || !qty) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields (productName, category, price, mrp, qty, description).',
      });
    }

    // Validate price and MRP
    const regularPrice = parseFloat(price);
    const salePrice = parseFloat(mrp);
    const quantity = parseInt(qty);

    if (isNaN(regularPrice) || regularPrice <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Price must be a positive number.',
      });
    }
    if (isNaN(salePrice) || salePrice <= 0) {
      return res.status(400).json({
        success: false,
        message: 'MRP must be a positive number.',
      });
    }
    if (regularPrice > salePrice) {
      return res.status(400).json({
        success: false,
        message: 'Price cannot be greater than MRP.',
      });
    }
    if (isNaN(quantity) || quantity < 0) {
      return res.status(400).json({
        success: false,
        message: 'Quantity must be a positive number.',
      });
    }

    // Validate category by _id
    const categoryDoc = await Category.findById(category);
    if (!categoryDoc || !categoryDoc.isListed) {
      console.log('Category not found or unlisted for ID:', category);
      return res.status(400).json({
        success: false,
        message: 'Invalid or unlisted category ID.',
      });
    }

    // Validate cutting styles if category is Meat or Fish
    let cuttingStyles = [];
    if (['Meat', 'Fish'].includes(categoryDoc.name)) {
      cuttingStyles = Array.isArray(cutStyles) ? cutStyles : cutStyles ? [cutStyles] : [];
      if (cuttingStyles.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Please select at least one cutting style or 'None' for Meat or Fish products.",
        });
      }
      if (cuttingStyles.includes('None') && cuttingStyles.length > 1) {
        return res.status(400).json({
          success: false,
          message: "If 'None' is selected, no other cutting styles should be selected.",
        });
      }
      // Optionally, validate against allowed cutting styles
      const allowedStyles =
        categoryDoc.name === 'Meat'
          ? ["None","Curry Cut","Biriyani Cut","Soup Cut","Bone Cut","Boneless Cut","Chops","Liver","Steak Cut","Heart","Keema (Minced)","Dry Fry Cut","Neck Cut","Full Chicken"]
          : ["None","Whole Fish","Sliced Cut","Steak Cut","Curry Cut","Fillet Cut","Head & Tail Removed","Butterfly Cut","Finger Cut",];
      const invalidStyles = cuttingStyles.filter(style => !allowedStyles.includes(style));
      if (invalidStyles.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid cutting styles for ${categoryDoc.name}: ${invalidStyles.join(', ')}`,
        });
      }
    }

    // Check if product already exists in the same category (case-insensitive)
    const productExists = await Product.findOne({
      productName: { $regex: new RegExp(`^${productName}$`, 'i') },
      category: categoryDoc._id, // Check duplicates within the same category
    });
    if (productExists) {
      return res.status(400).json({
        success: false,
        message: 'Product already exists in this category, please try with another name.',
      });
    }

    // Upload images to Cloudinary using upload_stream
    const resizedImages = [];
    for (let i = 0; i < images.length; i++) {
      const uploadPromise = new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            width: 440,
            height: 440,
            crop: 'fill',
            folder: 'products',
          },
          (error, result) => {
            if (error) {
              console.error('Cloudinary upload error:', error);
              return reject(error);
            }
            resolve(result.secure_url);
          }
        );
        uploadStream.end(images[i].buffer);
      });

      const secureUrl = await uploadPromise;
      resizedImages.push(secureUrl);
    }

    // Generate SKU
    const SKU = generateSKU(categoryDoc, productName);

    // Create new product
    const newProduct = new Product({
      productName,
      description,
      category: categoryDoc._id,
      regularPrice,
      salePrice,
      productImage: resizedImages,
      SKU,
      quantity,
      cuttingStyle: cuttingStyles, // Add cutting styles
      status: quantity > 0 ? 'Available' : 'Out Of Stock',
      isBlocked: false, // Ensure default value
    });

    await newProduct.save();

    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
      return res.json({ success: true, message: 'Product added successfully.' });
    } else {
      return res.redirect('/tezgrani/product-management');
    }
  } catch (err) {
    console.error('Error saving product:', err);
    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
      return res.status(500).json({
        success: false,
        message: 'Error saving product',
        error: err.message,
      });
    } else {
      return res.redirect('/404Error');
    }
  }
};

const toggleProductStatus = async (req, res) => {
  console.log('req.params:', req.params);
  console.log('req.body:', req.body);

  if (!req.params || !req.params.productId) {
    return res.status(400).json({ success: false, message: 'Product not found.' });
  }

  if (!req.body || req.body.isBlocked === undefined) {
    return res.status(400).json({ success: false, message: 'Blocking field is required.' });
  }

  const { productId } = req.params;
  const { isBlocked } = req.body;

  try {
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    product.isBlocked = isBlocked;
    await product.save();

    res.json({ success: true, product });
  } catch (error) {
    console.error('Error in toggleProductStatus:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const editProduct = async (req, res, next) => {
  try {
    const { productId } = req.params;

    // Extract form data
    const { productName, category, price, mrp, qty, description, cutStyles } = req.body;

    // Validate required fields
    if (!productName || !category || !price || !mrp || !qty || !description) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields (productName, category, price, mrp, qty, description).',
      });
    }

    // Validate price and MRP
    const regularPrice = parseFloat(price);
    const salePrice = parseFloat(mrp);
    const quantity = parseInt(qty);

    if (isNaN(regularPrice) || regularPrice <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Price must be a positive number.',
      });
    }
    if (isNaN(salePrice) || salePrice <= 0) {
      return res.status(400).json({
        success: false,
        message: 'MRP must be a positive number.',
      });
    }
    if (regularPrice > salePrice) {
      return res.status(400).json({
        success: false,
        message: 'Price cannot be greater than MRP.',
      });
    }
    if (isNaN(quantity) || quantity < 0) {
      return res.status(400).json({
        success: false,
        message: 'Quantity must be a positive number.',
      });
    }

    // Validate category by _id
    const categoryDoc = await Category.findById(category);
    if (!categoryDoc || !categoryDoc.isListed) {
      console.log('Category not found or unlisted for ID:', category);
      return res.status(400).json({
        success: false,
        message: 'Invalid or unlisted category ID.',
      });
    }

    // Validate cutting styles if category is Meat or Fish
    let cuttingStyles = [];
    if (['Meat', 'Fish'].includes(categoryDoc.name)) {
      cuttingStyles = Array.isArray(cutStyles) ? cutStyles : cutStyles ? [cutStyles] : [];
      if (cuttingStyles.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Please select at least one cutting style or 'None' for Meat or Fish products.",
        });
      }
      if (cuttingStyles.includes('None') && cuttingStyles.length > 1) {
        return res.status(400).json({
          success: false,
          message: "If 'None' is selected, no other cutting styles should be selected.",
        });
      }
      // Optionally, validate against allowed cutting styles
      const allowedStyles =
        categoryDoc.name === 'Meat'
          ? ["None","Curry Cut","Biriyani Cut","Soup Cut","Bone Cut","Boneless Cut","Chops","Liver","Steak Cut","Heart","Keema (Minced)","Dry Fry Cut","Neck Cut","Full Chicken"]
          : ["None","Whole Fish","Sliced Cut","Steak Cut","Curry Cut","Fillet Cut","Head & Tail Removed","Butterfly Cut","Finger Cut",];
      const invalidStyles = cuttingStyles.filter(style => !allowedStyles.includes(style));
      if (invalidStyles.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid cutting styles for ${categoryDoc.name}: ${invalidStyles.join(', ')}`,
        });
      }
    } else {
      // If category is not Meat or Fish, clear cutting styles
      cuttingStyles = [];
    }

    // Find the product by ID
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found.',
      });
    }

    // Check for duplicate product name if the name is being changed (case-insensitive)
    if (productName !== product.productName) {
      const productExists = await Product.findOne({
        productName: { $regex: new RegExp(`^${productName}$`, 'i') },
        category: product.category, // Check duplicates within the same category
        _id: { $ne: productId },
      });
      if (productExists) {
        return res.status(400).json({
          success: false,
          message: 'Product name already exists in this category.',
        });
      }
    }

    // Handle deleted images
    let deletedImages = [];
    if (req.body.deletedImages) {
      deletedImages = Array.isArray(req.body.deletedImages)
        ? req.body.deletedImages
        : [req.body.deletedImages];
    }

    // Remove deleted images from Cloudinary
    const existingImages = product.productImage || [];
    const updatedImages = existingImages.filter(imageUrl => !deletedImages.includes(imageUrl));

    for (const imageUrl of deletedImages) {
      const publicId = imageUrl.split('/').slice(-2).join('/').split('.')[0];
      try {
        await cloudinary.uploader.destroy(publicId);
      } catch (error) {
        console.error(`Failed to delete image from Cloudinary: ${publicId}`, error);
        // Continue despite failure to avoid blocking the update
      }
    }

    // Handle new images
    const newImages = req.files || [];
    const resizedImages = [];

    for (let i = 0; i < newImages.length; i++) {
      const uploadPromise = new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            width: 440,
            height: 440,
            crop: 'fill',
            folder: 'products',
          },
          (error, result) => {
            if (error) {
              console.error('Cloudinary upload error:', error);
              return reject(error);
            }
            resolve(result.secure_url);
          }
        );
        uploadStream.end(newImages[i].buffer);
      });

      const secureUrl = await uploadPromise;
      resizedImages.push(secureUrl);
    }

    // Combine remaining existing images with new images
    const finalImages = [...updatedImages, ...resizedImages];

    // Validate image count
    if (finalImages.length < 3 || finalImages.length > 5) {
      return res.status(400).json({
        success: false,
        message: 'Please upload between 3 and 5 images.',
      });
    }

    // Generate new SKU if product name or category has changed
    let SKU = product.SKU;
    if (productName !== product.productName || category.toString() !== product.category.toString()) {
      SKU = generateSKU(categoryDoc, productName);
    }

    // Update the product
    product.productName = productName;
    product.description = description;
    product.category = categoryDoc._id;
    product.regularPrice = regularPrice;
    product.salePrice = salePrice;
    product.quantity = quantity;
    product.productImage = finalImages;
    product.SKU = SKU;
    product.cuttingStyle = cuttingStyles; // Update cutting styles
    product.status = quantity > 0 ? 'Available' : 'Out Of Stock';

    await product.save();

    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
      return res.json({ success: true, message: 'Product updated successfully.' });
    } else {
      return res.redirect('/tezgrani/product-management');
    }
  } catch (error) {
    console.error('Error updating product:', error);
    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
      return res.status(500).json({
        success: false,
        message: 'Error updating product',
        error: error.message,
      });
    } else {
      return res.redirect('/404Error');
    }
  }
};

module.exports = { loadProduct, addProduct, toggleProductStatus, editProduct };