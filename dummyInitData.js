// generateInitData.js
const crypto = require('crypto');

const BOT_TOKEN = '8384577576:AAFrW3BnhmGyh39nkAVhmKD601aB66y6ADM';

const user = {
  id: 123456,
  first_name: "John",
  username: "john_doe"
};

const auth_date = Math.floor(Date.now() / 1000);

const params = new URLSearchParams({
  auth_date: auth_date.toString(),
  user: JSON.stringify(user),
});

const dataCheckString = [...params.entries()]
  .sort()
  .map(([k, v]) => `${k}=${v}`)
  .join('\n');

const secretKey = crypto
  .createHmac('sha256', 'WebAppData')
  .update(BOT_TOKEN)
  .digest();

const hash = crypto
  .createHmac('sha256', secretKey)
  .update(dataCheckString)
  .digest('hex');

params.append('hash', hash);

console.log(params.toString());
