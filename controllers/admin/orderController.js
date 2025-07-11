const Order = require('../../models/orderSchema');

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
      // Adjust for timezone (e.g., IST is UTC+5:30)
      const startDate = new Date(sortDate);
      startDate.setUTCHours(0, 0, 0, 0); // Start of the day in UTC
      const endDate = new Date(sortDate);
      endDate.setUTCHours(23, 59, 59, 999); // End of the day in UTC
      query.invoiceDate = { $gte: startDate, $lte: endDate };
      console.log('Sort Date Range Applied:', { startDate, endDate });
    }

    // Fetch orders with user details and populate
    console.log('Executing MongoDB Query:', query);
    const orders = await Order.find(query)
      .populate('userId', 'f_Name l_Name')
      .skip(skip)
      .limit(limit)
      .sort({ invoiceDate: -1 });

    // Debug: Log raw orders after population
    console.log('Raw Orders Fetched:', orders.map(order => ({
      orderId: order.orderId,
      userId: order.userId ? { f_Name: order.userId.f_Name, l_Name: order.userId.l_Name } : null,
      status: order.status,
      invoiceDate: order.invoiceDate
    })));

    // Create username by concatenating f_Name and l_Name
    const ordersWithUsername = orders.map(order => {
      if (order.userId) {
        order.userId.username = `${order.userId.f_Name || ''} ${order.userId.l_Name || ''}`.trim();
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
      sortDate // Pass sortDate to EJS for button display
    });
  } catch (error) {
    console.error('Error in loadOrder:', error);
    res.status(404);
  }
};

module.exports = { loadOrder };