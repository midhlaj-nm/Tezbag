const Category = require('../../models/categorySchema')
const Product = require('../../models/productSchema')
const generateSKU = require('../../utils/SKUgenerator')

const loadProduct = async(req,res) => {
    try {

    // Fetch all listed categories
    const categories = await Category.find({ isListed: true }).sort({ name: 1 });

        res.render('products-adm', {categories})
    } catch (error) {
        console.log(error)
    }
}

const addProduct = async (req, res, next) => {
  try {

  } catch (err) {

  }

};


module.exports = {loadProduct, addProduct}