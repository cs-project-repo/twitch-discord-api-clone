require('dotenv').config()
const jwt = require('jsonwebtoken')

const verifyJWT = (req, res, next) => {
    const authHeader = req.headers['authorization']
    if(!authHeader) return res.status(401).json({ 'message': "No Authorization Header!" })
    const token = authHeader.split(" ")[1]
    jwt.verify(
        token,
        process.env.ACCESS_TOKEN_SECRET,
        (err, decoded) => {
            if (err) return res.status(403).json({ 'message': "Invalid JWT Token, Please Re-authenticate!" })
            req.user = decoded.user
            next()
        }
    )
}

module.exports = verifyJWT
