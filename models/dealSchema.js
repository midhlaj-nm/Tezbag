const mongoose = require('mongoose')
const {Schema} = mongoose;

const dealSchema = new Schema({
    name: {
        type: String,
        required: true,
        unique: true
    },
    createdOn: {
        type: Date,
        default: Date.now,
        required: true
    },
    expireOn: {
        type: Date,
        required: true
    },
    offerPrice: {
        type: Number,
        required: true
    },
    minPrice: {
        type: Number,
        required: false
    },
    maxPrice: {
        type: Number,
        required: false
    },
    isListed: {
        type: Boolean,
        default: true
    },
    offerType: {
        type: String,
        required: true
    },
    appliedTo: {
        type: String,
        required: false
    },
    selectedItems: {
        type: [String],
        required: false
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
    },
    status: {
        type: String,
        enum: ['Active', 'Scheduled', 'Expired'],
        default: 'Scheduled'
    }
},{ timestamps: true })

const Deal = mongoose.model('Deal', dealSchema)

module.exports = Deal