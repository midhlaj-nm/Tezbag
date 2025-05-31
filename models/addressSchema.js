const mongoose = require('mongoose')
const {Schema} = mongoose;


const addressSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    address: [{
        firstName: {
            type: String,
            required: true
        },
        lastName: {
            type: String,
            required: true
        },
        company: {
            type: String,
            required: false
        },
        streetAddress: {
            type: String,
            required: true
        },
        city: {
            type: String,
            required: true
        },
        landMark: {
            type: String,
            required: true
        },
        country: {
            type: String,
            required: true
        },
        state: {
            type: String,
            required: true
        },
        pinCode: {
            type: Number,
            required: true
        },
        email: {
            type: String,
            required: false
        },
        phone: {
            type: String,
            required: true
        },
        altPhone: {
            type: String,
            required: false
        },
        isDefault: {
            type: Boolean,
            default: false
        }
    }]
})



const Address = mongoose.model('Address',addressSchema)

module.exports = Address