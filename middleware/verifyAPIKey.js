require('dotenv').config()

const verifyAPIKey = (req, res, next) => {
    if(`${req.headers["x-www-api-key"]}` !== `${process.env.SERVER_API_KEY}`) return res.status(409).json({ 'message': "Invalid API Key!" })
    next()
}

module.exports = verifyAPIKey