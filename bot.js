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
const BOT_TOKEN = process.env.BOT_TOKEN || '8200340976:AAHOoyUjDWh49GSNZIcPxzBAjY1VtNybeAk'; 
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const app = express();
app.use(express.json());
app.use(cors());

const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || "@Yichu2330@"; 

// ============================
// ➡️ Telegram Bot Logic
// ============================
bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const username = msg.from.username ? `@${msg.from.username}` : `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();
    const referrerId = match[1] ? match[1].replace('ref', '') : null;
    const userRef = ref(db, `users/${chatId}`);
    const snap = await get(userRef);
    const configSnap = await get(ref(db, 'config'));
    const config = configSnap.val() || {};

    if (!snap.exists()) {
        const newUser = {
            username: username,
            name: `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim(),
            points: 0,
            adsWatchedToday: 0,
            totalAdsWatchedLifetime: 0,
            lastAdWatchDate: null,
            claimedBonuses: [],
            totalWithdrawn: 0,
            referralCode: chatId.toString(),
            referredBy: referrerId || null,
            referredUsers: [],
            createdAt: new Date().toISOString()
        };
        if (referrerId && referrerId !== chatId.toString()) {
            newUser.points += (config.referralBonusReferee || 0);
            const referrerRef = ref(db, `users/${referrerId}`);
            const referrerSnap = await get(referrerRef);
            if (referrerSnap.exists()) {
                const rData = referrerSnap.val();
                await update(referrerRef, {
                    points: (rData.points || 0) + (config.referralBonusReferrer || 0),
                    referredUsers: [...(rData.referredUsers || []), chatId.toString()]
                });
                bot.sendMessage(referrerId, `🎉 ${username} joined using your link! You've earned ${config.referralBonusReferrer || 0} ${config.currencyName || 'Points'}!`);
            }
        }
        await set(userRef, newUser);
    }

    const webAppUrl = config.webAppUrl || 'https://yichu-bro.github.io/Besh_Fr/Index.html';
    const imageUrl = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQiAtmulOWYor1qCUwUT3fHFlRNzklasnKneg&s';
    const caption = `<b>Welcome to Tag2Cash, ${username}!</b>\n\nTap the button below to launch the app and start earning.`;
    const buttonText = '🚀 Launch App';
    await bot.sendPhoto(chatId, imageUrl, {
        caption: caption, parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: buttonText, web_app: { url: `${webAppUrl}?userId=${chatId}` } }]] }
    });
});

// ============================
// 📡 API Endpoints
// ============================
const isAdmin = (req, res, next) => {
    if (req.body.secret !== ADMIN_SECRET_KEY) return res.status(401).send({ error: 'Unauthorized' });
    next();
};

const escapeMarkdownV2 = (text) => {
    const toEscape = '_*[]()~`>#+-=|{}.!';
    return text.replace(new RegExp(`[${toEscape.replace(/\\/g, '\\\\')}]`, 'g'), '\\$&');
};

// --- User-facing APIs ---
app.get('/api/user/:userId', async (req, res) => {
    const snap = await get(ref(db, `users/${req.params.userId}`));
    if (snap.exists()) res.json(snap.val());
    else res.status(404).send({ error: 'User not found. Please /start the bot.' });
});

app.post('/api/user/:userId', async (req, res) => {
    await set(ref(db, `users/${req.params.userId}`), req.body);
    res.send({ success: true });
});

app.get('/api/config', async (req, res) => res.json((await get(ref(db, 'config'))).val() || {}));
app.get('/api/tasks', async (req, res) => res.json((await get(ref(db, 'bonusTasks'))).val() || {}));

app.get('/api/leaderboard', async (req, res) => {
    const usersSnap = await get(ref(db, 'users'));
    if (!usersSnap.exists()) return res.json({ byPoints: [], byReferrals: [] });
    const users = Object.entries(usersSnap.val()).map(([id, data]) => ({
        id, username: data.username, name: data.name,
        points: data.points || 0,
        referrals: data.referredUsers?.length || 0
    }));
    const byPoints = [...users].sort((a, b) => b.points - a.points).slice(0, 100);
    const byReferrals = [...users].sort((a, b) => b.referrals - a.referrals).slice(0, 100);
    res.json({ byPoints, byReferrals });
});

app.post('/api/verify-membership', async (req, res) => {
    const { userId, taskId, channelId, reward } = req.body;
    if (!userId || !taskId || !channelId || !reward) return res.status(400).send({ error: "Missing required fields." });
    try {
        const member = await bot.getChatMember(channelId, userId);
        if (['creator', 'administrator', 'member'].includes(member.status)) {
            const userRef = ref(db, `users/${userId}`);
            const userSnap = await get(userRef);
            if (userSnap.exists()) {
                const userData = userSnap.val();
                if (userData.claimedBonuses?.includes(taskId)) return res.status(400).send({ error: "Bonus already claimed." });
                const newPoints = (userData.points || 0) + reward;
                const newBonuses = [...(userData.claimedBonuses || []), taskId];
                await update(userRef, { points: newPoints, claimedBonuses: newBonuses });
                res.send({ success: true, points: newPoints });
            } else res.status(404).send({ error: "User not found." });
        } else res.status(403).send({ error: "You must join the channel to claim." });
    } catch (error) {
        console.error("Membership check failed:", error.response?.body?.description || error.message);
        res.status(500).send({ error: "Verification failed. The bot must be an admin in the channel." });
    }
});

app.post('/api/request-withdrawal', async (req, res) => {
    const { userId, amount, method, account } = req.body;
    const userSnap = await get(ref(db, `users/${userId}`));
    if (!userSnap.exists()) return res.status(404).send({ error: "User not found." });
    const user = userSnap.val();

    const config = (await get(ref(db, 'config'))).val() || {};
    const adminChatId = config.telegramChatId;
    if (!adminChatId) return res.status(500).send({ error: "Server configuration error." });
    
    const message = `
🔔 *New Withdrawal Request* 🔔
\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_
*User:* ${escapeMarkdownV2(user.username || user.name)} \\(ID: \`${userId}\`\\)
*Amount:* ${amount} ${escapeMarkdownV2(config.currencyName || 'Points')}
*Method:* ${escapeMarkdownV2(method)}
*Wallet/Account:* \`${escapeMarkdownV2(account)}\`
\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_
*Remaining Balance:* ${user.points - amount}
*Total Ads Watched:* ${user.totalAdsWatchedLifetime || 0}
\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_
*Time:* ${escapeMarkdownV2(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' }))}
    `;

    try {
        await bot.sendMessage(adminChatId, message, { parse_mode: 'MarkdownV2' });
        await update(ref(db, `users/${userId}`), {
            points: user.points - amount,
            totalWithdrawn: (user.totalWithdrawn || 0) + amount
        });
        res.send({ success: "Withdrawal request submitted." });
    } catch (error) {
        console.error("Failed to send withdrawal notification:", error.response?.body);
        res.status(500).send({ error: "Could not send notification to admin." });
    }
});

// --- Admin APIs (unchanged from before) ---
app.post('/api/admin/config', isAdmin, async (req, res) => { /* ... */ });
app.post('/api/admin/tasks', isAdmin, async (req, res) => { /* ... */ });
app.post('/api/admin/tasks/delete', isAdmin, async (req, res) => { /* ... */ });
app.post('/api/admin/find-user', isAdmin, async (req, res) => { /* ... */ });
app.post('/api/admin/update-balance', isAdmin, async (req, res) => { /* ... */ });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server is running on http://localhost:${PORT}`));