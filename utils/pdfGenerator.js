const Invoice = require('../models/invoiceSchema');
const pdf = require('html-pdf');
const ejs = require('ejs')
const path = require('path')
const cloudinary = require('../config/cloudinary');
const streamifier = require('streamifier')

const pdfGenerator = async (invoice) => {

    const data = {
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.createdAt,
        billingName: invoice.billingDetails.name,
        billingAddress: invoice.billingDetails.address,
        billingEmail: invoice.billingDetails.phone,
        billingPhone: invoice.billingDetails.email,
        paymentMethod: invoice.paymentMethod,
        items: invoice.items,
        totalPrice: invoice.totalPrice,
        finalAmount: invoice.finalAmount
    }

    const templatePath = path.join(__dirname, '..','views', 'invoice.ejs');
    const htmlContent = await ejs.renderFile(templatePath, data)

    const pdfBuffer = await new Promise((resolve,reject) => {
        pdf.create(htmlContent, {format: 'A4'}).toBuffer((err, buffer) => {
            if(err) reject(err);
            else resolve(buffer)
        })
    })

    const pdfStream = streamifier.createReadStream(pdfBuffer);
    const fileName = `${invoice.invoiceNumber}.pdf`;
    const uploadResult = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { resource_type: 'raw', folder: 'invoices', public_id: fileName.replace('.pdf', ''), format: 'pdf' },
            (error, result) => {
                if (error) reject(error);
                else resolve(result);
            }
        );
        pdfStream.pipe(stream);
    });

    invoice.pdfUrl = uploadResult.secure_url;
    await Invoice.findByIdAndUpdate(invoice._id, { pdfUrl: invoice.pdfUrl });
    return uploadResult.secure_url;
};

module.exports = pdfGenerator;