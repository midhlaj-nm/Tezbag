const Category = require('../../models/categorySchema');
const slugify = require('slugify');

const loadCategory = async (req, res, next) => {
  try {
    const limit = 6;
    const currentPage = parseInt(req.query.page) || 1;
    const search = req.query.search || "";

    const query = search
      ? { name: { $regex: new RegExp(search, 'i') } }
      : {};

    const totalCount = await Category.countDocuments(query);
    const totalPages = Math.ceil(totalCount / limit);

    const categories = await Category.find(query)
      .skip((currentPage - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 });

    res.render("category-adm", {
      categories,
      totalPages,
      currentPage,
      search,
    });
  } catch (err) {
    console.error("❌ Error in loadCategories:", err.message);
    next(err);
  }
};

const addCategory = async (req, res, next) => {
  try {
    console.log("➡️ addCategory controller triggered");

    const { name, description } = req.body;
    console.log("📝 Request Body:", { name, description });

    if (!name || !description) {
      console.warn("⚠️ Validation failed: Missing fields");
      return res.status(400).json({ success: false, message: "Name and description are required" });
    }
    if (name.length > 50) {
      console.warn("⚠️ Name too long");
      return res.status(400).json({ success: false, message: "Category name must be 50 characters or less" });
    }
    if (description.length > 200) {
      console.warn("⚠️ Description too long");
      return res.status(400).json({ success: false, message: "Description must be 200 characters or less" });
    }

    const existing = await Category.findOne({
      name: { $regex: new RegExp("^" + name + "$", "i") }
    });

    if (existing) {
      console.warn("⚠️ Category already exists:", existing.name);
      return res.status(400).json({ success: false, message: "Category name already exists" });
    }

    const newCategory = new Category({
      name,
      description,
      slug: slugify(name),
      isListed: false,
    });

    console.log("📦 Saving new category:", newCategory);
    await newCategory.save();
    console.log("✅ Category saved successfully");
    console.log("Slug for this Category", newCategory.slug);

    return res.json({ success: true, message: "Category added successfully" });
  } catch (err) {
    console.error("❌ Error in addCategory:", err.message);
    const error = new Error("Failed to add category");
    error.status = 500;
    next(error);
  }
};

const toggleCategoryStatus = async (req, res, next) => {
  try {
    console.log("🔁 toggleCategoryStatus triggered");

    const { categoryId } = req.params;
    const { isListed } = req.body;

    console.log("📥 Received data:", { categoryId, isListed });

    if (!categoryId) {
      console.warn("⚠️ No categoryId provided");
      return res.redirect("/404Error");
    }

    const updated = await Category.findByIdAndUpdate(
      categoryId,
      { isListed },
      { new: true }
    );

    if (!updated) {
      console.warn("❗ Category not found in DB");
      return res.redirect("/404Error");
    }

    console.log("✅ Category status updated successfully:", {
      id: updated._id,
      newStatus: updated.isListed
    });

    return res.status(200).json({ success: true, message: "Category status updated" });
  } catch (err) {
    console.error("❌ Error in toggleCategoryStatus:", err.message);
    next(err);
  }
};

const editCategory = async (req, res, next) => {
  try {
    const { name, description, isListed } = req.body;

    if (!name || !description) {
      return res.status(400).json({ success: false, message: "Name and description are required" });
    }
    if (name.length > 10) {
      return res.status(400).json({ success: false, message: "Category name must be 10 characters or less" });
    }
    if (description.length > 80) {
      return res.status(400).json({ success: false, message: "Description must be 80 characters or less" });
    }

    const existingCategory = await Category.findOne({ name, _id: { $ne: req.params.id } });
    if (existingCategory) {
      return res.status(400).json({ success: false, message: "Category name already exists" });
    }

    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.redirect("/404Error");
    }

    category.name = name;
    category.description = description;
    category.isListed = isListed !== undefined ? isListed : category.isListed;
    category.slug = slugify(name);
    await category.save();

    res.json({ success: true, message: "Category updated successfully" });
  } catch (err) {
    console.error("❌ Update category error:", err.message);
    next(err);
  }
};

module.exports = { loadCategory, addCategory, toggleCategoryStatus, editCategory };