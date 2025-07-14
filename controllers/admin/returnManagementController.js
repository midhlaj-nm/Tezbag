const Order = require('../../models/orderSchema');
const Wallet = require('../../models/walletSchema');
const Return = require('../../models/returnSchema');
const Product = require('../../models/productSchema')

const loadReturn = async (req, res) => {
  try {
    console.log('Loading returns with query:', req.query); // Debug: Log incoming query parameters
    const { search, page = 1, sortDate } = req.query;
    const perPage = 10; // Number of items per page

    // Build query
    let query = { status: { $in: ['Return Requested', 'Returned', 'Request Declined'] } };
    if (search) {
      query.$or = [
        { orderId: { $regex: new RegExp(search, 'i') } },
        { 'userId.f_Name': { $regex: new RegExp(search, 'i') } },
        { 'userId.l_Name': { $regex: new RegExp(search, 'i') } }
      ];
      console.log('Search query applied:', query); // Debug: Log search query
    }
    if (sortDate) {
      const localDate = new Date(sortDate + 'T00:00:00');
      localDate.setUTCHours(localDate.getUTCHours() + 5, localDate.getUTCMinutes() + 30); // Adjust for IST
      const startDate = new Date(localDate);
      startDate.setUTCHours(0, 0, 0, 0); // Start of the day in IST
      const endDate = new Date(localDate);
      endDate.setUTCHours(23, 59, 59, 999); // End of the day in IST
      query.invoiceDate = { $gte: startDate, $lte: endDate };
      console.log('Sort date query applied:', query); // Debug: Log sort date query
    }

    // Pagination
    const totalOrders = await Order.countDocuments(query);
    console.log('Total orders found:', totalOrders); // Debug: Log total orders
    const totalPages = Math.ceil(totalOrders / perPage);
    const currentPage = Math.min(Math.max(1, parseInt(page)), totalPages) || 1;

    const orders = await Order.find(query)
      .skip((currentPage - 1) * perPage)
      .limit(perPage)
      .populate('userId', 'f_Name l_Name')
      .sort({ invoiceDate: -1 })
      .lean();
    console.log('Fetched orders:', orders); // Debug: Log fetched orders

    // Concatenate full name and fetch return reason for each order
    const ordersWithNames = await Promise.all(orders.map(async (order) => {
      const returnData = await Return.findOne({ orderId: order.orderId }).lean();
      return {
        ...order,
        userName: `${order.userId.f_Name || ''} ${order.userId.l_Name || ''}`.trim(),
        returnReason: returnData ? returnData.reason || 'No reason provided' : 'No reason provided'
      };
    }));
    console.log('Orders with names and return reasons:', ordersWithNames); // Debug: Log orders with names and reasons

    res.render('returns-adm', {
      orders: ordersWithNames,
      currentPage,
      totalPages,
      searchQuery: search || '',
      sortDate: sortDate || ''
    });
  } catch (error) {
    console.error('Error in loadReturn:', error); 
    res.status(404); 
  }
};

const changeStatus = async (req, res, next) => {
    try {
        console.log('Changing status with request body:', req.body); // Debug: Log request body
        const { orderId, action } = req.body; // Expecting action as 'approve' or 'decline'

        if (!orderId || !action) {
            console.log('Missing orderId or action in request'); // Debug: Log missing parameters
            return res.status(400).json({ error: 'Order ID and action are required' });
        }

        const order = await Order.findOne({ orderId }).populate('userId');
        if (!order) {
            console.log('Order not found:', orderId); // Debug: Log if order not found
            return res.status(404).json({ error: 'Order not found' });
        }

        let newStatus;
        if (action === 'approve') {
            newStatus = 'Returned';
            // Update wallet with finalAmount as credit
            let wallet = await Wallet.findOne({ user: order.userId._id });
            if (!wallet) {
                wallet = new Wallet({ user: order.userId._id, balance: 0 });
            }
            wallet.balance += order.finalAmount;
            wallet.transactions.push({
                type: 'credit',
                amount: order.finalAmount,
                reason: `Return refund for order ${orderId}`
            });
            await wallet.save();
            console.log('Wallet updated for user:', order.userId._id, 'New balance:', wallet.balance); // Debug: Log wallet update

            // Restock the quantities to the products
            for (const item of order.orderedItems) {
                const product = await Product.findById(item.productId);
                if (product) {
                    product.quantity += item.quantity; // Increment stock by the returned quantity
                    await product.save();
                    console.log(`Restocked ${item.quantity} units for product ${item.productId}, new stock: ${product.quantity}`);
                } else {
                    console.log(`Product ${item.productId} not found for restocking`);
                }
            }
        } else if (action === 'decline') {
            newStatus = 'Request Declined';
        } else {
            console.log('Invalid action:', action); // Debug: Log invalid action
            return res.status(400).json({ error: 'Invalid action. Use "approve" or "decline"' });
        }

        order.status = newStatus;
        await order.save();
        console.log('Order status updated:', orderId, 'to', newStatus); // Debug: Log status update

        res.json({ message: `Order status updated to ${newStatus}`, success: true });
    } catch (error) {
        console.error('Error in changeStatus:', error); // Debug: Log error
        next(error);
    }
};

module.exports = { loadReturn, changeStatus };