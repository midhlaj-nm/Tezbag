const Deal = require('../../models/dealSchema');
const Product = require('../../models/productSchema');
const Category = require('../../models/categorySchema');
const mongoose = require('mongoose');
const { updateProductOffers, updateCategoryOffers } = require('../../utils/updateOffers');

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
        let deals = await Deal.find(dealQuery)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        // Normalize current date to IST
        const currentDate = new Date();
        const currentISTOffset = 5.5 * 60;
        currentDate.setMinutes(currentDate.getMinutes() + currentDate.getTimezoneOffset() + currentISTOffset);
        currentDate.setHours(0, 0, 0, 0);

        // Check and update status for each deal, and sync productOffer/categoryOffer
        for (let deal of deals) {
            const start = new Date(deal.createdOn);
            start.setHours(0, 0, 0, 0);
            const end = new Date(deal.expireOn);
            end.setHours(23, 59, 59, 999);

            let expectedStatus = deal.status;
            if (start <= currentDate && end >= currentDate) expectedStatus = 'Active';
            else if (end < currentDate) expectedStatus = 'Expired';
            else expectedStatus = 'Scheduled';

            // Update activeDealIds and offers if status changes
            if (deal.status !== expectedStatus) {
                if (deal.offerType === 'percentage') {
                    if (deal.appliedTo === 'products') {
                        if (expectedStatus === 'Active') {
                            // Add deal to activeDealIds
                            await Product.updateMany(
                                { _id: { $in: deal.selectedItems } },
                                { $addToSet: { activeDealIds: deal._id } }
                            );
                        } else if (expectedStatus === 'Expired') {
                            // Remove deal from activeDealIds
                            await Product.updateMany(
                                { _id: { $in: deal.selectedItems } },
                                { $pull: { activeDealIds: deal._id } }
                            );
                        }
                        // Re-evaluate offers for affected products
                        await updateProductOffers(deal.selectedItems);
                    } else if (deal.appliedTo === 'category') {
                        if (expectedStatus === 'Active') {
                            // Add deal to activeDealIds
                            await Category.updateMany(
                                { _id: { $in: deal.selectedItems } },
                                { $addToSet: { activeDealIds: deal._id } }
                            );
                        } else if (expectedStatus === 'Expired') {
                            // Remove deal from activeDealIds
                            await Category.updateMany(
                                { _id: { $in: deal.selectedItems } },
                                { $pull: { activeDealIds: deal._id } }
                            );
                        }
                        // Re-evaluate offers for affected categories
                        await updateCategoryOffers(deal.selectedItems);
                    }
                }

                // Update the deal status
                deal.status = expectedStatus;
                await deal.save();
            }
        }

        // Convert to plain objects after saving
        deals = deals.map(deal => deal.toObject());

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

        // Determine initial status
        let status = 'Scheduled';
        if (start <= currentDate && end >= currentDate) status = 'Active';
        else if (end < currentDate) status = 'Expired';

        let newDeal = {};

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
                isListed: true,
                status,
            });

            await newDeal.save();

            // If the deal is active, add to activeDealIds and update offers
            if (status === 'Active') {
                if (selectedType === 'products') {
                    await Product.updateMany(
                        { _id: { $in: itemsArray } },
                        { $addToSet: { activeDealIds: newDeal._id } }
                    );
                    await updateProductOffers(itemsArray);
                } else if (selectedType === 'category') {
                    await Category.updateMany(
                        { _id: { $in: itemsArray } },
                        { $addToSet: { activeDealIds: newDeal._id } }
                    );
                    await updateCategoryOffers(itemsArray);
                }
            }
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
                appliedTo: undefined,
                selectedItems: undefined,
                isListed: true,
                status,
            });

            await newDeal.save();
        }

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
            _id: { $ne: dealId },
        });
        if (existingDeal) {
            return res.status(400).json({ success: false, message: 'A deal with this name already exists' });
        }

        // Normalize dates to IST
        const currentDate = new Date();
        const currentISTOffset = 5.5 * 60; // IST offset in minutes (UTC+5:30)
        currentDate.setMinutes(currentDate.getMinutes() + currentDate.getTimezoneOffset() + currentISTOffset);
        currentDate.setHours(0, 0, 0, 0);

        // Parse startDate and endDate
        const start = new Date(startDate + 'T00:00:00+05:30'); // Explicitly set to IST
        const end = new Date(endDate + 'T23:59:59+05:30'); // End of the day in IST

        // Validate dates
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({ success: false, message: 'Invalid date format' });
        }
        if (end < start) {
            return res.status(400).json({ success: false, message: 'End date must be after start date' });
        }

        // Update status based on dates
        let status = deal.status;
        if (start.getTime() !== deal.createdOn.getTime() || end.getTime() !== deal.expireOn.getTime()) {
            if (start <= currentDate && end >= currentDate) status = 'Active';
            else if (end < currentDate) status = 'Expired';
            else status = 'Scheduled';
        }

        // Store the original offerPrice to detect changes
        const originalOfferPrice = deal.offerPrice;

        // Handle offer updates for percentage deals
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

            // Update activeDealIds for old and new items
            if (deal.appliedTo === 'products') {
                const oldItems = deal.selectedItems.map(id => id.toString());
                const newItems = itemsArray;
                const itemsToRemove = oldItems.filter(id => !newItems.includes(id));
                if (itemsToRemove.length || selectedType !== 'products') {
                    await Product.updateMany(
                        { _id: { $in: itemsToRemove.length ? itemsToRemove : oldItems } },
                        { $pull: { activeDealIds: deal._id } }
                    );
                    await updateProductOffers(itemsToRemove.length ? itemsToRemove : oldItems);
                }
            } else if (deal.appliedTo === 'category') {
                const oldItems = deal.selectedItems.map(id => id.toString());
                const newItems = itemsArray;
                const itemsToRemove = oldItems.filter(id => !newItems.includes(id));
                if (itemsToRemove.length || selectedType !== 'category') {
                    await Category.updateMany(
                        { _id: { $in: itemsToRemove.length ? itemsToRemove : oldItems } },
                        { $pull: { activeDealIds: deal._id } }
                    );
                    await updateCategoryOffers(itemsToRemove.length ? itemsToRemove : oldItems);
                }
            }

            // Apply new activeDealIds
            if (status === 'Active') {
                if (selectedType === 'products') {
                    await Product.updateMany(
                        { _id: { $in: itemsArray } },
                        { $addToSet: { activeDealIds: deal._id } }
                    );
                } else if (selectedType === 'category') {
                    await Category.updateMany(
                        { _id: { $in: itemsArray } },
                        { $addToSet: { activeDealIds: deal._id } }
                    );
                }
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

            await deal.save();

            // Re-evaluate offers if the deal is active (to reflect offerPrice changes)
            if (status === 'Active') {
                if (selectedType === 'products') {
                    await updateProductOffers(itemsArray);
                } else if (selectedType === 'category') {
                    await updateCategoryOffers(itemsArray);
                }
            }
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

            // Remove from activeDealIds if switching from percentage to coupon
            if (deal.offerType === 'percentage') {
                if (deal.appliedTo === 'products') {
                    await Product.updateMany(
                        { _id: { $in: deal.selectedItems } },
                        { $pull: { activeDealIds: deal._id } }
                    );
                    await updateProductOffers(deal.selectedItems);
                } else if (deal.appliedTo === 'category') {
                    await Category.updateMany(
                        { _id: { $in: deal.selectedItems } },
                        { $pull: { activeDealIds: deal._id } }
                    );
                    await updateCategoryOffers(deal.selectedItems);
                }
            }

            // Update deal
            Object.assign(deal, {
                name: couponName.trim(),
                offerPrice: discount,
                createdOn: start,
                expireOn: end,
                minPrice: min,
                maxPrice: max,
                appliedTo: undefined,
                selectedItems: undefined,
                status,
            });

            await deal.save();
        } else {
            return res.status(400).json({ success: false, message: 'Invalid offer type' });
        }

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

        const deal = await Deal.findById(dealId);
        if (!deal) {
            return res.status(404).json({ success: false, message: 'Deal not found' });
        }

        // Remove deal from activeDealIds and re-evaluate offers
        if (deal.offerType === 'percentage') {
            if (deal.appliedTo === 'products') {
                await Product.updateMany(
                    { _id: { $in: deal.selectedItems } },
                    { $pull: { activeDealIds: deal._id } }
                );
                await updateProductOffers(deal.selectedItems);
            } else if (deal.appliedTo === 'category') {
                await Category.updateMany(
                    { _id: { $in: deal.selectedItems } },
                    { $pull: { activeDealIds: deal._id } }
                );
                await updateCategoryOffers(deal.selectedItems);
            }
        }

        await Deal.findByIdAndDelete(dealId);

        res.status(200).json({ success: true, message: 'Deal deleted successfully' });
    } catch (error) {
        console.error('❌ Error deleting deal:', error);
        res.status(500).json({ success: false, message: 'Failed to delete deal' });
    }
};

module.exports = { loadDeals, saveDeals, editDeals, deleteDeal };