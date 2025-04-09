const mongoose = require('mongoose')
const {Schema} = mongoose;

const categorySchema = new Schema({
    name: {
        type: String,
        required: true,
        unique: true
    },
    description: {
        type: String,
        required: true
    },
    isListed: {
        type: Boolean,
        default:true
    },
    categoryOffer: {
        type:Number,
        default:0
    },

},{timeseries: true})

const Category = mongoose.model('Category',categorySchema)

module.exports = Address