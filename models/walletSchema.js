const mongoose = require('mongoose')
const {Schema} = mongoose;

const walletSchema = new Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', 
    required: true,
    unique: true 
  },
  balance: {
    type: Number,
    default: 0
  },
  transactions: [{
      type: {
        type: String,
        enum: ['credit', 'debit'],
        required: true
      },
      amount: {
        type: Number,
        required: true
      },
      reason: {
        type: String,
        required: true
      },
      date: {
        type: Date,
        default: Date.now
      }
    }]
}, {timestamps: true});

const Wallet = mongoose.model('Wallet', walletSchema);

module.exports = Wallet