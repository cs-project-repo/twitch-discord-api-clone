require('dotenv').config()
const Users = require('../models/users')

const verifyCSRF = async (req, res, next) => {
    const recoveredCSRFToken = req.headers['x-www-csrf-token']
    if(await Users.find({ "forbidden.tokens.csrf": recoveredCSRFToken }).count() === 0) return res.status(409).json({ 'message': "Invalid CSRF Token!" })
    next();
};

module.exports = verifyCSRF
