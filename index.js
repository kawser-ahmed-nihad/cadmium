const express = require('express');
const app = express();
const cors = require('cors');
const port = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());
const crypto = require('crypto');

require('dotenv').config();

const { MongoClient, ServerApiVersion } = require('mongodb');
const { Telegraf } = require('telegraf');

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || '';
const REF_BONUS = Number(process.env.REF_BONUS || 50);
const MINING_COOLDOWN = Number(process.env.MINING_COOLDOWN_SECONDS || 3600);
const MINING_DURATION = Number(process.env.MINING_DURATION_SECONDS || 600);
const DEFAULT_EARN_PER_SEC = Number(process.env.DEFAULT_EARN_PER_SEC || 2);
// console.log("fgdh", WEBAPP_URL);
// MongoDB URI
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.gyokyfk.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});


function verifyTelegram(initData) {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');

    const dataCheckString = [...params.entries()]
        .sort()
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');

    const secretKey = crypto
        .createHash('sha256')
        .update(BOT_TOKEN)
        .digest();

    const hmac = crypto
        .createHmac('sha256', secretKey)
        .update(dataCheckString)
        .digest('hex');

    return hmac === hash;
}

// MongoDB collection variable
let users;
// console.log("user", users);
async function run() {
    try {
        await client.connect();
        const db = client.db('mining_post'); // database name
        users = db.collection('users'); // collection name

        console.log("Connected to MongoDB successfully!");

        // Helper function
        function computePendingEarnings(user) {
            if (!user.mining || !user.mining.startedAt || !user.mining.endsAt) return 0;
            const now = Date.now();
            const started = new Date(user.mining.startedAt).getTime();
            const ends = new Date(user.mining.endsAt).getTime();
            const effectiveEnd = Math.min(now, ends);
            if (effectiveEnd <= started) return 0;
            const seconds = Math.floor((effectiveEnd - started) / 1000);
            const pending = seconds * (user.earnPerSec || DEFAULT_EARN_PER_SEC);
            return pending;
        }

        // Routes
        app.post('/api/auth/telegram', async (req, res) => {
            const { initData } = req.body;
            if (!initData) return res.status(403).json({ ok: false });

            if (!verifyTelegram(initData)) {
                return res.status(403).json({ ok: false, msg: 'Invalid Telegram data' });
            }

            const params = new URLSearchParams(initData);
            const tgUser = JSON.parse(params.get('user'));

            const telegramId = tgUser.id;

            let user = await users.findOne({ telegramId });

            if (!user) {
                user = {
                    telegramId,
                    username: tgUser.username || '',
                    firstName: tgUser.first_name || '',
                    balance: 0,
                    earnPerSec: DEFAULT_EARN_PER_SEC,
                    mining: { isActive: false, startedAt: null, endsAt: null },
                    createdAt: new Date()
                };
                await users.insertOne(user);
            }

            res.json({ ok: true, user });
        });


    } catch (err) {
        console.error('MongoDB connection failed', err);
    }
}

run().catch(console.dir);

// Telegram Bot
if (BOT_TOKEN) {
    const bot = new Telegraf(BOT_TOKEN);

    bot.start(async (ctx) => {
        try {
            const telegramId = ctx.from.id;
            const msg = ctx.message && ctx.message.text ? ctx.message.text : '';
            let referrerId = null;
            if (msg) {
                const parts = msg.split(' ');
                if (parts.length > 1 && parts[1].startsWith('ref_')) {
                    referrerId = Number(parts[1].replace('ref_', ''));
                }
            }

            let user = await users.findOne({ telegramId });


            if (!user) {
                const newUser = {
                    telegramId,
                    username: ctx.from.username || '',
                    firstName: ctx.from.first_name || '',
                    balance: 0,
                    earnPerSec: DEFAULT_EARN_PER_SEC,
                    mining: { isActive: false, startedAt: null, endsAt: null },
                    lastMiningStartAt: null,
                    referrer: referrerId || null,
                    referrals: 0,
                    createdAt: new Date()
                };
                await users.insertOne(newUser);

                // Referral bonus
                if (referrerId) {
                    const refUser = await users.findOne({ telegramId: referrerId });
                    if (refUser) {
                        await users.updateOne({ telegramId: referrerId }, {
                            $inc: { balance: REF_BONUS, referrals: 1 }
                        });
                        try {
                            await ctx.telegram.sendMessage(referrerId, `✅ একটি নতুন রেফারেল পেলেঃ +${REF_BONUS} কোয়েন (Referral)`);
                        } catch (e) { }
                    }
                }
            }

            await ctx.reply('Welcome to Hamster Mining Bot! Click below to open the game.', {
                reply_markup: {
                    inline_keyboard: [[{ text: '▶️ Open Game', web_app: { url: WEBAPP_URL } }]]
                }
            });
        } catch (err) {
            console.error('Bot /start error', err);
            ctx.reply('Welcome!');
        }
    });

    bot.launch().then(() => console.log('Bot started'));
} else {
    console.warn('BOT_TOKEN not set — Telegram bot will not run.');
}

app.get('/', (req, res) => {
    res.send('Welcome to the server!');
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
