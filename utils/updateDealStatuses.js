const cron = require('node-cron');
const Deal = require('../models/dealSchema');

// Function to update deal statuses
const updateDealStatuses = async () => {
  try {
    console.log('Starting deal status update job...');

    // Normalize current date to IST
    const currentDate = new Date();
    const currentISTOffset = 5.5 * 60; // IST offset in minutes (UTC+5:30)
    currentDate.setMinutes(currentDate.getMinutes() + currentDate.getTimezoneOffset() + currentISTOffset);
    currentDate.setHours(0, 0, 0, 0);

    // Fetch all deals
    const deals = await Deal.find({});

    // Update status for each deal
    for (let deal of deals) {
      const start = new Date(deal.createdOn);
      start.setHours(0, 0, 0, 0);
      const end = new Date(deal.expireOn);
      end.setHours(23, 59, 59, 999);

      let newStatus = deal.status;
      if (start <= currentDate && end >= currentDate) newStatus = 'Active';
      else if (end < currentDate) newStatus = 'Expired';
      else newStatus = 'Scheduled';

      // Update status only if it has changed
      if (deal.status !== newStatus) {
        deal.status = newStatus;
        await deal.save();
        console.log(`Updated status of deal "${deal.name}" to ${newStatus}`);
      }
    }

    console.log('Deal status update job completed.');
  } catch (error) {
    console.error('❌ Error in deal status update job:', error);
  }
};

// Schedule the job to run every day at midnight IST
cron.schedule('0 0 * * *', updateDealStatuses, {
  scheduled: true,
  timezone: 'Asia/Kolkata',
});

module.exports = { updateDealStatuses };