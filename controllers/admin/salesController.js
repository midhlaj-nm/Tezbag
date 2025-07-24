const Deal = require('../../models/dealSchema');
const Order = require('../../models/orderSchema');

const loadSales = async (req, res) => {
    try {
        const { start, end, sort } = req.query;

        // Set default dates if not provided
        const startDateString = start || new Date().toISOString().split('T')[0];
        const endDateString = end || new Date().toISOString().split('T')[0];

        // Create Date objects for query, ensuring the full day is included
        const startDate = new Date(startDateString);
        const endDate = new Date(endDateString);
        endDate.setDate(endDate.getDate() + 1); // Query up to the day AFTER the end date, effectively including all of the end date

        const sortOption = sort || 'today';

        // Match criteria for all Order queries
        const orderMatchCriteria = {
            invoiceDate: { $gte: startDate, $lt: endDate }
        };

        const totalOrders = await Order.countDocuments(orderMatchCriteria);
        
        const pendingOrders = await Order.countDocuments({
            ...orderMatchCriteria, // Use the same date range
            status: 'Pending'
        });

        const orderAmountResult = await Order.aggregate([
            { $match: orderMatchCriteria },
            { $group: { _id: null, total: { $sum: '$finalAmount' } } }
        ]);
        const totalOrderAmount = orderAmountResult[0]?.total || 0;

        // --- CORRECTED DISCOUNT CALCULATION ---
        // Use the 'discount' field from the Order collection
        const totalDiscountResult = await Order.aggregate([
            { $match: orderMatchCriteria },
            { $group: { _id: null, total: { $sum: '$discount' } } }
        ]);
        const totalDiscountGiven = totalDiscountResult[0]?.total || 0;

        // Calculate coupon discounts by matching the 'couponApplied' flag
        const couponDiscountsResult = await Order.aggregate([
            { $match: { ...orderMatchCriteria, couponApplied: true } },
            { $group: { _id: null, total: { $sum: '$discount' } } }
        ]);
        const couponDiscounts = couponDiscountsResult[0]?.total || 0;
        
        // Product offers can be inferred as the remaining discount
        // since your Order schema doesn't specify the offer type.
        const productOffers = totalDiscountGiven - couponDiscounts;

        const refundsResult = await Order.aggregate([
            { $match: { ...orderMatchCriteria, status: 'Returned' } },
            { $group: { _id: null, total: { $sum: '$finalAmount' } } }
        ]);
        const refunds = refundsResult[0]?.total || 0;

        // Net Revenue: Total sales minus all discounts and refunds
        const netRevenue = totalOrderAmount - totalDiscountGiven - refunds;

        const avgOrderValue = totalOrders > 0 ? totalOrderAmount / totalOrders : 0;

        const topPaymentMethodResult = await Order.aggregate([
            { $match: orderMatchCriteria },
            { $group: { _id: '$paymentMethod', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 1 }
        ]);
        const topPaymentMethod = topPaymentMethodResult[0]?._id || 'N/A';

        const salesData = {
            totalOrders,
            pendingOrders,
            totalOrderAmount,
            totalDiscountGiven,
            couponDiscounts,
            productOffers,
            refunds,
            netRevenue,
            avgOrderValue,
            topPaymentMethod
        };

        console.log('This is the sales Data: ', salesData);

        res.render('sales-adm', {
            salesData,
            start: startDateString,
            end: endDateString,
            sort: sortOption
        });
    } catch (error) {
        console.error(error);
        res.status(404).send('Error loading sales data');
    }
};

module.exports = { loadSales };