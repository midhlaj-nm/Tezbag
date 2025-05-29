const mongoose = require('mongoose');
const { Schema } = mongoose;

const categorySchema = new Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  slug: {
    type: String,
    unique: true,
    lowercase: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  isListed: {
    type: Boolean,
    default: false
  },
  categoryOffer: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  image: {
    type: String,
    default: '' // Store Cloudinary URL
  },
  publicId: {
    type: String,
    default: '' // Store Cloudinary public ID for deletion
  }
}, { timestamps: true });

const Category = mongoose.model('Category', categorySchema);

module.exports = Category;