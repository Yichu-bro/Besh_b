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
            lastAdWatchDate: null, claimedBonuses: [], totalWithdrawn: 0,
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
app.get('/api/referrer/:userId', async (req, res) => {
    const snap = await get(ref(db, `users/${req.params.userId}`));
    if (snap.exists()) res.json({ username: snap.val().username });
    else res.status(404).send({ error: 'Referrer not found' });
});

// --- Leaderboard API ---
app.get('/api/leaderboard/:userId', async (req, res) => {
    const currentUserId = req.params.userId;
    const usersSnap = await get(ref(db, 'users'));
    if (!usersSnap.exists()) return res.json({ byPoints: [], byReferrals: [], currentUserRank: null });
    const users = Object.entries(usersSnap.val()).map(([id, data]) => ({
        id, username: data.username, points: data.points || 0,
        referrals: data.referredUsers?.length || 0
    }));
    const sortedByPoints = [...users].sort((a, b) => b.points - a.points);
    const sortedByReferrals = [...users].sort((a, b) => b.referrals - a.referrals);
    const findRank = (arr, id) => arr.findIndex(u => u.id === id) + 1;
    res.json({
        byPoints: sortedByPoints.slice(0, 100), byReferrals: sortedByReferrals.slice(0, 100),
        currentUserRank: {
            points: findRank(sortedByPoints, currentUserId) || '100+',
            referrals: findRank(sortedByReferrals, currentUserId) || '100+'
        }
    });
});

// --- Membership Verification API ---
app.post('/api/verify-membership', async (req, res) => {
    const { userId, taskId, channelId, reward } = req.body;
    try {
        const member = await bot.getChatMember(channelId, userId);
        if (['creator', 'administrator', 'member'].includes(member.status)) {
            const userRef = ref(db, `users/${userId}`);
            const userSnap = await get(userRef);
            if (userSnap.exists()) {
                const userData = userSnap.val();
                if (userData.claimedBonuses?.includes(taskId)) return res.status(400).send({ error: "Bonus already claimed." });
                await update(userRef, {
                    points: (userData.points || 0) + reward,
                    claimedBonuses: [...(userData.claimedBonuses || []), taskId]
                });
                res.send({ success: true, points: (userData.points || 0) + reward });
            } else res.status(404).send({ error: "User not found." });
        } else res.status(403).send({ error: "You must be a member of the channel." });
    } catch (error) {
        res.status(500).send({ error: "Verification failed. Bot must be an admin in the channel." });
    }
});

// --- Withdrawal API ---
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
        await update(ref(db, `users/${userId}`), { totalWithdrawn: (user.totalWithdrawn || 0) + amount });
        res.send({ success: true });
    } catch (error) {
        console.error("TELEGRAM SEND FAILED:", error.response?.body || error.message);
        res.status(500).send({ error: "Could not send notification to admin." });
    }
});

// --- Admin APIs (No changes needed) ---
app.post('/api/admin/config', isAdmin, async (req, res) => { await set(ref(db, 'config'), req.body.newConfig); res.send({ success: true }); });
app.post('/api/admin/tasks', isAdmin, async (req, res) => { const { task } = req.body; const taskId = task.id || `task_${Date.now()}`; await set(ref(db, `bonusTasks/${taskId}`), { ...task, id: taskId }); res.send({ success: true }); });
app.post('/api/admin/tasks/delete', isAdmin, async (req, res) => { await remove(ref(db, `bonusTasks/${req.body.taskId}`)); res.send({ success: true }); });
app.post('/api/admin/find-user', isAdmin, async (req, res) => { const userSnap = await get(ref(db, `users/${req.body.userId}`)); if (userSnap.exists()) res.send(userSnap.val()); else res.status(404).send({ error: 'User not found' }); });
app.post('/api/admin/update-balance', isAdmin, async (req, res) => { const { userId, newBalance } = req.body; if (isNaN(newBalance)) return res.status(400).send({ error: 'Invalid balance' }); await update(ref(db, `users/${userId}`), { points: Number(newBalance) }); res.send({ success: true }); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server is running on http://localhost:${PORT}`));