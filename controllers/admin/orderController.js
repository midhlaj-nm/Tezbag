const mongoose = require('mongoose');
const Order = require('../../models/orderSchema');
const Invoice = require('../../models/invoiceSchema');
const Address = require('../../models/addressSchema');

const loadOrder = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

    const query = {};

    // Search functionality
    const searchQuery = req.query.search;
    if (searchQuery) {
      query.$or = [
        { orderId: { $regex: new RegExp(searchQuery, 'i') } },
      ];
    }

    // Filter by status
    const filterStatus = req.query.filter;
    if (filterStatus && filterStatus !== 'all') {
      query.status = filterStatus;
    }

    // Sort by date
    const { sortDate } = req.query;
    if (sortDate) {
      const localDate = new Date(`${sortDate}T00:00:00`);
      localDate.setUTCHours(localDate.getUTCHours() + 5, localDate.getUTCMinutes() + 30); // Adjust for IST
      const startDate = new Date(localDate);
      startDate.setUTCHours(0, 0, 0, 0); // Start of the day in IST
      const endDate = new Date(localDate);
      endDate.setUTCHours(23, 59, 59, 999); // End of the day in IST
      query.invoiceDate = { $gte: startDate, $lte: endDate };
    }

    // Filter by payment status
    query.paymentStatus = { $in: ['Paid', 'Not Paid'] };

    // Fetch orders
    const orders = await Order.find(query)
      .populate('userId', 'f_Name l_Name _id email phone createdAt')
      .populate('address') // This populate will fetch the address document, but we need the subdocument later
      .skip(skip)
      .limit(limit)
      .sort({ invoiceDate: -1 });

    // Create username for display and filtering
    const ordersWithUsername = orders.map((order) => {
      if (order.userId) {
        order.userId.username = `${order.userId.f_Name} ${order.userId.l_Name}`.trim();
      }
      return order;
    });

    // Filter by username if searchQuery exists (after populating and creating username)
    let filteredOrders = ordersWithUsername;
    if (searchQuery) {
      filteredOrders = ordersWithUsername.filter((order) => {
        const lowerCaseSearchQuery = searchQuery.toLowerCase();
        const matchesOrderId = order.orderId && order.orderId.toLowerCase().includes(lowerCaseSearchQuery);
        const matchesUsername = order.userId && order.userId.username && order.userId.username.toLowerCase().includes(lowerCaseSearchQuery);
        return matchesOrderId || matchesUsername;
      });
    }

    const totalOrders = await Order.countDocuments(query);
    const totalPages = Math.ceil(totalOrders / limit);

    res.render('orders-adm', {
      orders: filteredOrders,
      currentPage: page,
      totalPages,
      searchQuery,
      filterStatus,
      sortDate,
    });
  } catch (error) {
    console.error('Error in loadOrder:', error); // Essential debug
    res.status(404);
  }
};

const updateStatus = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { status: newStatus } = req.body;

    const validStatuses = ['Pending', 'Processing', 'Shipped', 'Delivered'];
    if (!validStatuses.includes(newStatus)) {
      console.warn(`Attempted to update order ${orderId} with invalid status: ${newStatus}`);
      return res.status(400).json({ success: false, message: 'Invalid status value' });
    }

    // Update the order
    const order = await Order.findOneAndUpdate(
      { orderId },
      { status: newStatus },
      { new: true, runValidators: true },
    );

    if (!order) {
      console.warn(`Order with ID ${orderId} not found for status update.`);
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    res.json({ success: true, message: 'Status updated successfully' });
  } catch (error) {
    console.error('Error updating status:', error);
    next(error);
  }
};

const loadOrderDetails = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findOne({ orderId })
      .populate('userId', 'f_Name l_Name _id email phone createdOn')
      .populate({
        path: 'orderedItems.productId',
        model: 'Product',
        select: 'productName SKU',
      });

    if (!order) {
      console.warn(`Order with ID ${orderId} not found for details page.`); // Essential debug
      return res.status(400).json({ success: false, message: 'Order not found. Please refresh the page' });
    }

    let address = null;
    if (order.address) {
      const selectedAddressId = order.address.toString();

      const addressDoc = await Address.findOne(
        { 'address._id': new mongoose.Types.ObjectId(selectedAddressId) },
        { 'address.$': 1 },
      );

      if (addressDoc && addressDoc.address && addressDoc.address.length > 0) {
        address = addressDoc.address[0];
      } else {
        console.warn(`Address subdocument with ID ${selectedAddressId} not found in any address document for order ${orderId}.`); // Essential debug
      }
    } else {
      console.warn(`Order ${orderId} does not have an associated address ID.`); // Essential debug
    }

    const invoice = await Invoice.findOne({ orderId }).select('pdfUrl');

    const customerId = order.userId._id.toString().substring(0, 6);

    res.render('orderDetailsPage', {
      order,
      customerId,
      address,
      invoice,
    });
  } catch (error) {
    console.error('Error loading order details:', error); // Essential debug
    res.status(404);
  }
};

const cancelOrder = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findOne({ orderId });

    if (!order) {
      console.warn(`Order with ID ${orderId} not found for cancellation.`); // Essential debug
      return res.status(400).json({ success: false, message: 'Order not found' });
    }

    if (order.status === 'Cancelled') {
      console.warn(`Attempted to cancel already cancelled order ${orderId}.`); // Essential debug
      return res.status(400).json({ success: false, message: 'Order already cancelled' });
    }

    order.status = 'Cancelled';
    await order.save();

    res.json({ success: true, message: 'Order cancelled successfully' });
  } catch (error) {
    console.error('Error cancelling order:', error); // Essential debug
    next(error);
  }
};

module.exports = {
  loadOrder, updateStatus, loadOrderDetails, cancelOrder,
};
