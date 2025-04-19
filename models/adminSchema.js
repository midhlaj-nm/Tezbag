const mongoose = require('mongoose');
const { Schema } = mongoose;

const adminSchema = new Schema({
  f_Name: {
    type: String,
    required: true,
    trim: true
  },
  l_Name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true
  },
  oldPasswords: {
    type: [String],
    default: []
  },
  isSuperAdmin: {
    type: Boolean,
    default: false
  },
  isBlocked: {
    type: Boolean,
    default: false
  },
  createdOn: {
    type: Date,
    default: Date.now
  },
  lastLogin: {
    type: Date
  },
  lastLogout: {
    type: Date
  },
});

const Admin = mongoose.model('Admin', adminSchema);
module.exports = Admin;
