const crypto = require('crypto')

function validateTelegramWebAppData(initDataRaw) {
    const BOT_TOKEN = process.env.BOT_TOKEN
    if (!BOT_TOKEN) return null

    const params = new URLSearchParams(initDataRaw)
    const hash = params.get('hash')
    if (!hash) return null
    params.delete('hash')

    const authDate = params.get('auth_date')
    if (!authDate) return null
    const now = Math.floor(Date.now() / 1000)
    if (now - parseInt(authDate) > 300) return null

    const dataCheckString = [...params.entries()]
        .sort()
        .map(([k, v]) => `${k}=${v}`)
        .join('\n')

    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest()
    const calculatedHash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex')

    if (calculatedHash !== hash) return null

    try {
        return JSON.parse(params.get('user'))
    } catch {
        return null
    }
}

module.exports = { validateTelegramWebAppData }
