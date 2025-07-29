const Banner = require('../../models/bannerSchema');
const cloudinary = require('../../config/cloudinary');

const loadGallery = async (req, res) => {
  try {
    const banners = await Banner.find().sort({ createdAt : -1});
    res.render('banner-adm', { banners });
  } catch (error) {
    console.error(error);
    res.status(404);
  }
};

const saveBanner = async (req, res) => {
  try {
    const { bannerName, position } = req.body;
    const image = req.file;
    if (!image) {
      return res.status(400).json({
        success: false,
        message: 'Please upload an image.',
      });
    }

    if (image.size > 10 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        message: 'Image size must be less than 10MB.',
      });
    }

    if (!req.body) {
      console.log('Request body not found');
      return res.status(400).json({
        success: false,
        message: 'Form data is missing or malformed.',
      });
    }

    if (!bannerName || !position) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields (Banner Name or Position).',
      });
    }

    // Upload image to Cloudinary using buffer
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        { folder: 'banners' },
        (error, result) => (error ? reject(error) : resolve(result))
      ).end(image.buffer);
    });
    const imageUrl = result.secure_url;

    // Create new banner
    const newBanner = new Banner({
      title: bannerName,
      image: imageUrl,
      position,
      status: 'Active',
    });

    await newBanner.save();

    if (req.xhr || req.headers.accept === 'application/json') { // Strict check for JSON
      return res.json({ success: true, message: 'Banner uploaded successfully.' });
    }
    return res.redirect('/tezgrani/gallery-management');
  } catch (err) {
    console.error('Error saving banner:', err);
    if (err.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error: ' + Object.values(err.errors).map(e => e.message).join(', '),
      });
    }
    return req.xhr || req.headers.accept === 'application/json'
      ? res.status(500).json({ success: false, message: 'Server error' })
      : res.redirect('/404Error');
  }
};

const toggleBannerStatus = async (req, res) => {
  try {
    const { bannerId } = req.params;
    const { status } = req.body;

    if (!['Active', 'Inactive'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value. Use "Active" or "Inactive".',
      });
    }

    const banner = await Banner.findById(bannerId);
    if (!banner) {
      return res.status(404).json({
        success: false,
        message: 'Banner not found.',
      });
    }

    banner.status = status;
    await banner.save();

    res.json({ success: true, message: `Banner status updated to ${status}.` });
  } catch (error) {
    console.error('Error toggling banner status:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const deleteBanner = async (req, res) => {
  try {
    const { bannerId } = req.params;
    const banner = await Banner.findByIdAndDelete(bannerId);
    if (!banner) {
      return res.status(404).json({
        success: false,
        message: 'Banner not found.',
      });
    }
    res.json({ success: true, message: 'Banner deleted successfully.' });
  } catch (error) {
    console.error('Error deleting banner:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = { loadGallery, saveBanner, toggleBannerStatus, deleteBanner };