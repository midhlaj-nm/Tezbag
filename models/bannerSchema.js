const mongoose = require('mongoose')
const {Schema} = mongoose;

const bannerSchema = new Schema({
    title: {
        type:String,
        required: true
    },
    image: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    link: {
        type: String
    },
    startDate: {
        type: Date,
        required: true
    },
    endDate: {
        type: Date,
        required: true
    }
})


const Banner = mongoose.model('Banner',bannerSchema);

module.exports = Banner 