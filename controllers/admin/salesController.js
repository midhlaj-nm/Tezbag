const Deal = require('../../models/dealSchema');
const Order = require('../../models/orderSchema');

const loadSales = async (req, res) => {
  try {
    const { start, end, sort } = req.query;

    const startDate = start || new Date().toISOString().split('T')[0];
    const endDate = end || new Date().toISOString().split('T')[0];
    const sortOption = sort || 'today';

    const totalOrders = await Order.countDocuments({
      createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
    });

    const pendingOrders = await Order.countDocuments({
      status: 'Pending',
      createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
    });

    const orderAmountResult = await Order.aggregate([
      { $match: { createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) } } },
      { $group: { _id: null, total: { $sum: '$finalAmount' } } }
    ]).then(res => res[0]?.total || 0);
    const totalOrderAmount = orderAmountResult;

    const totalDiscountGiven = await Deal.aggregate([
      { $match: { createdOn: { $gte: new Date(startDate), $lte: new Date(endDate) } } },
      { $group: { _id: null, total: { $sum: '$offerPrice' } } }
    ]).then(res => res[0]?.total || 0);

    const couponDiscounts = await Deal.aggregate([
      { $match: { offerType: 'coupon', createdOn: { $gte: new Date(startDate), $lte: new Date(endDate) } } },
      { $group: { _id: null, total: { $sum: '$offerPrice' } } }
    ]).then(res => res[0]?.total || 0);

    const productOffers = await Deal.aggregate([
      { $match: { offerType: 'percentage', createdOn: { $gte: new Date(startDate), $lte: new Date(endDate) } } },
      { $group: { _id: null, total: { $sum: '$offerPrice' } } }
    ]).then(res => res[0]?.total || 0);

    const refunds = await Order.aggregate([
      { $match: { status: 'Returned', createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) } } },
      { $group: { _id: null, total: { $sum: '$finalAmount' } } }
    ]).then(res => res[0]?.total || 0);

    // Net Revenue
    const netRevenue = totalOrderAmount - totalDiscountGiven - refunds;

    const avgOrderValue = totalOrders > 0 ? totalOrderAmount / totalOrders : 0;

    const topPaymentMethodResult = await Order.aggregate([
      { $match: { createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) } } },
      { $group: { _id: '$paymentMethod', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 }
    ]).then(res => res[0]?._id || 'N/A');

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
      topPaymentMethod: topPaymentMethodResult
    };

    console.log('This is the sales Data: ', salesData)

    res.render('sales-adm', {
      salesData,
      start: startDate,
      end: endDate,
      sort: sortOption
    });
  } catch (error) {
    console.error(error);
    res.status(404);
  }
};

module.exports = { loadSales };