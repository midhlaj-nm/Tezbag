const Category = require('../../models/categorySchema');
const slugify = require('slugify');
const cloudinary = require('cloudinary').v2;

const loadCategory = async (req, res, next) => {
  try {
    const message = req.flash('message')[0] || null;
    const messageType = req.flash('messageType')[0] || null;

    const limit = 5;
    const currentPage = parseInt(req.query.page) || 1;
    const search = req.query.search || '';

    const query = search
      ? { name: { $regex: new RegExp(search, 'i') } }
      : {};

    const totalCount = await Category.countDocuments(query);
    const totalPages = Math.ceil(totalCount / limit);

    const categories = await Category.find(query)
      .skip((currentPage - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 });

    res.render('category-adm', {
      categories,
      totalPages,
      currentPage,
      search,
      message,
      messageType,
    });
  } catch (err) {
    console.error('❌ Error in loadCategories:', err.message);
    res.render('404');
  }
};

// Add Category (with Cloudinary upload)
const addCategory = async (req, res, next) => {
  try {
    console.log('➡️ addCategory controller triggered');

    const { name, description } = req.body;
    console.log('📝 Request Body:', { name, description });

    // Validation
    if (!name || !description) {
      console.warn('⚠️ Validation failed: Missing fields');
      return res.status(400).json({ success: false, message: 'Name and description are required' });
    }
    if (name.length > 20) {
      console.warn('⚠️ Name too long');
      return res.status(400).json({ success: false, message: 'Category name must be 20 characters or less' });
    }
    if (description.length > 80) {
      console.warn('⚠️ Description too long');
      return res.status(400).json({ success: false, message: 'Description must be 80 characters or less' });
    }

    const existing = await Category.findOne({
      name: { $regex: new RegExp(`^${name}$`, 'i') },
    });

    if (existing) {
      console.warn('⚠️ Category already exists:', existing.name);
      return res.status(400).json({ success: false, message: 'Category name already exists' });
    }

    // Handle image upload to Cloudinary
    let imageUrl = '';
    let publicId = '';
    if (req.files && req.files.length > 0) {
      const file = req.files[0];
      console.log('📤 Uploading image to Cloudinary...');

      // Convert buffer to base64 for Cloudinary upload
      const b64 = Buffer.from(file.buffer).toString('base64');
      const dataURI = `data:${file.mimetype};base64,${b64}`;

      // Upload to Cloudinary
      const result = await cloudinary.uploader.upload(dataURI, {
        folder: 'categories', // Optional: Store in a specific folder in Cloudinary
        resource_type: 'image',
      });

      imageUrl = result.secure_url;
      publicId = result.public_id;
      console.log('✅ Image uploaded to Cloudinary:', { imageUrl, publicId });
    }

    // Create new category
    const newCategory = new Category({
      name,
      description,
      slug: slugify(name),
      isListed: false,
      image: imageUrl,
      publicId,
    });

    console.log('📦 Saving new category:', newCategory);
    await newCategory.save();
    console.log('✅ Category saved successfully');
    console.log('Slug for this Category', newCategory.slug);

    return res.json({ success: true, message: 'Category added successfully' });
  } catch (err) {
    console.error('❌ Error in addCategory:', err.message);
    next(err);
  }
};

// Toggle Category Status (unchanged)
const toggleCategoryStatus = async (req, res, next) => {
  try {
    console.log('🔁 toggleCategoryStatus triggered');

    const { categoryId } = req.params;
    const { isListed } = req.body;

    console.log('📥 Received data:', { categoryId, isListed });

    if (!categoryId) {
      console.warn('⚠️ No categoryId provided');
      return res.redirect('/404Error');
    }

    const updated = await Category.findByIdAndUpdate(
      categoryId,
      { isListed },
      { new: true },
    );

    if (!updated) {
      console.warn('❗ Category not found in DB');
      return res.redirect('/404Error');
    }

    console.log('✅ Category status updated successfully:', {
      id: updated._id,
      newStatus: updated.isListed,
    });

    return res.status(200).json({ success: true, message: 'Category status updated' });
  } catch (err) {
    console.error('❌ Error in toggleCategoryStatus:', err.message);
    next(err);
  }
};

// Edit Category (with Cloudinary update/delete)
const editCategory = async (req, res, next) => {
  try {
    const { name, description, isListed } = req.body;

    // Validation
    if (!name || !description) {
      return res.status(400).json({ success: false, message: 'Name and description are required' });
    }
    if (name.length > 20) {
      return res.status(400).json({ success: false, message: 'Category name must be 20 characters or less' });
    }
    if (description.length > 80) {
      return res.status(400).json({ success: false, message: 'Description must be 80 characters or less' });
    }

    const existingCategory = await Category.findOne({ name, _id: { $ne: req.params.id } });
    if (existingCategory) {
      return res.status(400).json({ success: false, message: 'Category name already exists' });
    }

    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.redirect('/404Error');
    }

    // Handle image update
    let imageUrl = category.image;
    let { publicId } = category;

    if (req.files && req.files.length > 0) {
      const file = req.files[0];
      console.log('📤 Uploading new image to Cloudinary...');

      // Delete the old image from Cloudinary if it exists
      if (category.publicId) {
        console.log('🗑️ Deleting old image from Cloudinary:', category.publicId);
        await cloudinary.uploader.destroy(category.publicId);
      }

      // Upload new image to Cloudinary
      const b64 = Buffer.from(file.buffer).toString('base64');
      const dataURI = `data:${file.mimetype};base64,${b64}`;

      const result = await cloudinary.uploader.upload(dataURI, {
        folder: 'categories',
        resource_type: 'image',
      });

      imageUrl = result.secure_url;
      publicId = result.public_id;
      console.log('✅ New image uploaded to Cloudinary:', { imageUrl, publicId });
    }

    // Update category fields
    category.name = name;
    category.description = description;
    category.isListed = isListed !== undefined ? isListed : category.isListed;
    category.slug = slugify(name);
    category.image = imageUrl;
    category.publicId = publicId;

    await category.save();

    res.json({ success: true, message: 'Category updated successfully' });
  } catch (err) {
    console.error('❌ Update category error:', err.message);
    next(err);
  }
};

module.exports = {
  loadCategory, addCategory, toggleCategoryStatus, editCategory,
};
