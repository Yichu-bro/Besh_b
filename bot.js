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
const BOT_TOKEN = process.env.BOT_TOKEN || '8200340976:AAHWfVE8MZkmCZMDfZZNopv55PTWsOlZtgU'; 
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const app = express();
app.use(express.json());
app.use(cors());

// ⚠️ IMPORTANT: Change this to a long, random, secure secret key
const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || "@Yichu2330@"; 

// ============================
// ➡️ Telegram Bot Logic (/start command)
// ============================
bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const username = msg.from.username || `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();
    const referrerId = match[1] ? match[1].replace('ref', '') : null;

    const userRef = ref(db, `users/${chatId}`);
    const snap = await get(userRef);

    const configSnap = await get(ref(db, 'config'));
    const config = configSnap.val() || {};

    if (!snap.exists()) {
        const refereeBonus = config.referralBonusReferee || 500;
        const referrerBonus = config.referralBonusReferrer || 400;

        const newUser = {
            username: username,
            points: 0,
            adsWatchedToday: 0,
            totalAdsWatchedLifetime: 0,
            lastAdWatchDate: null,
            claimedBonuses: [],
            referralCode: chatId.toString(),
            referredBy: referrerId || null,
            referredUsers: [],
            createdAt: new Date().toISOString()
        };

        if (referrerId && referrerId !== chatId.toString()) {
            newUser.points += refereeBonus;
            const referrerRef = ref(db, `users/${referrerId}`);
            const referrerSnap = await get(referrerRef);
            if (referrerSnap.exists()) {
                const referrerData = referrerSnap.val();
                await update(referrerRef, {
                    points: (referrerData.points || 0) + referrerBonus,
                    referredUsers: [...(referrerData.referredUsers || []), chatId.toString()]
                });
                bot.sendMessage(referrerId, `🎉 Congratulations! ${username} joined using your link. You've earned ${referrerBonus} points!`);
            }
        }
        await set(userRef, newUser);
    }

    const webAppUrl = config.webAppUrl || 'https://yichu-bro.github.io/Besh_Fr/Index.html#';
    const imageUrl = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSnS33eug2iIG3WtWvf2C_xpTxvxGGVY2xHfhMJr9XP-w&s=10';
    const caption = `<b>Welcome to Tag2Cash, ${username}!</b>\n\nTap the button below to launch the app and start earning.\n\n now`;
    const buttonText = '🚀 Launch App';

    await bot.sendPhoto(chatId, imageUrl, {
        caption: caption,
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [[{ text: buttonText, web_app: { url: `${webAppUrl}?userId=${chatId}` } }]]
        }
    });
});

// ============================
// 📡 API for Mini App & Admin Panel
// ============================
const isAdmin = (req, res, next) => {
    const { secret } = req.body;
    if (secret !== ADMIN_SECRET_KEY) return res.status(401).send({ error: 'Unauthorized' });
    next();
};

app.get('/api/user/:userId', async (req, res) => {
    const userRef = ref(db, `users/${req.params.userId}`);
    const snap = await get(userRef);
    if (snap.exists()) res.json(snap.val());
    else res.status(404).send({ error: 'User not found. Please /start the bot.' });
});

app.post('/api/user/:userId', async (req, res) => {
    await set(ref(db, `users/${req.params.userId}`), req.body);
    res.send({ success: 'User data updated' });
});

app.get('/api/referrer/:userId', async (req, res) => {
    const snap = await get(ref(db, `users/${req.params.userId}`));
    if (snap.exists()) res.json({ username: snap.val().username });
    else res.status(404).send({ error: 'Referrer not found' });
});

app.get('/api/config', async (req, res) => {
    res.json((await get(ref(db, 'config'))).val() || {});
});

app.post('/api/config', isAdmin, async (req, res) => {
    await set(ref(db, 'config'), req.body.newConfig);
    res.send({ success: 'Configuration updated' });
});

app.get('/api/tasks', async (req, res) => {
    res.json((await get(ref(db, 'bonusTasks'))).val() || {});
});

app.post('/api/tasks', isAdmin, async (req, res) => {
    const { task } = req.body;
    const taskId = task.id || `task_${Date.now()}`;
    await set(ref(db, `bonusTasks/${taskId}`), { ...task, id: taskId });
    res.send({ success: 'Task saved' });
});

app.post('/api/tasks/delete', isAdmin, async (req, res) => {
    if (!req.body.taskId) return res.status(400).send({ error: 'Task ID is required' });
    await remove(ref(db, `bonusTasks/${req.body.taskId}`));
    res.send({ success: 'Task deleted' });
});

// New endpoint for withdrawal requests
app.post('/api/request-withdrawal', async (req, res) => {
    const { userId, amount, method, account, userPoints, totalAds } = req.body;
    
    const userSnap = await get(ref(db, `users/${userId}`));
    if (!userSnap.exists()) return res.status(404).send({ error: "User not found." });
    const user = userSnap.val();

    const configSnap = await get(ref(db, 'config'));
    const config = configSnap.val() || {};
    const adminChatId = config.telegramChatId;

    if (!adminChatId) {
        console.error("Admin TELEGRAM_CHAT_ID is not configured in the admin panel.");
        return res.status(500).send({ error: "Server configuration error." });
    }

    const message = `
🔔 *New Withdrawal Request* 🔔
------------------------------------
*User:* ${user.username} (${userId})
*Points to Withdraw:* ${amount}
*Payment Method:* ${method}
*Wallet/Account:* \`${account}\`
------------------------------------
*Remaining Balance:* ${userPoints}
*Total Ads Watched:* ${totalAds}
------------------------------------
*Time:* ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}
    `;

    try {
        await bot.sendMessage(adminChatId, message, { parse_mode: 'Markdown' });
        res.send({ success: "Withdrawal request submitted." });
    } catch (error) {
        console.error("Failed to send withdrawal notification:", error);
        res.status(500).send({ error: "Could not send notification." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
    console.log('🤖 Bot is active and polling...');
});