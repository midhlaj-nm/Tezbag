// middlewares/errorHandler.js
function ErrHandler(Error, req, res, next) {
    res.status(Error.status || 500);
    res.send({"error": true, "message": Error.message || "Internal Serer Error Occured"})
}

module.exports = ErrHandler



// return next({ status: 111, message: '' });