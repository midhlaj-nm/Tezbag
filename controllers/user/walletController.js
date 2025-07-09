const Wallet = require('../../models/walletSchema');

const loadWallet = async (req, res) => {
  try {
    const userId = req.session.user;
    if (!userId) {
      return res.redirect('/');
    }
    const page = parseInt(req.query.page) || 1;
    const limit = 10; 
    const searchQuery = req.query.query || '';

    const searchCriteria = {
      user: userId,
      $or: [
        { 'transactions.type': { $regex: searchQuery, $options: 'i' } },
        { 'transactions.amount': { $regex: searchQuery, $options: 'i' } }, 
        { 'transactions.reason': { $regex: searchQuery, $options: 'i' } }
      ]
    };

    // Fetch wallet with pagination
    const wallet = await Wallet.findOne({ user: userId }).lean();
    let transactions = [];

    if (wallet && wallet.transactions.length > 0) {
      transactions = wallet.transactions.filter(transaction => 
        (transaction.type && transaction.type.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (transaction.amount && transaction.amount.toString().includes(searchQuery)) ||
        (transaction.reason && transaction.reason.toLowerCase().includes(searchQuery.toLowerCase()))
      );
    }

    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    transactions = transactions.slice(startIndex, endIndex);

    const totalPages = Math.ceil(transactions.length / limit);

    const walletData = {
      wallet: (wallet && wallet.transactions.length > 0) ? wallet : { balance: 0, transactions: [] },
      transactions: transactions,
      currentPage: page,
      totalPages: totalPages,
      searchQuery
    };

    res.render('wallet', {
      walletData
    });
  } catch (error) {
    console.error(error);
    res.status(404);
  }
};

module.exports = { loadWallet };