const mongoose = require('mongoose');

const { Schema } = mongoose;

const productSchema = new Schema({
  productName: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  customerReview: {
    type: Schema.Types.ObjectId,
    ref: 'Review',
  },
  category: {
    type: Schema.Types.ObjectId,
    ref: 'Category',
    required: true,
  },
  regularPrice: {
    type: Number,
    required: true,
  },
  salePrice: {
    type: Number,
    required: true,
  },
  productOffer: {
    type: Number,
    default: 0,
  },
  quantity: {
    type: Number,
    default: 0,
  },
  productImage: [{ type: String }],
  cuttingStyle: {
    type: [String],
    required: false,
  },
  isBlocked: {
    type: Boolean,
    default: false,
  },
  status: {
    type: String,
    enum: ['Available', 'Out Of Stock'],
    required: true,
    default: 'Available',
  },
  SKU: {
    type: String,
    required: true,
  },
  activeDealIds: [{
    type: Schema.Types.ObjectId,
    ref: 'Deal',
  }],
}, { timestamps: true });

const Product = mongoose.model('Product', productSchema);

module.exports = Product;
