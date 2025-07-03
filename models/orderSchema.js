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
  orderNotes:{
    type: String,
    required: false
  },
  invoiceDate: {
    type: Date
  },
  status: {
    type: String,
    required: true,
    enum: ['Pending', 'Processing', 'Shipped', 'Deliverd', 'Cancelled', 'Return on the process', 'Returned']
  },
  couponApplied: {
    type: Boolean,
    default: false
  }
});

const Order = mongoose.model('Order', orderSchema);
module.exports = Order;