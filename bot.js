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
        const newUser = {
            username: username, points: 0, adsWatchedToday: 0, totalAdsWatchedLifetime: 0,
            lastAdWatchDate: null, claimedBonuses: [], totalWithdrawn: 0, // Added totalWithdrawn
            referralCode: chatId.toString(), referredBy: referrerId || null,
            referredUsers: [], createdAt: new Date().toISOString()
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
    const { secret } = req.body;
    if (secret !== ADMIN_SECRET_KEY) return res.status(401).send({ error: 'Unauthorized' });
    next();
};

// --- General APIs ---
// These endpoints remain unchanged and are fully functional
app.get('/api/user/:userId', async (req, res) => { /* ... */ });
app.post('/api/user/:userId', async (req, res) => { /* ... */ });
app.get('/api/config', async (req, res) => { /* ... */ });
app.get('/api/tasks', async (req, res) => { /* ... */ });
app.get('/api/referrer/:userId', async (req, res) => { /* ... */ });
app.get('/api/leaderboard/:userId', async (req, res) => { /* ... */ });
app.post('/api/verify-membership', async (req, res) => { /* ... */ });

// --- Withdrawal API (Updated) ---
const escapeMarkdownV2 = (text) => text.toString().replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');

app.post('/api/request-withdrawal', async (req, res) => {
    // UPDATED to include accountName
    const { userId, amount, method, account, accountName } = req.body;
    const userSnap = await get(ref(db, `users/${userId}`));
    if (!userSnap.exists()) return res.status(404).send({ error: "User not found." });
    
    const user = userSnap.val();
    const config = (await get(ref(db, 'config'))).val() || {};
    const adminChatId = config.telegramChatId;
    if (!adminChatId) return res.status(500).send({ error: "Admin Chat ID not configured." });
    
    // UPDATED to include accountName in the message
    const message = `
🔔 *New Withdrawal Request* 🔔
*User:* ${escapeMarkdownV2(user.username)} \\(${escapeMarkdownV2(userId)}\\)
*Amount:* ${escapeMarkdownV2(amount)} ${escapeMarkdownV2(config.currencyName || 'Points')}
*Method:* ${escapeMarkdownV2(method)}
*Account Holder:* ${escapeMarkdownV2(accountName)}
*Wallet/Account:* \`${escapeMarkdownV2(account)}\`
*Remaining Balance:* ${user.points - amount}
*Total Ads:* ${user.totalAdsWatchedLifetime || 0}
    `;
    try {
        await bot.sendMessage(adminChatId, message, { parse_mode: 'MarkdownV2' });
        // UPDATED to track total withdrawn amount
        await update(ref(db, `users/${userId}`), {
            totalWithdrawn: (user.totalWithdrawn || 0) + amount
        });
        res.send({ success: true });
    } catch (error) {
        console.error("TELEGRAM SEND FAILED:", error.response?.body || error.message);
        res.status(500).send({ error: "Could not send notification to admin." });
    }
});

// --- Admin APIs (No changes needed) ---
app.post('/api/admin/config', isAdmin, async (req, res) => { /* ... */ });
app.post('/api/admin/tasks', isAdmin, async (req, res) => { /* ... */ });
app.post('/api/admin/tasks/delete', isAdmin, async (req, res) => { /* ... */ });
app.post('/api/admin/find-user', isAdmin, async (req, res) => { /* ... */ });
app.post('/api/admin/update-balance', isAdmin, async (req, res) => { /* ... */ });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server is running on http://localhost:${PORT}`));