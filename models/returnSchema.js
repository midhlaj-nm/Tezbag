const mongoose = require('mongoose')
const { Schema } = mongoose

const returnSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        required: true
    },
    orderId: {
        type: Schema.Types.ObjectId,
        required: true
    },
    delivered: {
        type: Boolean,
        required: true
    },
    reason: {
        type: String,
        required: false
    },
    refundedAmount: {
        type: Number,
        required: true 
    }
})

const Return = mongoose.model('Return', returnSchema)
module.exports = Return