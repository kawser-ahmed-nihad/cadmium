const jwt = require('jsonwebtoken')
const SESSION_DURATION = parseInt(process.env.SESSION_DURATION) || 3600000

function encrypt(payload) {
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' })
}

function decrypt(token) {
    return jwt.verify(token, process.env.JWT_SECRET)
}

module.exports = { encrypt, decrypt, SESSION_DURATION }
