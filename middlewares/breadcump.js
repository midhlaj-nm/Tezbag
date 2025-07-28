const Product = require('../models/productSchema'); // adjust path if needed

module.exports = async (req, res, next) => {
  const currentUrl = req.originalUrl.split('?')[0];
  const pathParts = currentUrl.split('/').filter(Boolean);

  const breadcrumbs = [];

  for (let i = 0; i < pathParts.length; i++) {
    let name = pathParts[i];
    const url = `/${pathParts.slice(0, i + 1).join('/')}`;

    // Handle /product/:id → Show "Shop" and "Product Name"
    if (i > 0 && pathParts[i - 1] === 'product') {
      // Insert custom breadcrumb for "Shop"
      breadcrumbs.push({ name: 'Shop', url: '/shop' });

      try {
        const product = await Product.findById(name).select('productName');
        if (product) {
          name = product.productName;
        }
      } catch (err) {
        console.log('Invalid product ID or DB error:', err.message);
      }

      breadcrumbs.push({ name, url }); // Add product name
      break; // Done processing
    }

    // Skip the "product" part itself so it doesn't show as breadcrumb
    if (name === 'product') {
      continue;
    }

    // Capitalize static parts
    if (typeof name === 'string') {
      name = name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }

    breadcrumbs.push({ name, url });
  }

  res.locals.currentUrl = currentUrl;
  res.locals.breadcrumbs = breadcrumbs;

  next();
};
