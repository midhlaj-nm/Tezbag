const mongoose = require('mongoose')
const {Schema} = mongoose;

const orderSchema = new Schema({
    orderId: {
        type: String,
        defualt:()=>uuidv4(),
        unique:true
    },
    orderedItems:[{
        productId:{
            type:Schema.Types.ObjectId,
            ref: 'Product',
            required: true
        },
        quantity: {
            type:Number,
            default:1
        },
        price: {
            type: Number,
            required: true
        },
    }],
    totalPrice: {
        type: Number,
        required: true
    },
    discount: {
        type:Number,
        default:0
    },
    finalAmount: {
        type: Number,
        required: true
    },
    address: {
        type: Schema.Types.objectId,
        ref: 'User',
        required: true
    },
    invoiceDate: {
        type: Date,
    },
    status: {
        type:String,
        required:true,
        enum: ['Pending','Processing','Shipped','Deliverd','Cancelled','Return on the process','Returned']

    },
    createdOn: {
        type: Date,
        default:Date.now,
        required:true
    },
    couponApplied: {
        type: Boolean,
        default: false
    }
})

const Order = mongoose.model('Order',orderSchema)

module.exports = Order