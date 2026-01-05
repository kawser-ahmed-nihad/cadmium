
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { MongoClient, ServerApiVersion } = require('mongodb');
const { Telegraf } = require('telegraf');

/* ================= BASIC SETUP ================= */
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());

app.use(cors({
    origin: true,
    credentials: true
}));

/* ================= ENV ================= */
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;
const JWT_SECRET = process.env.JWT_SECRET;

const REF_BONUS = Number(process.env.REF_BONUS || 50);
const DEFAULT_EARN_PER_SEC = Number(process.env.DEFAULT_EARN_PER_SEC || 2);

/* ================= MONGODB ================= */
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.gyokyfk.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true
    }
});

let users;



/* ================= TELEGRAM VERIFY ================= */
function verifyTelegram(initData) {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');

    const dataCheckString = [...params.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');

    const secretKey = crypto
        .createHmac('sha256', 'WebAppData')
        .update(BOT_TOKEN)
        .digest();

    const calculatedHash = crypto
        .createHmac('sha256', secretKey)
        .update(dataCheckString)
        .digest('hex');

    return calculatedHash === hash;
}

/* ================= JWT ================= */
function generateToken(user) {
    return jwt.sign(
        { id: user.telegramId },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
}

function authMiddleware(req, res, next) {
    const token = req.cookies.token;

    if (!token)
        return res.status(401).json({ ok: false, message: 'Unauthenticated' });

    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({ ok: false, message: 'Invalid token' });
    }
}

/* ================= EXPRESS API ================= */
async function run() {
    await client.connect();
    users = client.db('telegram_db').collection('users');

    // 🔒 Prevent duplicate users
    await users.createIndex({ telegramId: 1 }, { unique: true });

    console.log('✅ MongoDB Connected');

    /* ===== Telegram WebApp Login ===== */
    app.post('/api/auth/telegram', async (req, res) => {
        try {
            const { initData } = req.body;
            if (!initData)
                return res.status(400).json({ ok: false, message: 'initData missing' });

            if (!verifyTelegram(initData))
                return res.status(403).json({ ok: false, message: 'Invalid Telegram data' });

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
                    createdAt: new Date()
                };
                await users.insertOne(user);
            }

            const token = generateToken(user);

            // 🍪 HTTP-only cookie
            res.cookie('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000
            });


            res.json({ ok: true, user });

        } catch (err) {
            console.error(err);
            res.status(500).json({ ok: false, message: 'Server error' });
        }
    });

    /* ===== Current User ===== */
    app.get('/api/me', async (req, res) => {
        try {
            const usersList = await users.find({}).toArray(); // 🔥 FIX
            res.json({ ok: true, users: usersList });
        } catch (err) {
            res.status(500).json({ ok: false, message: err.message });
        }
    });



    /* ===== Logout ===== */
    app.post('/api/logout', (req, res) => {
        res.clearCookie('token', {
            httpOnly: true,
            secure: true,
            sameSite: 'none'
        });
        res.json({ ok: true });
    });
}

run().catch(console.error);

/* ================= TELEGRAM BOT ================= */
if (BOT_TOKEN) {
    const bot = new Telegraf(BOT_TOKEN);

    bot.start(async (ctx) => {
        try {
            await ctx.reply(

                'Cadmium!',
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '▶️ Play', web_app: { url: WEBAPP_URL } }]
                        ]
                    }
                }
            );

        } catch (err) {
            console.error(err);
            ctx.reply('❌ Error');
        }
    });

    bot.telegram.setChatMenuButton({
        menu_button: {
            type: 'web_app',
            text: 'Play',
            web_app: { url: WEBAPP_URL }
        }
    });

    bot.launch();
    // console.log('🤖 Telegram Bot Started');
}

/* ================= SERVER ================= */
app.get('/', (req, res) => {
    res.send('🚀 HamsterVerse Server Running');
});

app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
});


