const cloudinary = require('../config/cloudinary');

async function uploadImagesToCloudinary(images) {
  const uploaded = [];

  for (const image of images) {
    const url = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        { width: 440, height: 440, crop: 'fill', folder: 'products' },
        (err, result) => err ? reject(err) : resolve(result.secure_url)
      ).end(image.buffer);
    });
    uploaded.push(url);
  }

  return uploaded;
}

module.exports = uploadImagesToCloudinary;
