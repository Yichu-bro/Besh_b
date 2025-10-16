
import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, get, update, remove } from 'firebase/database';
import cors from 'cors';

// ============================
// 🔥 Firebase Configuration
// ============================
const firebaseConfig = {
    apiKey: "AIzaSyD8-E3hJLweH60kcAHLhg8kcbEWkADejVg",
    authDomain: "besh-c0cde.firebaseapp.com",
    databaseURL: "https://besh-c0cde-default-rtdb.firebaseio.com",
    projectId: "besh-c0cde",
    storageBucket: "besh-c0cde.firebasestorage.app",
    messagingSenderId: "387004383369",
    appId: "1:387004383369:web:22fa62fcb4e5b787f58658"
};

const appFB = initializeApp(firebaseConfig);
const db = getDatabase(appFB);

// ============================
// 🤖 Bot & Server Setup
// ============================
// ⚠️ IMPORTANT: Replace with your actual bot token from BotFather
const BOT_TOKEN = 'YOUR_TELEGRAM_BOT_TOKEN'; 
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const app = express();
app.use(express.json());
app.use(cors()); // Enable CORS for all routes

// ⚠️ IMPORTANT: Change this to a long, random, secure secret key
const ADMIN_SECRET_KEY = "YOUR_SUPER_SECRET_ADMIN_KEY"; 

// ============================
// ➡️ Telegram Bot Logic (/start command)
// ============================
bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const username = msg.from.username || `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();
    const referrerId = match[1] ? match[1].replace('ref', '') : null;

    const userRef = ref(db, `users/${chatId}`);
    const snap = await get(userRef);

    if (!snap.exists()) {
        // Get global config for referral bonuses
        const configSnap = await get(ref(db, 'config'));
        const config = configSnap.val() || {};
        const refereeBonus = config.referralBonusReferee || 500;
        const referrerBonus = config.referralBonusReferrer || 400;

        const newUser = {
            username: username,
            points: 0,
            adsWatchedToday: 0,
            totalAdsWatchedLifetime: 0,
            lastAdWatchDate: null,
            claimedBonuses: [],
            referralCode: chatId.toString(), // The user's own ID is their referral code
            referredBy: referrerId || null,
            referredUsers: [],
            createdAt: new Date().toISOString()
        };

        if (referrerId && referrerId !== chatId.toString()) {
            newUser.points += refereeBonus; // Award bonus to the new user

            const referrerRef = ref(db, `users/${referrerId}`);
            const referrerSnap = await get(referrerRef);
            if (referrerSnap.exists()) {
                const referrerData = referrerSnap.val();
                const updatedReferrerPoints = (referrerData.points || 0) + referrerBonus;
                const updatedReferredUsers = [...(referrerData.referredUsers || []), chatId.toString()];
                
                await update(referrerRef, {
                    points: updatedReferrerPoints,
                    referredUsers: updatedReferredUsers
                });

                bot.sendMessage(referrerId, `🎉 Congratulations! ${username} joined using your link. You've earned ${referrerBonus} points!`);
            }
        }
        await set(userRef, newUser);
    }

    // Send the welcome message with the Mini App button
    const configSnap = await get(ref(db, 'config'));
    const config = configSnap.val() || {};
    const webAppUrl = config.webAppUrl || 'https://your-website.com/Tag2Cash.html'; // Fallback URL

    const imageUrl = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQrVCb0_Y-Okp3H04dSuasMa78iD1BHv9Sz-U-r0ONnUg&s=10'; // <-- EDIT THIS IMAGE LINK
    const caption = `<b>Welcome to Tag2Cash, ${username}!</b>\n\nTap the button below to launch the app and start earning.`; // <-- EDIT THIS TEXT
    const buttonText = '🚀 Launch App'; // <-- EDIT THIS BUTTON TEXT

    await bot.sendPhoto(chatId, imageUrl, {
        caption: caption,
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: buttonText, web_app: { url: `${webAppUrl}?userId=${chatId}` } }]
            ]
        }
    });
});

// ============================
// 📡 API for Mini App & Admin Panel
// ============================

// Middleware for admin authentication
const isAdmin = (req, res, next) => {
    const { secret } = req.body;
    if (secret !== ADMIN_SECRET_KEY) {
        return res.status(401).send({ error: 'Unauthorized' });
    }
    next();
};

// GET user data
app.get('/api/user/:userId', async (req, res) => {
    const { userId } = req.params;
    const userRef = ref(db, `users/${userId}`);
    const snap = await get(userRef);
    if (snap.exists()) {
        res.json(snap.val());
    } else {
        res.status(404).send({ error: 'User not found. Please /start the bot.' });
    }
});

// POST (update) user data
app.post('/api/user/:userId', async (req, res) => {
    const { userId } = req.params;
    await set(ref(db, `users/${userId}`), req.body);
    res.send({ success: 'User data updated' });
});

// GET referrer's username
app.get('/api/referrer/:userId', async (req, res) => {
    const { userId } = req.params;
    const referrerRef = ref(db, `users/${userId}`);
    const snap = await get(referrerRef);
    if (snap.exists()) {
        const { username } = snap.val();
        res.json({ username });
    } else {
        res.status(404).send({ error: 'Referrer not found' });
    }
});

// GET global app configuration
app.get('/api/config', async (req, res) => {
    const configRef = ref(db, 'config');
    const snap = await get(configRef);
    res.json(snap.val() || {});
});

// POST (update) app configuration (Admin Only)
app.post('/api/config', isAdmin, async (req, res) => {
    const { newConfig } = req.body;
    await set(ref(db, 'config'), newConfig);
    res.send({ success: 'Configuration updated' });
});

// GET all bonus tasks
app.get('/api/tasks', async (req, res) => {
    const tasksRef = ref(db, 'bonusTasks');
    const snap = await get(tasksRef);
    res.json(snap.val() || {});
});

// POST (add/update) a bonus task (Admin Only)
app.post('/api/tasks', isAdmin, async (req, res) => {
    const { task } = req.body;
    const taskId = task.id || `task_${Date.now()}`;
    await set(ref(db, `bonusTasks/${taskId}`), { ...task, id: taskId });
    res.send({ success: 'Task saved' });
});

// DELETE a bonus task (Admin Only)
app.post('/api/tasks/delete', isAdmin, async (req, res) => {
    const { taskId } = req.body;
    if (!taskId) return res.status(400).send({ error: 'Task ID is required' });
    await remove(ref(db, `bonusTasks/${taskId}`));
    res.send({ success: 'Task deleted' });
});

// ============================
// 🚀 Start Server
// ============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
    console.log('🤖 Bot is active and polling...');
});
