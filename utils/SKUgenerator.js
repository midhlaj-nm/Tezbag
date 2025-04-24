const Product = require('../models/productSchema');
const Category = require('../models/categorySchema');

const generateSKU = (category, productName, id) => {
  const catCode = category.name.slice(0, 3).toUpperCase();
  const nameCode = productName.slice(0, 3).toUpperCase();
  const uniqueId = id || Date.now().toString().slice(-4);
  const sku = `${catCode}-${nameCode}-${uniqueId}`.replace(/[^A-Z0-9-]/g, '');
  return sku;
};

module.exports =  generateSKU ;