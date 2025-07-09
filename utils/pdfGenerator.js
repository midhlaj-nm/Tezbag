const Invoice = require('../models/invoiceSchema');
const pdf = require('html-pdf');
const ejs = require('ejs');
const path = require('path');
const cloudinary = require('../config/cloudinary');
const streamifier = require('streamifier');

const pdfGenerator = async (invoice, order) => {

  const data = {
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.createdAt,
    billingName: invoice.billingDetails.name,
    billingAddress: invoice.billingDetails.address,
    billingEmail: invoice.billingDetails.email,
    billingPhone: invoice.billingDetails.phone,
    paymentMethod: order.paymentMethod,
    items: invoice.items,
    totalPrice: invoice.totalPrice,
    finalAmount: invoice.finalAmount
  };

  const templatePath = path.join(__dirname, '..', 'views', 'invoice.ejs');
  const htmlContent = await ejs.renderFile(templatePath, data);
  console.log('Rendered HTML content length:', htmlContent.length);

  const pdfBuffer = await new Promise((resolve, reject) => {
    pdf.create(htmlContent, { format: 'A4' }).toBuffer((err, buffer) => {
      if (err) {
        console.error('PDF creation error:', err);
        reject(err);
      } else if (!buffer || buffer.length === 0) {
        console.error('PDF buffer is empty or invalid');
        reject(new Error('Failed to generate PDF buffer'));
      } else {
        resolve(buffer);
      }
    });
  });

  const pdfStream = streamifier.createReadStream(pdfBuffer);
  const fileName = `${invoice.invoiceNumber}.pdf`;
  const uploadResult = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: 'raw', folder: 'invoices', public_id: fileName.replace('.pdf', ''), format: 'pdf' },
      (error, result) => {
        if (error) {
          console.error('Cloudinary upload error:', error);
          reject(error);
        } else {
          resolve(result);
        }
      }
    );
    pdfStream.pipe(stream);
  });

  invoice.pdfUrl = uploadResult.secure_url;
  await Invoice.findByIdAndUpdate(invoice._id, { pdfUrl: invoice.pdfUrl });
  console.log('Generated PDF URL:', invoice.pdfUrl); 
  return uploadResult.secure_url;
};

module.exports = pdfGenerator;