const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const { Schema } = mongoose;

const orderSchema = new Schema({
  orderId: {
    type: String,
    default: () => uuidv4(),
    unique: true
  },
  orderedItems: [{
    productId: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    quantity: {
      type: Number,
      default: 1
    },
    price: {
      type: Number,
      required: true
    },
    cuttingStyle: {
      type: String,
      required: false
    }
  }],
  totalPrice: {
    type: Number,
    required: true
  },
  discount: {
    type: Number,
    default: 0
  },
  finalAmount: {
    type: Number,
    required: true
  },
  paymentMethod: {
    type: String,
    required: true
  },
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  address: {
    type: Schema.Types.ObjectId,
    ref: 'Address',
    required: true
  },
  orderNotes: {
    type: String,
    required: false
  },
  invoiceDate: {
    type: Date
  },
  status: {
    type: String,
    required: true,
    enum: ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Return Requested', 'Returned', 'Payment Failed', 'Request Declined']
  },
  couponApplied: {
    type: Boolean,
    default: false
  },
  paymentStatus: {
    type: String,
    required: true,
    enum: ['Not Paid', 'Paid', 'Failed'],
    default: 'Not Paid'
  },
  razorpayOrderId: {
    type: String
  },
  paymentDetails: {
    paymentId: String,
    orderId: String,
    signature: String,
    method: String,
    amount: Number,
    date: Date,
    transactionId: String,
    status: String,
  },
});

const Order = mongoose.model('Order', orderSchema);
module.exports = Order;