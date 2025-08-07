const puppeteer = require('puppeteer');
const ejs = require('ejs');
const path = require('path');
const streamifier = require('streamifier');
const cloudinary = require('../config/cloudinary');
const Product = require('../models/productSchema');
const Invoice = require('../models/invoiceSchema');

const pdfGenerator = async (invoice, order) => {
  const data = {
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.createdAt,
    billingName: invoice.billingDetails.name,
    billingAddress: invoice.billingDetails.address,
    billingEmail: invoice.billingDetails.email,
    billingPhone: invoice.billingDetails.phone,
    paymentMethod: order.paymentMethod,
    items: await Promise.all(invoice.items.map(async (item) => {
      const product = await Product.findById(item.productId).select('productName');
      return {
        ...item._doc,
        productName: product.productName,
      };
    })),
    discount: invoice.discount,
    totalPrice: invoice.totalPrice,
    finalAmount: invoice.finalAmount,
  };
  console.log('Data prepared for EJS rendering:', data);

  const templatePath = path.join(__dirname, '..', 'views', 'invoice.ejs');
  console.log('Template path:', templatePath);
  const htmlContent = await ejs.renderFile(templatePath, data);
  console.log('Rendered HTML content length:', htmlContent.length);

  const browser = await puppeteer.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--single-process',
      '--no-zygote'
    ],
    headless: 'new',
    executablePath: '/usr/bin/chromium-browser'
  });
  const page = await browser.newPage();
  await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
  const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
  await browser.close();

  console.log('PDF buffer created successfully, size:', pdfBuffer.length);

  const pdfStream = streamifier.createReadStream(pdfBuffer);
  const fileName = `${invoice.invoiceNumber}.pdf`;
  console.log('Uploading PDF to Cloudinary with filename:', fileName);
  const uploadResult = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'raw',
        folder: 'invoices',
        public_id: fileName.replace('.pdf', ''),
        format: 'pdf',
      },
      (error, result) => {
        if (error) {
          console.error('Cloudinary upload error:', error);
          reject(error);
        } else {
          console.log('Cloudinary upload successful, result:', result);
          resolve(result);
        }
      },
    );
    pdfStream.pipe(stream);
  });

  invoice.pdfUrl = uploadResult.secure_url;
  console.log('Updating invoice with pdfUrl:', invoice.pdfUrl);
  await Invoice.findByIdAndUpdate(invoice._id, { pdfUrl: invoice.pdfUrl });
  console.log('Invoice updated with pdfUrl in DB');
  return uploadResult.secure_url;
};

module.exports = pdfGenerator;