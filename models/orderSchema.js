const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const Address = require('./addressSchema');
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
  invoiceDate: {
    type: Date
  },
  status: {
    type: String,
    required: true,
    enum: ['Pending', 'Processing', 'Shipped', 'Deliverd', 'Cancelled', 'Return on the process', 'Returned']
  },
  createdOn: {
    type: Date,
    default: Date.now,
    required: true
  },
  couponApplied: {
    type: Boolean,
    default: false
  }
});

const Order = mongoose.model('Order', orderSchema);
module.exports = Order;