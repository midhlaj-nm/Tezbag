const User = require('../../models/userSchema');
const Admin = require('../../models/adminSchema');

const loadUsersPage = async (req, res) => {
  try {
    const search = req.query.search || '';
    const page = parseInt(req.query.page) || 1;
    const limit = 7;

    const query = { isAdmin: false };

    if (search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      query.$or = [
        { f_Name: searchRegex },
        { l_Name: searchRegex },
        { email: searchRegex },
      ];
    }

    const totalUsers = await User.countDocuments(query);
    const totalPages = Math.ceil(totalUsers / limit);
    const skip = (page - 1) * limit;

    const users = await User.find(query)
      .skip(skip)
      .limit(limit)
      .sort({ createdOn: -1 })
      .lean();

    res.render('users-adm', {
      users,
      search,
      currentPage: page,
      totalPages,
    });
  } catch (error) {
    console.log('Error loading users:', error);
    res.status(404);
  }
};

const isAction = async (req, res, next) => {
  try {
    const userId = req.params.id;
    const { isBlocked } = req.body;

    await User.findByIdAndUpdate(userId, { isBlocked });

    res.json({ success: true });
  } catch (error) {
    console.log('Toggle Block err:-', error);
    next();
  }
};

module.exports = {
  loadUsersPage,
  isAction,
};
