const Order = require('../../models/orderSchema');
const Wallet = require('../../models/walletSchema');
const Return = require('../../models/returnSchema');
const Product = require('../../models/productSchema');

const loadReturn = async (req, res) => {
  try {
    const { search, page = 1, sortDate } = req.query;
    const perPage = 10;

    const query = { status: { $in: ['Return Requested', 'Returned', 'Request Declined'] } };

    if (search) {
      query.orderId = { $regex: new RegExp(search, 'i') };
    }

    if (sortDate) {
      const targetDate = new Date(sortDate);

      if (!isNaN(targetDate.getTime())) {
        const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
        const startDate = new Date(targetDate);
        startDate.setHours(0, 0, 0, 0);
        const startOfDayIST_asUTC = new Date(startDate.getTime() - IST_OFFSET_MS);

        const endDate = new Date(targetDate);
        endDate.setHours(23, 59, 59, 999);
        const endOfDayIST_asUTC = new Date(endDate.getTime() - IST_OFFSET_MS);

        query.invoiceDate = { $gte: startOfDayIST_asUTC, $lte: endOfDayIST_asUTC };
      }
    }

    const totalOrders = await Order.countDocuments(query);
    const totalPages = Math.ceil(totalOrders / perPage);
    const currentPage = Math.min(Math.max(1, parseInt(page)), totalPages || 1) || 1;

    const orders = await Order.find(query)
      .skip((currentPage - 1) * perPage)
      .limit(perPage)
      .populate('userId', 'f_Name l_Name')
      .sort({ invoiceDate: -1 })
      .lean();

    const ordersWithNames = await Promise.all(orders.map(async (order) => {
      const returnQuery = { orderId: order._id };
      const returnData = await Return.findOne(returnQuery).lean();
      return {
        ...order,
        userName: `${order.userId ? order.userId.f_Name || '' : ''} ${order.userId ? order.userId.l_Name || '' : ''}`.trim(),
        returnReason: returnData.reason,
      };
    }));

    res.render('returns-adm', {
      orders: ordersWithNames,
      currentPage,
      totalPages,
      searchQuery: search || '',
      sortDate: sortDate || '',
    });
  } catch (error) {
    res.status(500).send(`Internal Server Error: ${error.message}`);
  }
};

const changeStatus = async (req, res, next) => {
  try {
    const { orderId, action } = req.body;

    if (!orderId || !action) {
      return res.status(400).json({ error: 'Order ID and action are required' });
    }

    const order = await Order.findOne({ orderId }).populate('userId');
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    let newStatus;
    if (action === 'approve') {
      newStatus = 'Returned';
      let wallet = await Wallet.findOne({ user: order.userId._id });
      if (!wallet) {
        wallet = new Wallet({ user: order.userId._id, balance: 0 });
      }
      wallet.balance += order.finalAmount;
      wallet.transactions.push({
        type: 'credit',
        amount: order.finalAmount,
        reason: `Return refund for order ${orderId}`,
      });
      await wallet.save();

      for (const item of order.orderedItems) {
        const product = await Product.findById(item.productId);
        if (product) {
          product.quantity += item.quantity;
          await product.save();
        }
      }
    } else if (action === 'decline') {
      newStatus = 'Request Declined';
    } else {
      return res.status(400).json({ error: 'Invalid action. Use "approve" or "decline"' });
    }

    order.status = newStatus;
    await order.save();

    res.json({ message: `Order status updated to ${newStatus}`, success: true });
  } catch (error) {
    next(error);
  }
};

module.exports = { loadReturn, changeStatus };
