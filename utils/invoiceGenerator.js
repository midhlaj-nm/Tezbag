const Invoice = require('../models/invoiceSchema');

const createInvoice = async (order, addr) => {
  const invoiceNumber = `INV-${order.invoiceDate}-${order.orderId.toString().slice(-6)}`;
  const { totalPrice } = order;
  const { discount } = order;
  const { finalAmount } = order;
  const items = order.orderedItems.map((item) => ({
    productId: item.productId,
    quantity: item.quantity,
    price: item.price,
    total: item.price * item.quantity,
  }));

  const invoice = new Invoice({
    orderId: order.orderId,
    invoiceNumber,
    totalPrice,
    discount,
    finalAmount,
    paymentMethod: order.paymentMethod,
    billingDetails: {
      name: `${addr.firstName} ${addr.lastName}`.trim(),
      address: `${addr.streetAddress}, ${addr.city}, ${addr.state}`,
      phone: addr.phone,
      email: addr.email,
    },
    items,
    createdAt: Date.now(),
  });

  await invoice.save();
  return invoice;
};

module.exports = createInvoice;
