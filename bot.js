require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('BOT_TOKEN .env faylda topilmadi!');
  process.exit(1);
}
const bot = new TelegramBot(token, { polling: true });

console.log('HAYBAT-PRO v2.1 ishga tushdi...');

// =====================================================
// MA'LUMOTLAR (data.json)
// =====================================================
const DATA_FILE = path.join(__dirname, 'data.json');

function yuklash() {
  try {
    if (!fs.existsSync(DATA_FILE)) return { users: {} };
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    console.error('yuklash xato:', err.message);
    return { users: {} };
  }
}

function saqlash(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('saqlash xato:', err.message);
  }
}

function foydalanuvchi(chatId) {
  const data = yuklash();
  if (!data.users[chatId]) {
    data.users[chatId] = {
      tasks: [],
      history: [],
      streak: 0,
      jazoBalli: 0,
      mukofotBalli: 0,
      oxirgiKun: null,
      expenses: []
    };
    saqlash(data);
  } else if (!data.users[chatId].expenses) {
    // Eski foydalanuvchilar uchun migratsiya
    data.users[chatId].expenses = [];
    saqlash(data);
  }
  return data;
}

// Unique id generator
let _idCounter = 0;
function yangiId() {
  _idCounter += 1;
  return `${Date.now()}_${_idCounter}`;
}

// Vazifani id bo'yicha topish
function topTask(u, id) {
  return u.tasks.findIndex(t => t.id === id);
}

// =====================================================
// YORDAMCHI FUNKSIYALAR
// =====================================================
function bugunSana() {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Tashkent'
  });
}

function hozirVaqt() {
  return new Date().toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Tashkent',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function darajaEmoji(d) {
  return d === 'oson' ? '🟢' : d === 'orta' ? '🟡' : '🔴';
}

function darajaBall(d) {
  return d === 'oson' ? 1 : d === 'orta' ? 3 : 5;
}

function jazoMatni(ball) {
  if (ball === 0) return '🎉 Mukammal! Hech qanday jazo yo\'q!';
  if (ball <= 3) return `💪 Ertaga: 20 ta otjimaniya / squat`;
  if (ball <= 7) return `🔥 Ertaga: 50 ta otjimaniya + 1 soat sport + shirinlik yo'q`;
  return `💀 Ertaga: 100 ta squat + 5000 so'm xayriya + telefon 4 soat yopiq`;
}

function mukofotMatni(foiz, ball) {
  if (foiz === 100) return `🏆 MUKAMMAL KUN! +${ball} mukofot balli!`;
  if (foiz >= 80) return `🌟 Ajoyib kun! +${ball} mukofot balli!`;
  if (foiz >= 50) return `👍 Yaxshi! +${ball} mukofot balli!`;
  return '';
}

function vaqtTekshir(vaqt) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(vaqt);
}

// =====================================================
// XARAJAT YORDAMCHILARI
// =====================================================
const XARAJAT_KATEGORIYA = {
  ovqat:     { emoji: '🍔', nom: 'Ovqat' },
  transport: { emoji: '🚌', nom: 'Transport' },
  xarid:     { emoji: '🛒', nom: 'Xarid' },
  uy:        { emoji: '🏠', nom: 'Uy (kommunal)' },
  oyin:      { emoji: '🎮', nom: 'O\'yin-kulgi' },
  soglik:    { emoji: '💊', nom: 'Sog\'liq' },
  talim:     { emoji: '📚', nom: 'Ta\'lim' },
  kiyim:     { emoji: '👕', nom: 'Kiyim' },
  aloqa:     { emoji: '📱', nom: 'Aloqa/internet' },
  boshqa:    { emoji: '🎁', nom: 'Boshqa' }
};

function katEmoji(k) {
  return XARAJAT_KATEGORIYA[k] ? XARAJAT_KATEGORIYA[k].emoji : '💵';
}

function katNom(k) {
  return XARAJAT_KATEGORIYA[k] ? XARAJAT_KATEGORIYA[k].nom : k;
}

// 50000 → "50 000 so'm"
function formatPul(n) {
  const num = Math.round(Number(n) || 0);
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' so\'m';
}

// Faqat raqam kiritilganini tekshirish (1000, 50.5, 50000)
function summaTekshir(s) {
  const v = String(s).replace(/[\s,]/g, '');
  return /^\d+(\.\d{1,2})?$/.test(v) && Number(v) > 0 ? Number(v) : null;
}

// YYYY-MM-DD → Date (Tashkent kuni boshi)
function sanaParse(s) {
  return new Date(s + 'T00:00:00');
}

// N kun oldingi sanalar ro'yxati (bugun bilan)
function ohirgiNKun(n) {
  const sanalar = [];
  const bugun = new Date(bugunSana() + 'T00:00:00');
  for (let i = 0; i < n; i++) {
    const d = new Date(bugun);
    d.setDate(d.getDate() - i);
    sanalar.push(d.toISOString().slice(0, 10));
  }
  return sanalar;
}

// Bu oyning birinchi kuni — YYYY-MM-DD
function oyBoshi() {
  const bugun = new Date(bugunSana() + 'T00:00:00');
  return `${bugun.getFullYear()}-${String(bugun.getMonth() + 1).padStart(2, '0')}-01`;
}

// Markdown maxsus belgilarini escape qilish
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/([_*\[\]()`~>#+\-=|{}.!\\])/g, '\\$1');
}

// Xavfsiz xabar yuborish (xato bo'lsa ham crash bo'lmasin)
async function sendSafe(chatId, text, opts = {}) {
  try {
    return await bot.sendMessage(chatId, text, opts);
  } catch (err) {
    console.error(`sendMessage xato (chatId=${chatId}):`, err.message);
    // Markdown xatosi bo'lsa, plain text bilan urinib ko'rish
    if (opts.parse_mode && /can't parse|parse entities/i.test(err.message)) {
      try {
        const { parse_mode, ...rest } = opts;
        return await bot.sendMessage(chatId, text, rest);
      } catch (err2) {
        console.error('Fallback xato:', err2.message);
      }
    }
    return null;
  }
}

// =====================================================
// MENYULAR
// =====================================================
function asosiyMenyu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '➕ Vazifa qo\'shish', callback_data: 'add' },
          { text: '📝 Bugungi vazifalar', callback_data: 'list' }
        ],
        [
          { text: '📊 Statistika', callback_data: 'stats' },
          { text: '🔥 Jazo holati', callback_data: 'jazo' }
        ],
        [
          { text: '🏆 Mukofot do\'koni', callback_data: 'shop' },
          { text: '⚡ Streak', callback_data: 'streak' }
        ],
        [
          { text: '💰 Xarajatlar', callback_data: 'expenses' }
        ],
        [
          { text: '🗑 Hammasini tozalash', callback_data: 'clear' },
          { text: '❓ Yordam', callback_data: 'help' }
        ]
      ]
    }
  };
}

function xarajatMenyu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '➕ Xarajat qo\'shish', callback_data: 'exp_add' },
          { text: '📝 Bugungilari', callback_data: 'exp_list' }
        ],
        [
          { text: '📅 Haftalik', callback_data: 'exp_week' },
          { text: '📆 Oylik', callback_data: 'exp_month' }
        ],
        [
          { text: '🏷 Kategoriya bo\'yicha', callback_data: 'exp_cats' }
        ],
        [
          { text: '🗑 Bugungilarini tozalash', callback_data: 'exp_clear' }
        ],
        [
          { text: '🔙 Asosiy menyu', callback_data: 'menu' }
        ]
      ]
    }
  };
}

// =====================================================
// FOYDALANUVCHI HOLATI (vazifa qo'shish jarayoni)
// =====================================================
const userState = {};

// =====================================================
// /start BUYRUG'I
// =====================================================
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const name = msg.from.first_name || 'do\'st';
  foydalanuvchi(chatId);
  delete userState[chatId];

  const xush = `🔥 Salom, *${esc(name)}*\\!\n\n` +
    `Men *HAYBAT\\-PRO* botiman\\.\n` +
    `Sizning hayotingizni tartibga solaman\\!\n\n` +
    `📋 *Imkoniyatlar:*\n` +
    `• Vaqtli vazifalar qo'shish\n` +
    `• 5 daqiqa oldin eslatma\n` +
    `• Vaqt tugaganda tekshirish\n` +
    `• Jazo va mukofot tizimi\n\n` +
    `🟢 Oson — 1 ball\n` +
    `🟡 O'rta — 3 ball\n` +
    `🔴 Muhim — 5 ball\n\n` +
    `Boshlash uchun tugmani bosing:`;

  sendSafe(chatId, xush, {
    parse_mode: 'MarkdownV2',
    ...asosiyMenyu()
  });
});

bot.onText(/\/menu/, (msg) => {
  delete userState[msg.chat.id];
  sendSafe(msg.chat.id, '📋 *Asosiy menyu:*', {
    parse_mode: 'Markdown',
    ...asosiyMenyu()
  });
});

// =====================================================
// YAGONA CALLBACK_QUERY HANDLER
// =====================================================
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  // Har doim javob beramiz — "yuklanmoqda" indikatori qotib qolmasin
  try { await bot.answerCallbackQuery(query.id); } catch (e) {}

  try {
    // Menyu
    if (data === 'menu') {
      delete userState[chatId];
      await sendSafe(chatId, '📋 *Asosiy menyu:*', {
        parse_mode: 'Markdown',
        ...asosiyMenyu()
      });
    }

    // Vazifa qo'shish — daraja tanlash
    else if (data === 'add') {
      await sendSafe(chatId, '📌 Vazifa darajasini tanlang:', {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🟢 Oson (1 ball)', callback_data: 'lvl_oson' },
              { text: '🟡 O\'rta (3 ball)', callback_data: 'lvl_orta' }
            ],
            [
              { text: '🔴 Muhim (5 ball)', callback_data: 'lvl_muhim' }
            ],
            [{ text: '🔙 Bekor qilish', callback_data: 'menu' }]
          ]
        }
      });
    }

    // Daraja tanlandi — nom so'rash
    else if (data.startsWith('lvl_')) {
      const daraja = data.replace('lvl_', '');
      userState[chatId] = { step: 'name', daraja: daraja };
      await sendSafe(chatId,
        `${darajaEmoji(daraja)} Vazifa nomini yozing:\n\n` +
        `_Masalan: Dars qilish, Sport, Kitob o'qish_`,
        { parse_mode: 'Markdown' }
      );
    }

    // Vazifalar ro'yxati
    else if (data === 'list') {
      const all = yuklash();
      const u = all.users[chatId];

      if (!u || !u.tasks || u.tasks.length === 0) {
        await sendSafe(chatId, '📭 Bugun vazifa yo\'q!\n\nVazifa qo\'shish uchun tugmani bosing:', asosiyMenyu());
        return;
      }

      let msg = `📝 *Bugungi vazifalar*\n\n`;
      const keyboard = [];

      u.tasks.forEach((t, i) => {
        const belgi = t.done ? '✅' : t.failed ? '❌' : '⬜';
        msg += `${i + 1}. ${belgi} ${darajaEmoji(t.daraja)} *${esc(t.name)}*\n`;
        msg += `   ⏰ ${t.start} \\- ${t.end} \\(${darajaBall(t.daraja)} ball\\)\n\n`;

        if (!t.done && !t.failed) {
          keyboard.push([
            { text: `✅ ${i + 1}-ni bajardim`, callback_data: `done_${t.id}` },
            { text: `🗑 ${i + 1}-ni o'chir`, callback_data: `del_${t.id}` }
          ]);
        }
      });

      keyboard.push([{ text: '🔙 Menyu', callback_data: 'menu' }]);

      await sendSafe(chatId, msg, {
        parse_mode: 'MarkdownV2',
        reply_markup: { inline_keyboard: keyboard }
      });
    }

    // Bajarildi
    else if (data.startsWith('done_')) {
      const id = data.replace('done_', '');
      const all = yuklash();
      const u = all.users[chatId];
      if (!u) return;
      const idx = topTask(u, id);

      if (idx >= 0 && !u.tasks[idx].done && !u.tasks[idx].failed) {
        u.tasks[idx].done = true;
        saqlash(all);
        await sendSafe(chatId,
          `✅ *${esc(u.tasks[idx].name)}* — bajarildi\\!\n🎉 Zo'rsiz\\!`,
          { parse_mode: 'MarkdownV2' }
        );
      }
    }

    // Bajarilmagan (fail) — endi bitta handlerda
    else if (data.startsWith('fail_')) {
      const id = data.replace('fail_', '');
      const all = yuklash();
      const u = all.users[chatId];
      if (!u) return;
      const idx = topTask(u, id);

      if (idx >= 0 && !u.tasks[idx].failed && !u.tasks[idx].done) {
        u.tasks[idx].failed = true;
        const ball = darajaBall(u.tasks[idx].daraja);
        u.jazoBalli += ball;
        saqlash(all);
        await sendSafe(chatId,
          `❌ *${esc(u.tasks[idx].name)}* bajarilmadi\\!\n\n` +
          `💀 Jazo: \\+${ball} ball\n` +
          `🔥 Jami: ${u.jazoBalli} ball`,
          { parse_mode: 'MarkdownV2' }
        );
      }
    }

    // O'chirish
    else if (data.startsWith('del_')) {
      const id = data.replace('del_', '');
      const all = yuklash();
      const u = all.users[chatId];
      if (!u) return;
      const idx = topTask(u, id);

      if (idx >= 0) {
        const name = u.tasks[idx].name;
        u.tasks.splice(idx, 1);
        saqlash(all);
        await sendSafe(chatId, `🗑 "${name}" o'chirildi`);
      }
    }

    // Statistika
    else if (data === 'stats') {
      const all = yuklash();
      const u = all.users[chatId] || foydalanuvchi(chatId).users[chatId];

      const bugun = u.tasks.length;
      const bajarilgan = u.tasks.filter(t => t.done).length;
      const foiz = bugun > 0 ? Math.round((bajarilgan / bugun) * 100) : 0;

      const oxirgi7 = u.history.slice(-7);
      const haftalik = oxirgi7.reduce((a, b) => a + (b.completed || 0), 0);
      const haftalikJami = oxirgi7.reduce((a, b) => a + (b.total || 0), 0);

      const msg = `📊 *STATISTIKA*\n\n` +
        `📅 *Bugun:*\n` +
        `  Jami: ${bugun}\n` +
        `  Bajarildi: ${bajarilgan}\n` +
        `  Foiz: *${foiz}%*\n\n` +
        `📆 *So'nggi 7 kun:*\n` +
        `  ${haftalik}/${haftalikJami} bajarilgan\n\n` +
        `⚡ Streak: *${u.streak} kun*\n` +
        `🔥 Jazo ballari: *${u.jazoBalli}*\n` +
        `🏆 Mukofot ballari: *${u.mukofotBalli}*`;

      await sendSafe(chatId, msg, {
        parse_mode: 'Markdown',
        ...asosiyMenyu()
      });
    }

    // Jazo holati
    else if (data === 'jazo') {
      const all = yuklash();
      const u = all.users[chatId] || foydalanuvchi(chatId).users[chatId];

      const bajarilmagan = u.tasks.filter(t => !t.done && !t.failed);
      const ball = bajarilmagan.reduce((s, t) => s + darajaBall(t.daraja), 0);

      let msg = `🔥 *JAZO HOLATI*\n\n`;
      msg += `Bajarilmagan: *${bajarilmagan.length} ta*\n`;
      msg += `Hozirgi ball: *${ball}*\n\n`;

      if (bajarilmagan.length > 0) {
        msg += `*Bajarilmaganlar:*\n`;
        bajarilmagan.forEach(t => {
          msg += `  ${darajaEmoji(t.daraja)} ${t.name} (${darajaBall(t.daraja)} ball)\n`;
        });
        msg += `\n⚠️ *Bugun tugasa:*\n${jazoMatni(ball)}`;
      } else {
        msg += `🎉 Hammasi bajarilgan! Jazo yo'q!`;
      }

      msg += `\n\n💀 Jami jazo ballari: *${u.jazoBalli}*`;

      await sendSafe(chatId, msg, {
        parse_mode: 'Markdown',
        ...asosiyMenyu()
      });
    }

    // Mukofot do'koni
    else if (data === 'shop') {
      const all = yuklash();
      const u = all.users[chatId] || foydalanuvchi(chatId).users[chatId];

      const msg = `🏆 *MUKOFOT DO'KONI*\n\n` +
        `Sizning ballaringiz: *${u.mukofotBalli}*\n\n` +
        `*Sotib olish mumkin:*\n` +
        `🍫 50 ball — Shirinlik\n` +
        `🎬 100 ball — Kino\n` +
        `🍔 200 ball — Restoran\n` +
        `🎁 500 ball — Katta sovg'a\n` +
        `✈️ 1000 ball — Sayohat\n\n` +
        `_Mukofot olganda menga ayting, ballarni minus qilaman!_`;

      await sendSafe(chatId, msg, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🍫 50', callback_data: 'buy_50' },
              { text: '🎬 100', callback_data: 'buy_100' }
            ],
            [
              { text: '🍔 200', callback_data: 'buy_200' },
              { text: '🎁 500', callback_data: 'buy_500' }
            ],
            [{ text: '✈️ 1000', callback_data: 'buy_1000' }],
            [{ text: '🔙 Menyu', callback_data: 'menu' }]
          ]
        }
      });
    }

    // Mukofot sotib olish
    else if (data.startsWith('buy_')) {
      const narx = parseInt(data.replace('buy_', ''));
      const all = yuklash();
      const u = all.users[chatId];
      if (!u) return;

      if (u.mukofotBalli >= narx) {
        u.mukofotBalli -= narx;
        saqlash(all);
        await sendSafe(chatId,
          `🎉 *Tabriklaymiz!*\n\n` +
          `Siz ${narx} ball evaziga mukofot sotib oldingiz!\n` +
          `Qolgan ballaringiz: *${u.mukofotBalli}*\n\n` +
          `_Endi haqiqatda o'zingizga sovg'a qiling!_ 🎁`,
          { parse_mode: 'Markdown' }
        );
      } else {
        await sendSafe(chatId,
          `❌ Ballaringiz yetarli emas!\n\n` +
          `Kerak: *${narx}* ball\n` +
          `Sizda: *${u.mukofotBalli}* ball\n` +
          `Kerakli: *${narx - u.mukofotBalli}* ball ko'proq`,
          { parse_mode: 'Markdown' }
        );
      }
    }

    // Streak
    else if (data === 'streak') {
      const all = yuklash();
      const u = all.users[chatId] || foydalanuvchi(chatId).users[chatId];

      let msg = `⚡ *STREAK: ${u.streak} kun*\n\n`;

      if (u.streak === 0) msg += `Hali boshlamadingiz. Bugundan boshlang! 💪`;
      else if (u.streak < 3) msg += `Yaxshi boshlanish! Davom eting!`;
      else if (u.streak < 7) msg += `🔥 Zo'rsiz! 7 kunga yetkazing!`;
      else if (u.streak < 14) msg += `🌟 7 kun! Endi 14 kunga!`;
      else if (u.streak < 30) msg += `💎 Sizga gap yo'q!`;
      else msg += `👑 SIZ AFSONASIZ! ${u.streak} kun!`;

      msg += `\n\n🎯 *Maqsadlar:*\n`;
      msg += `  ${u.streak >= 3 ? '✅' : '⬜'} 3 kun (+15 ball)\n`;
      msg += `  ${u.streak >= 7 ? '✅' : '⬜'} 7 kun (🎁 sovg'a)\n`;
      msg += `  ${u.streak >= 14 ? '✅' : '⬜'} 14 kun (🎁 katta sovg'a)\n`;
      msg += `  ${u.streak >= 30 ? '✅' : '⬜'} 30 kun (🏆 MUKAMMAL)`;

      await sendSafe(chatId, msg, {
        parse_mode: 'Markdown',
        ...asosiyMenyu()
      });
    }

    // Hammasini tozalash
    else if (data === 'clear') {
      await sendSafe(chatId,
        '⚠️ *Bugungi vazifalarni tozalashga aminmisiz?*',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Ha', callback_data: 'clear_yes' },
              { text: '❌ Yo\'q', callback_data: 'menu' }
            ]]
          }
        }
      );
    }
    else if (data === 'clear_yes') {
      const all = yuklash();
      if (all.users[chatId]) {
        all.users[chatId].tasks = [];
        saqlash(all);
      }
      await sendSafe(chatId, '🗑 Bugungi barcha vazifalar tozalandi!', asosiyMenyu());
    }

    // =====================================================
    // XARAJATLAR
    // =====================================================
    else if (data === 'expenses') {
      foydalanuvchi(chatId);
      const all = yuklash();
      const u = all.users[chatId];
      const bugun = bugunSana();
      const bugungi = (u.expenses || []).filter(e => e.date === bugun);
      const bugunJami = bugungi.reduce((s, e) => s + e.amount, 0);

      const oy = bugunSana().slice(0, 7); // YYYY-MM
      const oylik = (u.expenses || []).filter(e => e.date.startsWith(oy));
      const oyJami = oylik.reduce((s, e) => s + e.amount, 0);

      const msg = `💰 *XARAJATLAR*\n\n` +
        `📅 Bugun: *${formatPul(bugunJami)}* (${bugungi.length} ta)\n` +
        `📆 Shu oyda: *${formatPul(oyJami)}* (${oylik.length} ta)\n\n` +
        `Tugmalardan birini tanlang:`;

      await sendSafe(chatId, msg, {
        parse_mode: 'Markdown',
        ...xarajatMenyu()
      });
    }

    // Xarajat qo'shish — kategoriya tanlash
    else if (data === 'exp_add') {
      const kb = [];
      const keys = Object.keys(XARAJAT_KATEGORIYA);
      for (let i = 0; i < keys.length; i += 2) {
        const row = [];
        const k1 = keys[i];
        row.push({ text: `${XARAJAT_KATEGORIYA[k1].emoji} ${XARAJAT_KATEGORIYA[k1].nom}`, callback_data: `exp_cat_${k1}` });
        if (keys[i + 1]) {
          const k2 = keys[i + 1];
          row.push({ text: `${XARAJAT_KATEGORIYA[k2].emoji} ${XARAJAT_KATEGORIYA[k2].nom}`, callback_data: `exp_cat_${k2}` });
        }
        kb.push(row);
      }
      kb.push([{ text: '🔙 Bekor qilish', callback_data: 'expenses' }]);

      await sendSafe(chatId, '🏷 *Kategoriya tanlang:*', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: kb }
      });
    }

    // Tavsifni o'tkazib yuborish
    else if (data === 'exp_skip_desc') {
      const state = userState[chatId];
      if (!state || state.step !== 'exp_desc') return;

      foydalanuvchi(chatId);
      const all = yuklash();
      all.users[chatId].expenses.push({
        id: yangiId(),
        date: bugunSana(),
        kat: state.kat,
        amount: state.amount,
        desc: '',
        createdAt: Date.now()
      });
      saqlash(all);

      const kat = state.kat;
      const amount = state.amount;
      delete userState[chatId];

      await sendSafe(chatId,
        `✅ *Xarajat qo'shildi!*\n\n` +
        `${katEmoji(kat)} ${katNom(kat)}\n` +
        `💵 ${formatPul(amount)}`,
        {
          parse_mode: 'Markdown',
          ...xarajatMenyu()
        }
      );
    }

    // Kategoriya tanlandi — summa so'rash
    else if (data.startsWith('exp_cat_')) {
      const kat = data.replace('exp_cat_', '');
      if (!XARAJAT_KATEGORIYA[kat]) return;
      userState[chatId] = { step: 'exp_amount', kat: kat };
      await sendSafe(chatId,
        `${katEmoji(kat)} *${katNom(kat)}*\n\n` +
        `Summani yozing (so'mda):\n\n` +
        `_Masalan: 25000 yoki 50000_`,
        { parse_mode: 'Markdown' }
      );
    }

    // Bugungi xarajatlar ro'yxati
    else if (data === 'exp_list') {
      foydalanuvchi(chatId);
      const all = yuklash();
      const u = all.users[chatId];
      const bugun = bugunSana();
      const bugungi = (u.expenses || []).filter(e => e.date === bugun);

      if (bugungi.length === 0) {
        await sendSafe(chatId, '📭 Bugun xarajat yo\'q!', xarajatMenyu());
        return;
      }

      let msg = `📝 *Bugungi xarajatlar*\n\n`;
      const keyboard = [];
      const jami = bugungi.reduce((s, e) => s + e.amount, 0);

      bugungi.forEach((e, i) => {
        msg += `${i + 1}. ${katEmoji(e.kat)} *${katNom(e.kat)}*\n`;
        msg += `   💵 ${formatPul(e.amount)}`;
        if (e.desc) msg += ` — _${esc(e.desc)}_`;
        msg += `\n\n`;
        keyboard.push([
          { text: `🗑 ${i + 1}-ni o'chir (${formatPul(e.amount)})`, callback_data: `exp_del_${e.id}` }
        ]);
      });

      msg += `━━━━━━━━━━━━━━\n💯 *JAMI: ${formatPul(jami)}*`;

      keyboard.push([{ text: '🔙 Xarajatlar', callback_data: 'expenses' }]);

      await sendSafe(chatId, msg, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
    }

    // Haftalik hisobot
    else if (data === 'exp_week') {
      foydalanuvchi(chatId);
      const all = yuklash();
      const u = all.users[chatId];
      const sanalar = ohirgiNKun(7);
      const haftalik = (u.expenses || []).filter(e => sanalar.includes(e.date));
      const jami = haftalik.reduce((s, e) => s + e.amount, 0);
      const ortacha = haftalik.length > 0 ? jami / 7 : 0;

      let msg = `📅 *HAFTALIK HISOBOT (so'nggi 7 kun)*\n\n`;
      msg += `💯 Jami: *${formatPul(jami)}*\n`;
      msg += `📊 Kunlik o'rtacha: *${formatPul(ortacha)}*\n`;
      msg += `🧾 Xarajatlar soni: *${haftalik.length}*\n\n`;

      // Kunlar bo'yicha
      msg += `*Kunlar bo'yicha:*\n`;
      sanalar.forEach(s => {
        const kunlik = haftalik.filter(e => e.date === s).reduce((sum, e) => sum + e.amount, 0);
        if (kunlik > 0) {
          msg += `  ${s}: ${formatPul(kunlik)}\n`;
        }
      });

      await sendSafe(chatId, msg, {
        parse_mode: 'Markdown',
        ...xarajatMenyu()
      });
    }

    // Oylik hisobot
    else if (data === 'exp_month') {
      foydalanuvchi(chatId);
      const all = yuklash();
      const u = all.users[chatId];
      const oy = bugunSana().slice(0, 7);
      const oylik = (u.expenses || []).filter(e => e.date.startsWith(oy));
      const jami = oylik.reduce((s, e) => s + e.amount, 0);

      const bugun = new Date(bugunSana() + 'T00:00:00');
      const kun = bugun.getDate();
      const ortacha = kun > 0 ? jami / kun : 0;

      let msg = `📆 *OYLIK HISOBOT (${oy})*\n\n`;
      msg += `💯 Jami: *${formatPul(jami)}*\n`;
      msg += `📊 Kunlik o'rtacha: *${formatPul(ortacha)}*\n`;
      msg += `🧾 Xarajatlar soni: *${oylik.length}*\n\n`;

      // Eng katta 5 ta
      if (oylik.length > 0) {
        const eng = [...oylik].sort((a, b) => b.amount - a.amount).slice(0, 5);
        msg += `*🔝 Eng katta xarajatlar:*\n`;
        eng.forEach((e, i) => {
          msg += `${i + 1}. ${katEmoji(e.kat)} ${formatPul(e.amount)}`;
          if (e.desc) msg += ` (${e.desc.slice(0, 20)})`;
          msg += `\n`;
        });
      }

      await sendSafe(chatId, msg, {
        parse_mode: 'Markdown',
        ...xarajatMenyu()
      });
    }

    // Kategoriyalar bo'yicha (shu oy)
    else if (data === 'exp_cats') {
      foydalanuvchi(chatId);
      const all = yuklash();
      const u = all.users[chatId];
      const oy = bugunSana().slice(0, 7);
      const oylik = (u.expenses || []).filter(e => e.date.startsWith(oy));
      const jami = oylik.reduce((s, e) => s + e.amount, 0);

      let msg = `🏷 *KATEGORIYA BO'YICHA (${oy})*\n\n`;

      if (jami === 0) {
        msg += `📭 Bu oy hali xarajat yo'q!`;
      } else {
        const guruh = {};
        oylik.forEach(e => {
          guruh[e.kat] = (guruh[e.kat] || 0) + e.amount;
        });

        const tartib = Object.entries(guruh).sort((a, b) => b[1] - a[1]);
        tartib.forEach(([k, s]) => {
          const foiz = Math.round((s / jami) * 100);
          const bar = '▰'.repeat(Math.floor(foiz / 10)) + '▱'.repeat(10 - Math.floor(foiz / 10));
          msg += `${katEmoji(k)} *${katNom(k)}*\n`;
          msg += `   ${bar} ${foiz}%\n`;
          msg += `   ${formatPul(s)}\n\n`;
        });

        msg += `━━━━━━━━━━━━━━\n💯 *JAMI: ${formatPul(jami)}*`;
      }

      await sendSafe(chatId, msg, {
        parse_mode: 'Markdown',
        ...xarajatMenyu()
      });
    }

    // Xarajatni o'chirish
    else if (data.startsWith('exp_del_')) {
      const id = data.replace('exp_del_', '');
      const all = yuklash();
      const u = all.users[chatId];
      if (!u || !u.expenses) return;
      const idx = u.expenses.findIndex(e => e.id === id);
      if (idx >= 0) {
        const e = u.expenses[idx];
        u.expenses.splice(idx, 1);
        saqlash(all);
        await sendSafe(chatId,
          `🗑 ${katEmoji(e.kat)} *${katNom(e.kat)}* — ${formatPul(e.amount)} o'chirildi`,
          { parse_mode: 'Markdown', ...xarajatMenyu() }
        );
      }
    }

    // Bugungi xarajatlarni tozalash
    else if (data === 'exp_clear') {
      await sendSafe(chatId,
        '⚠️ *Bugungi xarajatlarni tozalashga aminmisiz?*',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Ha', callback_data: 'exp_clear_yes' },
              { text: '❌ Yo\'q', callback_data: 'expenses' }
            ]]
          }
        }
      );
    }
    else if (data === 'exp_clear_yes') {
      const all = yuklash();
      const u = all.users[chatId];
      if (u && u.expenses) {
        const bugun = bugunSana();
        u.expenses = u.expenses.filter(e => e.date !== bugun);
        saqlash(all);
      }
      await sendSafe(chatId, '🗑 Bugungi xarajatlar tozalandi!', xarajatMenyu());
    }

    // Yordam
    else if (data === 'help') {
      const msg = `❓ *YORDAM*\n\n` +
        `*Vazifa qo'shish:*\n` +
        `1. ➕ Vazifa qo'shish\n` +
        `2. Daraja tanlang (🟢🟡🔴)\n` +
        `3. Vazifa nomini yozing\n` +
        `4. Boshlanish vaqti (14:00)\n` +
        `5. Tugash vaqti (16:00)\n\n` +
        `*Bot quyidagi vaqtlarda eslatadi:*\n` +
        `🔔 5 daqiqa oldin\n` +
        `⏰ Vazifa boshlanish vaqtida\n` +
        `✅ Tugash vaqtida tekshiruv\n\n` +
        `*Bajarilmasa:*\n` +
        `💀 Avtomatik jazo balli qo'shiladi\n\n` +
        `*Bajarilsa:*\n` +
        `🏆 Kun yakunida mukofot ballari beriladi\n\n` +
        `💰 *Xarajatlar:*\n` +
        `• Har xil kategoriyalar bo'yicha qo'shing\n` +
        `• Bugungi/haftalik/oylik hisobotni ko'ring\n` +
        `• Qaysi kategoriyaga ko'p ketishini bilib oling`;

      await sendSafe(chatId, msg, {
        parse_mode: 'Markdown',
        ...asosiyMenyu()
      });
    }
  } catch (err) {
    console.error('callback_query xato:', err.message);
  }
});

// =====================================================
// MATN XABARLARI (vazifa qo'shish jarayoni)
// =====================================================
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  // Buyruq yozilsa — userState ni tozalab, qaytib chiqamiz
  if (text.startsWith('/')) {
    delete userState[chatId];
    return;
  }

  const state = userState[chatId];
  if (!state) return;

  // Nom kiritildi
  if (state.step === 'name') {
    if (text.length > 50) {
      sendSafe(chatId, '⚠️ Nom juda uzun! 50 belgidan kam yozing.');
      return;
    }
    state.name = text;
    state.step = 'start_time';
    sendSafe(chatId,
      `⏰ Boshlanish vaqtini yozing:\n\n` +
      `_Format: HH:MM (masalan: 14:00 yoki 09:30)_`,
      { parse_mode: 'Markdown' }
    );
  }

  // Boshlanish vaqti kiritildi
  else if (state.step === 'start_time') {
    if (!vaqtTekshir(text)) {
      sendSafe(chatId, '⚠️ Noto\'g\'ri format!\nMasalan: 14:00 yoki 09:30');
      return;
    }
    state.start = text;
    state.step = 'end_time';
    sendSafe(chatId,
      `⏰ Tugash vaqtini yozing:\n\n` +
      `_Format: HH:MM (masalan: 16:00)_`,
      { parse_mode: 'Markdown' }
    );
  }

  // XARAJAT — summa kiritildi
  else if (state.step === 'exp_amount') {
    const summa = summaTekshir(text);
    if (summa === null) {
      sendSafe(chatId, '⚠️ Noto\'g\'ri summa!\nMasalan: 25000 yoki 50000');
      return;
    }
    state.amount = summa;
    state.step = 'exp_desc';
    sendSafe(chatId,
      `💵 Summa: *${formatPul(summa)}*\n\n` +
      `Qisqacha izoh yozing (ixtiyoriy):\n\n` +
      `_Masalan: Tushlik, Taksi, Kitob_\n` +
      `_Yoki "yo'q" deb yozing_`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '⏭ O\'tkazib yuborish', callback_data: 'exp_skip_desc' }
          ]]
        }
      }
    );
  }

  // XARAJAT — tavsif kiritildi yoki o'tkazib yuborildi
  else if (state.step === 'exp_desc') {
    let desc = text.trim();
    if (desc.toLowerCase() === 'yo\'q' || desc.toLowerCase() === 'yoq' || desc === '-') {
      desc = '';
    }
    if (desc.length > 100) desc = desc.slice(0, 100);

    foydalanuvchi(chatId);
    const all = yuklash();
    all.users[chatId].expenses.push({
      id: yangiId(),
      date: bugunSana(),
      kat: state.kat,
      amount: state.amount,
      desc: desc,
      createdAt: Date.now()
    });
    saqlash(all);

    const kat = state.kat;
    const amount = state.amount;
    delete userState[chatId];

    sendSafe(chatId,
      `✅ *Xarajat qo'shildi!*\n\n` +
      `${katEmoji(kat)} ${katNom(kat)}\n` +
      `💵 ${formatPul(amount)}` +
      (desc ? `\n📝 ${desc}` : ''),
      {
        parse_mode: 'Markdown',
        ...xarajatMenyu()
      }
    );
  }

  // Tugash vaqti kiritildi — SAQLASH
  else if (state.step === 'end_time') {
    if (!vaqtTekshir(text)) {
      sendSafe(chatId, '⚠️ Noto\'g\'ri format!\nMasalan: 16:00');
      return;
    }

    if (text <= state.start) {
      sendSafe(chatId, '⚠️ Tugash vaqti boshlanishdan keyin bo\'lishi kerak!');
      return;
    }

    state.end = text;

    const all = yuklash();
    if (!all.users[chatId]) {
      foydalanuvchi(chatId);
    }
    const fresh = yuklash();
    fresh.users[chatId].tasks.push({
      id: yangiId(),
      name: state.name,
      daraja: state.daraja,
      start: state.start,
      end: state.end,
      done: false,
      failed: false,
      reminder5: false,
      reminderStart: false,
      reminderEnd: false
    });
    saqlash(fresh);

    delete userState[chatId];

    sendSafe(chatId,
      `✅ *Vazifa qo'shildi!*\n\n` +
      `${darajaEmoji(state.daraja)} ${state.name}\n` +
      `⏰ ${state.start} - ${state.end}\n` +
      `💯 ${darajaBall(state.daraja)} ball\n\n` +
      `🔔 Sizga 5 daqiqa oldin eslatma yuboraman!`,
      {
        parse_mode: 'Markdown',
        ...asosiyMenyu()
      }
    );
  }
});

bot.on('polling_error', (error) => {
  console.log('Polling xato:', error.message);
});

// =====================================================
// AVTOMATIK ESLATMALAR (HAR DAQIQA TEKSHIRADI)
// =====================================================
cron.schedule('* * * * *', async () => {
  let all;
  try {
    all = yuklash();
  } catch (err) {
    console.error('Cron yuklash xato:', err.message);
    return;
  }

  const hozir = hozirVaqt();
  const [nh, nm] = hozir.split(':').map(Number);
  const nowMins = nh * 60 + nm;

  for (const chatId in all.users) {
    const u = all.users[chatId];
    if (!u.tasks) continue;

    for (const t of u.tasks) {
      if (t.done || t.failed) continue;
      if (!t.id) t.id = yangiId(); // eski vazifalarga migratsiya

      const [sh, sm] = t.start.split(':').map(Number);
      const [eh, em] = t.end.split(':').map(Number);
      const startMins = sh * 60 + sm;
      const endMins = eh * 60 + em;

      // 5 daqiqa oldin (faqat boshlanish kun ichida bo'lsa)
      const remMins = startMins - 5;
      if (remMins >= 0 && nowMins === remMins && !t.reminder5) {
        t.reminder5 = true;
        try {
          await sendSafe(chatId,
            `🔔 *5 daqiqadan keyin:*\n\n` +
            `${darajaEmoji(t.daraja)} *${esc(t.name)}*\n` +
            `⏰ ${t.start} \\- ${t.end}\n\n` +
            `Tayyorlaning\\! 💪`,
            { parse_mode: 'MarkdownV2' }
          );
        } catch (e) { console.error(e.message); }
      }

      // Boshlanish vaqtida
      if (nowMins === startMins && !t.reminderStart) {
        t.reminderStart = true;
        try {
          await sendSafe(chatId,
            `⏰ *HOZIR VAQTI!*\n\n` +
            `${darajaEmoji(t.daraja)} *${esc(t.name)}*\n` +
            `${t.end} gacha tugating\\!\n\n` +
            `🔥 Boshlang\\!`,
            { parse_mode: 'MarkdownV2' }
          );
        } catch (e) { console.error(e.message); }
      }

      // Tugash vaqtida tekshirish
      if (nowMins === endMins && !t.reminderEnd) {
        t.reminderEnd = true;
        try {
          await sendSafe(chatId,
            `⏰ *Vaqt tugadi!*\n\n` +
            `${darajaEmoji(t.daraja)} *${esc(t.name)}*\n` +
            `Bajardingizmi?`,
            {
              parse_mode: 'MarkdownV2',
              reply_markup: {
                inline_keyboard: [[
                  { text: '✅ Ha, bajardim', callback_data: `done_${t.id}` },
                  { text: '❌ Yo\'q, bajarmadim', callback_data: `fail_${t.id}` }
                ]]
              }
            }
          );
        } catch (e) { console.error(e.message); }
      }
    }
  }

  saqlash(all);
});

// =====================================================
// KUN YAKUNI (HAR KUNI 23:55 DA)
// =====================================================
cron.schedule('55 23 * * *', async () => {
  let all;
  try { all = yuklash(); } catch (e) { return; }
  const bugun = bugunSana();

  for (const chatId in all.users) {
    const u = all.users[chatId];

    if (u.oxirgiKun === bugun) continue;
    if (!u.tasks || u.tasks.length === 0) continue;

    const jami = u.tasks.length;
    const bajarilgan = u.tasks.filter(t => t.done).length;
    const bajarilmagan = u.tasks.filter(t => !t.done);
    const foiz = Math.round((bajarilgan / jami) * 100);

    const jazoBall = bajarilmagan.reduce((s, t) => s + darajaBall(t.daraja), 0);
    u.jazoBalli += jazoBall;

    let mukofot = 0;
    if (foiz === 100) mukofot = 10;
    else if (foiz >= 80) mukofot = 5;
    else if (foiz >= 50) mukofot = 2;
    u.mukofotBalli += mukofot;

    if (foiz === 100) u.streak++;
    else u.streak = 0;

    u.history.push({
      date: bugun,
      total: jami,
      completed: bajarilgan,
      foiz: foiz,
      jazo: jazoBall,
      mukofot: mukofot
    });
    if (u.history.length > 90) u.history.shift();

    u.oxirgiKun = bugun;

    let msg = `🌙 *KUN YAKUNI*\n\n`;
    msg += `📅 ${bugun}\n`;
    msg += `✅ ${bajarilgan}/${jami} (${foiz}%)\n\n`;

    if (foiz === 100) {
      msg += `🏆 *MUKAMMAL KUN!*\n`;
      msg += `🎉 +${mukofot} mukofot balli!\n`;
      msg += `⚡ Streak: ${u.streak} kun\n\n`;
    } else {
      msg += `💀 *Jazo:* ${jazoBall} ball\n${jazoMatni(jazoBall)}\n\n`;
      if (mukofot > 0) msg += `${mukofotMatni(foiz, mukofot)}\n\n`;
      msg += `⚡ Streak: ${u.streak} (uzildi!)\n\n`;
    }

    msg += `🔥 Jami jazo: *${u.jazoBalli}*\n`;
    msg += `🏆 Jami mukofot: *${u.mukofotBalli}*\n\n`;
    msg += `💪 *Ertaga yangi kun, yangi imkoniyat!*`;

    try {
      await sendSafe(chatId, msg, { parse_mode: 'Markdown' });
    } catch (e) { console.error(e.message); }

    u.tasks = [];
  }

  saqlash(all);
}, { timezone: 'Asia/Tashkent' });

// Ertalabki xabar (07:00)
cron.schedule('0 7 * * *', async () => {
  let all;
  try { all = yuklash(); } catch (e) { return; }
  for (const chatId in all.users) {
    try {
      await sendSafe(chatId,
        `☀️ *Xayrli tong!*\n\n` +
        `Bugun nima rejalashtiryapsiz?\n` +
        `Vazifalaringizni qo'shing! 💪`,
        {
          parse_mode: 'Markdown',
          ...asosiyMenyu()
        }
      );
    } catch (e) { console.error(e.message); }
  }
}, { timezone: 'Asia/Tashkent' });

// =====================================================
// RENDER UCHUN MINI HTTP SERVER
// =====================================================
const http = require('http');
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot ishlayapti! HAYBAT-PRO');
}).listen(port, () => {
  console.log('HTTP server ' + port + ' portda ishlamoqda');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM qabul qilindi, bot to\'xtatilmoqda...');
  bot.stopPolling().then(() => process.exit(0));
});
process.on('SIGINT', () => {
  console.log('SIGINT qabul qilindi, bot to\'xtatilmoqda...');
  bot.stopPolling().then(() => process.exit(0));
});
