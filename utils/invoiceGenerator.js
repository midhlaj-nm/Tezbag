const Invoice = require('../models/invoiceSchema')
const fs = require('fs')

const createInvoice = async(order, addr) => {
    const invoiceNumber = `INV-${order.invoiceDate}-${order.orderId.toString().slice(-6)}`
    const totalPrice = order.totalPrice
    const discount = order.discount
    const finalAmount = order.finalAmount

    const invoice = new Invoice({
        orderId: order.orderId,
        invoiceNumber: invoiceNumber,
        totalPrice:totalPrice,
        discount:discount,
        finalAmount:finalAmount,
        paymentMethod: order.paymentMethod,
        billingDetails:{
            name: `${addr.firstName} ${addr.lastName}`.trim(),
            address: `${addr.streetAddress}, ${addr.city}, ${addr.state}`,
            phone: addr.phone,
            email: addr.email
        },
        items: order.orderedItems.map(item => ({
            productName: item.productId.productName,
            quantity: item.quantity,
            price: item.price,
            total: item.price * item.quantity
        })),
        createdAt: Date.now()
    })

    await invoice.save()
    return invoice

}

module.exports = createInvoice