require('dotenv').config();
const { validateTelegramWebAppData } = require('./telegramAuth.js')
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { MongoClient, ServerApiVersion } = require('mongodb');
const { Telegraf } = require('telegraf');
const { encrypt, decrypt, SESSION_DURATION } = require('./jwt.js');
/* ================= BASIC SETUP ================= */
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());

app.use(cors({
    origin: ['http://localhost:5173', 'https://prefeudal-lowell-unfitting.ngrok-free.dev', 'https://timely-alfajores-e0751b.netlify.app'],
    credentials: true
}));

/* ================= ENV ================= */
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;
// const JWT_SECRET = process.env.JWT_SECRET;


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
    usersCollection = client.db('telegram_db').collection('users');

    // 🔒 Prevent duplicate users
    await usersCollection.createIndex({ telegramId: 1 }, { unique: true });

    console.log('✅ MongoDB Connected');


    /* ===== Telegram WebApp Login ===== */
    const REFERRAL_BONUS = 50;

    app.post('/api/auth', async (req, res) => {
        
        function generateReferralCode(user) {
            return `${user.username || 'user'}-${user.id}`;
        }
        const { initData, ref } = req.body
        const user = validateTelegramWebAppData(initData)

        if (!user) return res.status(401).json({ message: 'Invalid Telegram data' })

        const existingUser = await usersCollection.findOne({ telegramId: user.id })
        let referralCode

        if (!existingUser) {
            referralCode = generateReferralCode(user)

            // New user signup with referral
            let referredBy = null
            if (ref) {
                // check if referral code exists
                const refUser = await usersCollection.findOne({ referralCode: ref })
                if (refUser) {
                    referredBy = refUser.referralCode

                    // Add bonus to referrer
                    await usersCollection.updateOne(
                        { telegramId: refUser.telegramId },
                        { $inc: { bonus: REFERRAL_BONUS } }
                    )
                }
            }

            // insert new user
            await usersCollection.updateOne(
                { telegramId: user.id },
                {
                    $set: {
                        ...user,
                        referralCode,
                        referredBy,
                        bonus: 0,
                        lastLogin: new Date()
                    }
                },
                { upsert: true }
            )
        } else {
            // Existing user login
            await usersCollection.updateOne(
                { telegramId: user.id },
                { $set: { lastLogin: new Date() } }
            )
            referralCode = existingUser.referralCode
        }

        const token = encrypt({ telegramId: user.id })
        res.cookie('session', token, {
            httpOnly: true,
            sameSite: 'none',
            secure: true
        })

        res.json({ message: 'Authenticated', referralCode, bonus: existingUser?.bonus || 0 })
    })


    // ------------------- Middleware -------------------
    function requireAuth(req, res, next) {
        const token = req.cookies.session;
        if (!token) return res.status(401).json({ ok: false, message: 'Not authenticated' });

        try {
            req.user = decrypt(token);   // decrypt দিয়ে payload পাওয়া যায়
            next();
        } catch {
            return res.status(401).json({ ok: false, message: 'Invalid token' });
        }
    }


    // ------------------- Current User -------------------
    app.get('/api/me', requireAuth, async (req, res) => {
        // console.log(req.cookies); 
        const user = await usersCollection.findOne({
            telegramId: req.user.telegramId
        });

        if (!user) {
            return res.status(404).json({
                ok: false,
                message: 'User not found'
            });
        }

        res.json({
            ok: true,
            user
        });
    });


    // ------------------- Logout -------------------
    app.post('/api/logout', requireAuth, (req, res) => {
        res.clearCookie('session')
        res.json({ message: 'Logged out' })
    })
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
