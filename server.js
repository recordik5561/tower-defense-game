const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';
const bot = new TelegramBot(BOT_TOKEN, { polling: false }); // Используй webhook в проде

// Простое хранилище (в проде — SQLite / PostgreSQL / Mongo)
let scores = []; // { userId, name, score, date }
let progressData = {}; // userId -> { progress, username, firstName, updated }
let pendingOrders = {}; // orderId -> { userId, item, stars }

// Товары Stars
const SHOP = {
  gold100: { stars: 10, title: '+100 Золота', desc: '100 золота для башен' },
  gold500: { stars: 40, title: '+500 Золота', desc: '500 золота' },
  lives: { stars: 25, title: '+10 Жизней', desc: 'Дополнительные жизни' }
};

// --- Progress ---
app.get('/api/progress', (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'no userId' });
  const data = progressData[userId];
  res.json({ progress: data ? data.progress : null, username: data?.username });
});

app.post('/api/progress', (req, res) => {
  const { userId, username, firstName, progress } = req.body;
  if (!userId || !progress) return res.status(400).json({ error: 'bad data' });
  progressData[userId] = {
    progress,
    username: username || null,
    firstName: firstName || null,
    updated: new Date().toISOString()
  };
  res.json({ ok: true });
});

// --- Leaderboard ---
app.post('/api/score', (req, res) => {
  const { userId, name, score } = req.body;
  if (!userId || typeof score !== 'number') return res.status(400).json({ error: 'bad data' });
  const existing = scores.find(s => s.userId === userId);
  if (!existing || score > existing.score) {
    if (existing) existing.score = score;
    else scores.push({ userId, name: name || 'Игрок', score, date: new Date().toISOString() });
    scores.sort((a, b) => b.score - a.score);
    scores = scores.slice(0, 50);
  }
  res.json({ ok: true });
});

app.get('/api/leaderboard', (req, res) => {
  res.json(scores.slice(0, 10).map((s, i) => ({ rank: i+1, name: s.name, score: s.score })));
});

// --- Stars Invoice ---
app.post('/api/invoice', async (req, res) => {
  const { item, userId } = req.body;
  const product = SHOP[item];
  if (!product) return res.status(400).json({ error: 'unknown item' });

  const orderId = 'ord_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  pendingOrders[orderId] = { userId, item, stars: product.stars };

  try {
    const link = await bot.createInvoiceLink(
      product.title,
      product.desc,
      orderId,
      '', // provider_token пустой для XTR
      'XTR',
      [{ label: product.title, amount: product.stars }]
    );
    res.json({ link });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'invoice failed' });
  }
});

// Webhook для бота (настрой в BotFather / setWebhook)
app.post('/webhook', (req, res) => {
  const update = req.body;
  if (update.pre_checkout_query) {
    const orderId = update.pre_checkout_query.invoice_payload;
    const order = pendingOrders[orderId];
    if (order && order.stars === update.pre_checkout_query.total_amount) {
      bot.answerPreCheckoutQuery(update.pre_checkout_query.id, true);
    } else {
      bot.answerPreCheckoutQuery(update.pre_checkout_query.id, false, { error_message: 'Заказ не найден' });
    }
  }
  if (update.message && update.message.successful_payment) {
    const sp = update.message.successful_payment;
    const orderId = sp.invoice_payload;
    const order = pendingOrders[orderId];
    if (order) {
      // Здесь выдаём награду (в реальной игре — обновить золото/жизни пользователя в БД)
      console.log(`Оплата получена: user ${order.userId}, item ${order.item}, ${sp.total_amount} Stars`);
      // Можно отправить сообщение пользователю
      bot.sendMessage(order.userId, `Спасибо за покупку! ${SHOP[order.item]?.title || 'Награда'} выдана.`);
      delete pendingOrders[orderId];
    }
  }
  res.sendStatus(200);
});

app.get('/', (req, res) => res.send('Tower Defense Backend OK'));

app.listen(PORT, () => console.log(`Backend listening on ${PORT}`));
console.log('Не забудь: setWebhook на https://твой-домен/webhook и BOT_TOKEN в env');
