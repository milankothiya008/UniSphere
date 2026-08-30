const sendSuccess = (res, statusCode, message, data = null, extra = {}) => {
    const payload = {
        success: true,
        message,
        ...extra
    };

    if (data !== null && data !== undefined) {
        payload.data = data;
    }

    return res.status(statusCode).json(payload);
};

module.exports = { sendSuccess };
