const Order = require('../../models/orderSchema');
const Invoice = require('../../models/invoiceSchema');

const loadOrder = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 5;
    const skip = (page - 1) * limit;

    let query = {};

    // Debug: Log the incoming request query
    console.log('Request Query:', req.query);

    // Search functionality
    const searchQuery = req.query.search;
    if (searchQuery) {
      console.log('Search Query Received:', searchQuery);
      query.$or = [
        { orderId: { $regex: new RegExp(searchQuery, 'i') } }
      ];
      console.log('Initial MongoDB Query (Search):', query);
    }

    // Filter by status
    const filterStatus = req.query.filter;
    if (filterStatus && filterStatus !== 'all') {
      query.status = filterStatus;
      console.log('Filter Status Applied:', filterStatus);
    }

    // Sort by date
    const sortDate = req.query.sortDate;
    if (sortDate) {
      const localDate = new Date(sortDate + 'T00:00:00');
      localDate.setUTCHours(localDate.getUTCHours() + 5, localDate.getUTCMinutes() + 30);
      const startDate = new Date(localDate);
      startDate.setUTCHours(0, 0, 0, 0); // Start of the day in IST
      const endDate = new Date(localDate);
      endDate.setUTCHours(23, 59, 59, 999); // End of the day in IST
      query.invoiceDate = { $gte: startDate, $lte: endDate };
      console.log('Sort Date Range Applied (IST):', { startDate, endDate });
    }

    // Filter by payment status (only Paid or Not Paid)
    query.paymentStatus = { $in: ['Paid', 'Not Paid'] };
    console.log('Payment Status Filter Applied:', query.paymentStatus);

    // Fetch orders with user details and populate
    console.log('Executing MongoDB Query:', query);
    const orders = await Order.find(query)
      .populate('userId', 'f_Name l_Name _id email phone createdAt')
      .populate('address')
      .skip(skip)
      .limit(limit)
      .sort({ invoiceDate: -1 });

    // Debug: Log raw orders after population
    console.log('Raw Orders Fetched:', orders.map(order => ({
      orderId: order.orderId,
      userId: order.userId ? { f_Name: order.userId.f_Name, l_Name: order.userId.l_Name } : null,
      status: order.status,
      invoiceDate: order.invoiceDate,
      paymentStatus: order.paymentStatus
    })));

    // Create username by concatenating f_Name and l_Name
    const ordersWithUsername = orders.map(order => {
      if (order.userId) {
        order.userId.username = `${order.userId.f_Name} ${order.userId.l_Name}`.trim();
        console.log(`Order ${order.orderId}: Username created - ${order.userId.username}`);
      }
      return order;
    });

    // After population, filter orders based on username if searchQuery exists
    let filteredOrders = ordersWithUsername;
    if (searchQuery) {
      console.log('Applying Username Filter with Search Query:', searchQuery);
      filteredOrders = ordersWithUsername.filter(order => {
        const matchesOrderId = order.orderId && order.orderId.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesUsername = order.userId && order.userId.username && order.userId.username.toLowerCase().includes(searchQuery.toLowerCase());
        console.log(`Order ${order.orderId}: OrderId Match = ${matchesOrderId}, Username Match = ${matchesUsername}`);
        return matchesOrderId || matchesUsername;
      });
      console.log('Filtered Orders:', filteredOrders.map(order => ({
        orderId: order.orderId,
        username: order.userId ? order.userId.username : null
      })));
    }

    const totalOrders = await Order.countDocuments(query);
    console.log('Total Orders Count:', totalOrders);
    const totalPages = Math.ceil(totalOrders / limit);

    res.render('orders-adm', {
      orders: filteredOrders,
      currentPage: page,
      totalPages,
      searchQuery,
      filterStatus,
      sortDate
    });
  } catch (error) {
    console.error('Error in loadOrder:', error);
    res.status(404);
  }
};

const updateStatus = async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const { status: newStatus } = req.body;

    // Validate newStatus
    const validStatuses = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];
    if (!validStatuses.includes(newStatus)) {
      return res.status(400).json({ success: false, message: 'Invalid status value' });
    }

    // Find and update the order
    const order = await Order.findOneAndUpdate(
      { orderId },
      { status: newStatus },
      { new: true, runValidators: true }
    );

    if (!order) {
      return res.status(404);
    }

    console.log(`Order ${orderId} status updated to ${newStatus}`);
    res.json({ success: true, message: 'Status updated successfully' });
  } catch (error) {
    console.error('Error updating status:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const loadOrderDetails = async (req, res) => {
  try {
    console.log('Starting loadOrderDetails for orderId:', req.params.orderId);

    const orderId = req.params.orderId;
    const order = await Order.findOne({ orderId })
      .populate('userId', 'f_Name l_Name _id email phone createdAt')
      .populate('address'); // Populates the Address document
    console.log('Order fetched:', order);

    if (!order) {
      console.log('Order not found for orderId:', orderId);
      return res.status(404);
    }

    console.log('Populated order data:', {
      userId: order.userId,
      address: order.address,
      status: order.status,
      invoiceDate: order.invoiceDate
    });

    // Check and extract the correct address
    let address = null;
    console.log('Checking address population:', order.address);
    if (order.address && order.address.address) {
      console.log('Address document contains array:', order.address.address);
      // Find the address object matching the order.address _id (should be the Address document _id)
      const addressDocId = order.address._id.toString();
      address = order.address.address.find(a => a._id.toString() === addressDocId);
      console.log('Matched address by document _id:', address);
      if (!address) {
        console.log('No exact match, using first address as fallback');
        address = order.address.address[0]; // Fallback to first address
      }
    } else {
      console.log('No valid address data found in order.address');
    }

    const invoice = await Invoice.findOne({ orderId }).select('pdfUrl');
    console.log('Invoice fetched:', invoice);

    // Prepare customer ID from userId (first 6 characters of _id)
    const customerId = order.userId._id.toString().substring(0, 6);
    console.log('Generated customerId:', customerId);

    res.render('orderDetailsPage', {
      order,
      customerId,
      address,
      invoice
    });
    console.log('Rendered orderDetailsPage with data:', { orderId, customerId, addressExists: !!address, invoiceExists: !!invoice });
  } catch (error) {
    console.error('Error loading order details:', error);
    console.log('Error details:', {
      message: error.message,
      stack: error.stack
    });
    res.status(404);
  }
};

module.exports = { loadOrder, updateStatus, loadOrderDetails };