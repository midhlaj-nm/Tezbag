const mongoose = require('mongoose')
const {Schema} = mongoose;

const dealSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  offerType: {
    type: String,
    enum: ['percentage', 'coupon'],
    required: true,
  },
  offerPrice: {
    type: Number,
    required: true,
  },
  createdOn: {
    type: Date,
    required: true,
  },
  expireOn: {
    type: Date,
    required: true,
  },
  appliedTo: {
    type: String,
    enum: ['products', 'category'],
  },
  selectedItems: [{
    type: mongoose.Schema.Types.ObjectId,
  }],
  minPrice: {
    type: Number,
  },
  maxPrice: {
    type: Number,
  },
  isListed: {
    type: Boolean,
    default: true,
  },
  status: {
    type: String,
    enum: ['Scheduled', 'Active', 'Expired'],
    default: 'Scheduled',
  },
}, { timestamps: true });

const Deal = mongoose.model('Deal', dealSchema)

module.exports = Deal