const Deal = require('../models/dealSchema');
const Product = require('../models/productSchema');
const Category = require('../models/categorySchema');

// Update offers for a list of products
const updateProductOffers = async (productIds) => {
    const products = await Product.find({ _id: { $in: productIds } });
    const currentDate = new Date();
    const currentISTOffset = 5.5 * 60;
    currentDate.setMinutes(currentDate.getMinutes() + currentDate.getTimezoneOffset() + currentISTOffset);
    currentDate.setHours(0, 0, 0, 0);

    for (let product of products) {
        // Find all active deals for this product
        const directDeals = await Deal.find({
            _id: { $in: product.activeDealIds },
            offerType: 'percentage',
            appliedTo: 'products',
            createdOn: { $lte: currentDate },
            expireOn: { $gte: currentDate },
            status: 'Active'
        }).lean();

        // Find all active deals for this product's category
        const categoryDeals = await Deal.find({
            offerType: 'percentage',
            appliedTo: 'category',
            selectedItems: product.category,
            createdOn: { $lte: currentDate },
            expireOn: { $gte: currentDate },
            status: 'Active'
        }).lean();

        // Combine all applicable deals
        const allDeals = [...directDeals, ...categoryDeals];
        const largestOffer = allDeals.length > 0
            ? Math.max(...allDeals.map(deal => deal.offerPrice))
            : 0;

        // Update productOffer
        product.productOffer = largestOffer;
        await product.save();
    }
};

// Update offers for a list of categories
const updateCategoryOffers = async (categoryIds) => {
    const categories = await Category.find({ _id: { $in: categoryIds } });
    const currentDate = new Date();
    const currentISTOffset = 5.5 * 60;
    currentDate.setMinutes(currentDate.getMinutes() + currentDate.getTimezoneOffset() + currentISTOffset);
    currentDate.setHours(0, 0, 0, 0);

    for (let category of categories) {
        // Find all active deals for this category
        const deals = await Deal.find({
            _id: { $in: category.activeDealIds },
            offerType: 'percentage',
            appliedTo: 'category',
            createdOn: { $lte: currentDate },
            expireOn: { $gte: currentDate },
            status: 'Active'
        }).lean();

        const largestOffer = deals.length > 0
            ? Math.max(...deals.map(deal => deal.offerPrice))
            : 0;

        // Update categoryOffer
        category.categoryOffer = largestOffer;
        await category.save();

        // Update all products in this category
        await updateProductOffers(await Product.find({ category: category._id }).distinct('_id'));
    }
};

module.exports = { updateProductOffers, updateCategoryOffers };