const { cache } = require('hbs')
const mongoose = require('mongoose')
const env = require('dotenv').config()


const connectDB = async () => {
    try{
        await mongoose.connect(process.env.MONGODB_URI)
        console.log('MongoDB connected');
    }  catch (error) {
        console.log('Something unusual Happend',error);
        process.exit(1)
    }  
}


module.exports = connectDB