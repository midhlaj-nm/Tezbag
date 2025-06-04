const Deal = require('../../models/dealSchema');
const Product = require('../../models/productSchema');
const Category = require('../../models/categorySchema');
const mongoose = require('mongoose');

const loadDeals = async (req, res) => {
  try {
    // Check admin authentication
    if (!req.session.admin) {
      return res.redirect('/tezgrani/login');
    }

    // Pagination and search parameters
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';

    // Build query for deals
    const dealQuery = search.trim() ? { name: { $regex: search, $options: 'i' } } : {};

    // Fetch deals with pagination and search
    const deals = await Deal.find(dealQuery)
        .sort({ createdAt: -1 }) // Sort by createdOn in descending order (newest first)
        .skip(skip)
        .limit(limit)
        .lean();

    // Populate selectedItems based on appliedTo
    for (let deal of deals) {
      if (deal.appliedTo === 'category') {
        deal.selectedItems = await Category.find(
          { _id: { $in: deal.selectedItems || [] } },
          '_id name'
        ).lean();
      } else if (deal.appliedTo === 'products') {
        deal.selectedItems = await Product.find(
          { _id: { $in: deal.selectedItems || [] } },
          '_id productName'
        ).lean();
      }
    }

    // Calculate total pages
    const totalDeals = await Deal.countDocuments(dealQuery);
    const totalPages = Math.ceil(totalDeals / limit);

    // Fetch categories and products for checkbox menus
    const categories = await Category.find({}, '_id name').lean();
    const products = await Product.find({}, '_id productName').lean();

    // Render the deals page
    res.render('deals-adm', {
      deals,
      categories,
      products,
      currentPage: page,
      totalPages,
      search,
    });
  } catch (error) {
    console.error('❌ Error loading deals page:', error);
    res.status(500).json({ success: false, message: 'Failed to load deals page' });
  }
};

const saveDeals = async (req, res) => {
  try {
    // Check admin authentication
    if (!req.session.admin) {
      return res.status(401).json({ success: false, message: 'Unauthorized access' });
    }

    const { offerName, couponName, selectedType, discountPercentage, discountValue, startDate, endDate, selectedItems, minPurchase, maxPurchase } = req.body;
    const offerType = offerName ? 'percentage' : couponName ? 'coupon' : null;
    if (!offerType) {
      return res.status(400).json({ success: false, message: 'Cannot determine offer type' });
    }

    // Determine the deal name based on offer type
    const dealName = offerType === 'percentage' ? offerName : couponName;
    if (!dealName || dealName.trim() === '') {
      return res.status(400).json({ success: false, message: 'Deal name is required' });
    }

    // Check for duplicate deal name (case-insensitive)
    const existingDeal = await Deal.findOne({
      name: { $regex: `^${dealName.trim()}$`, $options: 'i' },
    });
    if (existingDeal) {
      return res.status(400).json({ success: false, message: 'This name already exists' });
    }

    // Normalize dates to IST
    const currentDate = new Date();
    const currentISTOffset = 5.5 * 60; // IST offset in minutes (UTC+5:30)
    currentDate.setMinutes(currentDate.getMinutes() + currentDate.getTimezoneOffset() + currentISTOffset);
    currentDate.setHours(0, 0, 0, 0);

    let newDeal = {};
    let status = 'Scheduled';

    // Parse startDate and endDate, assuming they come as YYYY-MM-DD in browser's local timezone (likely IST)
    const start = new Date(startDate + 'T00:00:00+05:30'); // Explicitly set to IST
    const end = new Date(endDate + 'T23:59:59+05:30'); // End of the day in IST

    // Validate dates
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format' });
    }
    if (start < currentDate) {
      return res.status(400).json({ success: false, message: 'Start date cannot be in the past' });
    }
    if (end < start) {
      return res.status(400).json({ success: false, message: 'End date must be after start date' });
    }

    // Determine status based on IST dates
    if (start <= currentDate && end >= currentDate) status = 'Active';
    else if (end < currentDate) status = 'Expired';

    if (offerType === 'percentage') {
      // Validate required fields
      if (!offerName || !selectedType || !discountPercentage || !selectedItems) {
        return res.status(400).json({ success: false, message: 'All fields are required for percentage offer' });
      }

      // Validate selectedItems
      const itemsArray = Array.isArray(selectedItems) ? selectedItems : [selectedItems];
      if (!itemsArray.length) {
        return res.status(400).json({ success: false, message: 'At least one item must be selected' });
      }

      // Validate that all selectedItems are valid ObjectIds
      const invalidIds = itemsArray.filter(id => !mongoose.Types.ObjectId.isValid(id));
      if (invalidIds.length) {
        return res.status(400).json({ success: false, message: `Invalid item IDs: ${invalidIds.join(', ')}` });
      }

      // Validate discount percentage
      const discount = parseFloat(discountPercentage);
      if (isNaN(discount) || discount <= 0 || discount > 100) {
        return res.status(400).json({ success: false, message: 'Discount percentage must be between 0 and 100' });
      }

      // Validate selected items exist in the database
      const validItems = await (selectedType === 'category' ? Category : Product)
        .find({ _id: { $in: itemsArray } })
        .select('_id')
        .lean();
      if (validItems.length !== itemsArray.length) {
        return res.status(400).json({ success: false, message: 'One or more selected items are invalid' });
      }

      newDeal = new Deal({
        name: offerName.trim(),
        offerType: 'percentage',
        offerPrice: discount,
        createdOn: start,
        expireOn: end,
        appliedTo: selectedType,
        selectedItems: itemsArray,
        status,
        isListed: true,
      });
    } else if (offerType === 'coupon') {
      // Validate required fields
      if (!couponName || !discountValue || !minPurchase || !maxPurchase) {
        return res.status(400).json({ success: false, message: 'All fields are required for coupon offer' });
      }

      // Validate discount value
      const discount = parseFloat(discountValue);
      if (isNaN(discount) || discount <= 0) {
        return res.status(400).json({ success: false, message: 'Discount value must be greater than 0' });
      }

      // Validate purchase amounts
      const min = parseFloat(minPurchase);
      const max = parseFloat(maxPurchase);
      if (isNaN(min) || min < 0 || isNaN(max) || max < 0 || max < min) {
        return res.status(400).json({ success: false, message: 'Invalid purchase amounts' });
      }

      newDeal = new Deal({
        name: couponName.trim(),
        offerType: 'coupon',
        offerPrice: discount,
        createdOn: start,
        expireOn: end,
        minPrice: min,
        maxPrice: max,
        appliedTo: undefined, // Not applicable for coupon offers
        selectedItems: undefined, // Not applicable for coupon offers
        status,
        isListed: true,
      });
    }

    await newDeal.save();
    res.status(200).json({ success: true, message: 'Deal saved successfully' });
  } catch (error) {
    console.error('❌ Error saving deal:', error);
    res.status(500).json({ success: false, message: 'Failed to save deal' });
  }
};

const editDeals = async (req, res) => {
  try {
    // Check admin authentication
    if (!req.session.admin) {
      return res.status(401).json({ success: false, message: 'Unauthorized access' });
    }

    const { dealId } = req.params;
    const deal = await Deal.findById(dealId);
    if (!deal) {
      return res.status(404).json({ success: false, message: 'Deal not found' });
    }

    const { offerName, couponName, selectedType, discountPercentage, discountValue, startDate, endDate, selectedItems, minPurchase, maxPurchase } = req.body;
    const offerType = req.body.offerType || deal.offerType;

    // Determine the deal name based on offer type
    const dealName = offerType === 'percentage' ? offerName : couponName;
    if (!dealName || dealName.trim() === '') {
      return res.status(400).json({ success: false, message: 'Deal name is required' });
    }

    // Check for duplicate deal name (case-insensitive), excluding the current deal
    const existingDeal = await Deal.findOne({
      name: { $regex: `^${dealName.trim()}$`, $options: 'i' },
      _id: { $ne: dealId }, // Exclude the current deal
    });
    if (existingDeal) {
      return res.status(400).json({ success: false, message: 'A deal with this name already exists' });
    }

    // Normalize dates to IST
    const currentDate = new Date();
    const currentISTOffset = 5.5 * 60; // IST offset in minutes (UTC+5:30)
    currentDate.setMinutes(currentDate.getMinutes() + currentDate.getTimezoneOffset() + currentISTOffset);
    currentDate.setHours(0, 0, 0, 0);

    let status = deal.status; // Preserve existing status by default

    // Parse startDate and endDate
    const start = new Date(startDate + 'T00:00:00+05:30'); // Explicitly set to IST
    const end = new Date(endDate + 'T23:59:59+05:30'); // End of the day in IST

    // Validate dates
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format' });
    }
    // Allow past dates for editing existing deals, but validate end date
    if (end < start) {
      return res.status(400).json({ success: false, message: 'End date must be after start date' });
    }

    // Update status only if dates have changed
    if (start.getTime() !== deal.createdOn.getTime() || end.getTime() !== deal.expireOn.getTime()) {
      if (start <= currentDate && end >= currentDate) status = 'Active';
      else if (end < currentDate) status = 'Expired';
      else status = 'Scheduled';
    }

    if (offerType === 'percentage') {
      // Validate required fields
      if (!offerName || !selectedType || !discountPercentage || !selectedItems) {
        return res.status(400).json({ success: false, message: 'All fields are required for percentage offer' });
      }

      // Validate selectedItems
      const itemsArray = Array.isArray(selectedItems) ? selectedItems : [selectedItems];
      if (!itemsArray.length) {
        return res.status(400).json({ success: false, message: 'At least one item must be selected' });
      }

      // Validate that all selectedItems are valid ObjectIds
      const invalidIds = itemsArray.filter(id => !mongoose.Types.ObjectId.isValid(id));
      if (invalidIds.length) {
        return res.status(400).json({ success: false, message: `Invalid item IDs: ${invalidIds.join(', ')}` });
      }

      // Validate discount percentage
      const discount = parseFloat(discountPercentage);
      if (isNaN(discount) || discount <= 0 || discount > 100) {
        return res.status(400).json({ success: false, message: 'Discount percentage must be between 0 and 100' });
      }

      // Validate selected items exist
      const validItems = await (selectedType === 'category' ? Category : Product)
        .find({ _id: { $in: itemsArray } })
        .select('_id')
        .lean();
      if (validItems.length !== itemsArray.length) {
        return res.status(400).json({ success: false, message: 'One or more selected items are invalid' });
      }

      // Update deal
      Object.assign(deal, {
        name: offerName.trim(),
        offerPrice: discount,
        createdOn: start,
        expireOn: end,
        appliedTo: selectedType,
        selectedItems: itemsArray,
        status,
      });
    } else if (offerType === 'coupon') {
      // Validate required fields
      if (!couponName || !discountValue || !minPurchase || !maxPurchase) {
        return res.status(400).json({ success: false, message: 'All fields are required for coupon offer' });
      }

      // Validate discount value
      const discount = parseFloat(discountValue);
      if (isNaN(discount) || discount <= 0) {
        return res.status(400).json({ success: false, message: 'Discount value must be greater than 0' });
      }

      // Validate purchase amounts
      const min = parseFloat(minPurchase);
      const max = parseFloat(maxPurchase);
      if (isNaN(min) || min < 0 || isNaN(max) || max < 0 || max < min) {
        return res.status(400).json({ success: false, message: 'Invalid purchase amounts' });
      }

      // Update deal
      Object.assign(deal, {
        name: couponName.trim(),
        offerPrice: discount,
        createdOn: start,
        expireOn: end,
        minPrice: min,
        maxPrice: max,
        appliedTo: undefined, // Not applicable for coupon offers
        selectedItems: undefined, // Not applicable for coupon offers
        status,
      });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid offer type' });
    }

    await deal.save();
    res.status(200).json({ success: true, message: 'Deal updated successfully' });
  } catch (error) {
    console.error('❌ Error updating deal:', error);
    res.status(500).json({ success: false, message: 'Failed to update deal' });
  }
};

const deleteDeal = async (req, res) => {
  try {
    // Check admin authentication
    if (!req.session.admin) {
      return res.status(401).json({ success: false, message: 'Unauthorized access' });
    }

    const { dealId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(dealId)) {
      return res.status(400).json({ success: false, message: 'Invalid deal ID' });
    }

    const deal = await Deal.findByIdAndDelete(dealId);
    if (!deal) {
      return res.status(404).json({ success: false, message: 'Deal not found' });
    }

    res.status(200).json({ success: true, message: 'Deal deleted successfully' });
  } catch (error) {
    console.error('❌ Error deleting deal:', error);
    res.status(500).json({ success: false, message: 'Failed to delete deal' });
  }
};

module.exports = { loadDeals, saveDeals, editDeals, deleteDeal };