require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const cron = require('node-cron');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

console.log('🔥 HAYBAT-PRO v2.0 ishga tushdi...');

// =====================================================
// MA'LUMOTLAR (data.json)
// =====================================================
const DATA_FILE = 'data.json';

function yuklash() {
  if (!fs.existsSync(DATA_FILE)) return { users: {} };
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saqlash(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function foydalanuvchi(chatId) {
  const data = yuklash();
  if (!data.users[chatId]) {
    data.users[chatId] = {
      tasks: [],              // bugungi vazifalar
      history: [],            // tarix
      streak: 0,              // ketma-ket kunlar
      jazoBalli: 0,           // jami jazo balli
      mukofotBalli: 0,        // jami mukofot balli
      oxirgiKun: null         // oxirgi yakun chiqarilgan kun
    };
    saqlash(data);
  }
  return data;
}

// =====================================================
// YORDAMCHI FUNKSIYALAR
// =====================================================
function bugunSana() {
  return new Date().toLocaleDateString('en-CA', { 
    timeZone: 'Asia/Tashkent' 
  }); // 2026-05-16 formatida
}

function hozirVaqt() {
  return new Date().toLocaleTimeString('en-GB', { 
    timeZone: 'Asia/Tashkent',
    hour: '2-digit',
    minute: '2-digit'
  }); // 14:30 formatida
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
          { text: '🗑 Hammasini tozalash', callback_data: 'clear' },
          { text: '❓ Yordam', callback_data: 'help' }
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
  const name = msg.from.first_name;
  foydalanuvchi(chatId);
  
  const xush = `🔥 Salom, *${name}*!\n\n` +
    `Men *HAYBAT-PRO* botiman.\n` +
    `Sizning hayotingizni tartibga solaman!\n\n` +
    `📋 *Imkoniyatlar:*\n` +
    `• Vaqtli vazifalar qo'shish\n` +
    `• 5 daqiqa oldin eslatma\n` +
    `• Vaqt tugaganda tekshirish\n` +
    `• Jazo va mukofot tizimi\n\n` +
    `🟢 Oson — 1 ball\n` +
    `🟡 O'rta — 3 ball\n` +
    `🔴 Muhim — 5 ball\n\n` +
    `Boshlash uchun tugmani bosing:`;
  
  bot.sendMessage(chatId, xush, { 
    parse_mode: 'Markdown',
    ...asosiyMenyu() 
  });
});

bot.onText(/\/menu/, (msg) => {
  bot.sendMessage(msg.chat.id, '📋 *Asosiy menyu:*', { 
    parse_mode: 'Markdown',
    ...asosiyMenyu() 
  });
});

// =====================================================
// TUGMA BOSILGANDA
// =====================================================
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  
  bot.answerCallbackQuery(query.id);
  
  // Menyu
  if (data === 'menu') {
    bot.sendMessage(chatId, '📋 *Asosiy menyu:*', { 
      parse_mode: 'Markdown',
      ...asosiyMenyu() 
    });
  }
  
  // Vazifa qo'shish — daraja tanlash
  else if (data === 'add') {
    bot.sendMessage(chatId, '📌 Vazifa darajasini tanlang:', {
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
    bot.sendMessage(chatId, 
      `${darajaEmoji(daraja)} Vazifa nomini yozing:\n\n` +
      `_Masalan: Dars qilish, Sport, Kitob o'qish_`,
      { parse_mode: 'Markdown' }
    );
  }
  
  // Vazifalar ro'yxati
  else if (data === 'list') {
    const all = yuklash();
    const u = all.users[chatId];
    
    if (!u.tasks || u.tasks.length === 0) {
      bot.sendMessage(chatId, '📭 Bugun vazifa yo\'q!\n\nVazifa qo\'shish uchun tugmani bosing:', asosiyMenyu());
      return;
    }
    
    let msg = `📝 *Bugungi vazifalar*\n\n`;
    const keyboard = [];
    
    u.tasks.forEach((t, i) => {
      const belgi = t.done ? '✅' : t.failed ? '❌' : '⬜';
      msg += `${i + 1}. ${belgi} ${darajaEmoji(t.daraja)} *${t.name}*\n`;
      msg += `   ⏰ ${t.start} - ${t.end} (${darajaBall(t.daraja)} ball)\n\n`;
      
      if (!t.done && !t.failed) {
        keyboard.push([
          { text: `✅ ${i + 1}-ni bajardim`, callback_data: `done_${i}` },
          { text: `🗑 ${i + 1}-ni o\'chir`, callback_data: `del_${i}` }
        ]);
      }
    });
    
    keyboard.push([{ text: '🔙 Menyu', callback_data: 'menu' }]);
    
    bot.sendMessage(chatId, msg, { 
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard }
    });
  }
  
  // Bajarildi
  else if (data.startsWith('done_')) {
    const idx = parseInt(data.replace('done_', ''));
    const all = yuklash();
    const u = all.users[chatId];
    
    if (u.tasks[idx] && !u.tasks[idx].done) {
      u.tasks[idx].done = true;
      saqlash(all);
      bot.sendMessage(chatId, 
        `✅ *${u.tasks[idx].name}* — bajarildi!\n🎉 Zo'rsiz!`,
        { parse_mode: 'Markdown' }
      );
    }
  }
  
  // O'chirish
  else if (data.startsWith('del_')) {
    const idx = parseInt(data.replace('del_', ''));
    const all = yuklash();
    const u = all.users[chatId];
    
    if (u.tasks[idx]) {
      const name = u.tasks[idx].name;
      u.tasks.splice(idx, 1);
      saqlash(all);
      bot.sendMessage(chatId, `🗑 "${name}" o'chirildi`);
    }
  }
  
  // Statistika
  else if (data === 'stats') {
    const all = yuklash();
    const u = all.users[chatId];
    
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
    
    bot.sendMessage(chatId, msg, { 
      parse_mode: 'Markdown', 
      ...asosiyMenyu() 
    });
  }
  
  // Jazo holati
  else if (data === 'jazo') {
    const all = yuklash();
    const u = all.users[chatId];
    
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
    
    bot.sendMessage(chatId, msg, { 
      parse_mode: 'Markdown', 
      ...asosiyMenyu() 
    });
  }
  
  // Mukofot do'koni
  else if (data === 'shop') {
    const all = yuklash();
    const u = all.users[chatId];
    
    const msg = `🏆 *MUKOFOT DO'KONI*\n\n` +
      `Sizning ballaringiz: *${u.mukofotBalli}*\n\n` +
      `*Sotib olish mumkin:*\n` +
      `🍫 50 ball — Shirinlik\n` +
      `🎬 100 ball — Kino\n` +
      `🍔 200 ball — Restoran\n` +
      `🎁 500 ball — Katta sovg'a\n` +
      `✈️ 1000 ball — Sayohat\n\n` +
      `_Mukofot olganda menga ayting, ballarni minus qilaman!_`;
    
    bot.sendMessage(chatId, msg, { 
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
    
    if (u.mukofotBalli >= narx) {
      u.mukofotBalli -= narx;
      saqlash(all);
      bot.sendMessage(chatId, 
        `🎉 *Tabriklaymiz!*\n\n` +
        `Siz ${narx} ball evaziga mukofot sotib oldingiz!\n` +
        `Qolgan ballaringiz: *${u.mukofotBalli}*\n\n` +
        `_Endi haqiqatda o'zingizga sovg'a qiling!_ 🎁`,
        { parse_mode: 'Markdown' }
      );
    } else {
      bot.sendMessage(chatId, 
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
    const u = all.users[chatId];
    
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
    
    bot.sendMessage(chatId, msg, { 
      parse_mode: 'Markdown',
      ...asosiyMenyu() 
    });
  }
  
  // Hammasini tozalash
  else if (data === 'clear') {
    bot.sendMessage(chatId, 
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
    all.users[chatId].tasks = [];
    saqlash(all);
    bot.sendMessage(chatId, '🗑 Bugungi barcha vazifalar tozalandi!', asosiyMenyu());
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
      `🏆 Kun yakunida mukofot ballari beriladi`;
    
    bot.sendMessage(chatId, msg, { 
      parse_mode: 'Markdown',
      ...asosiyMenyu() 
    });
  }
});

// =====================================================
// MATN XABARLARI (vazifa qo'shish jarayoni)
// =====================================================
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  
  if (!text || text.startsWith('/')) return;
  
  const state = userState[chatId];
  if (!state) return;
  
  // Nom kiritildi
  if (state.step === 'name') {
    if (text.length > 50) {
      bot.sendMessage(chatId, '⚠️ Nom juda uzun! 50 belgidan kam yozing.');
      return;
    }
    state.name = text;
    state.step = 'start_time';
    bot.sendMessage(chatId, 
      `⏰ Boshlanish vaqtini yozing:\n\n` +
      `_Format: HH:MM (masalan: 14:00 yoki 09:30)_`,
      { parse_mode: 'Markdown' }
    );
  }
  
  // Boshlanish vaqti kiritildi
  else if (state.step === 'start_time') {
    if (!vaqtTekshir(text)) {
      bot.sendMessage(chatId, '⚠️ Noto\'g\'ri format!\nMasalan: 14:00 yoki 09:30');
      return;
    }
    state.start = text;
    state.step = 'end_time';
    bot.sendMessage(chatId, 
      `⏰ Tugash vaqtini yozing:\n\n` +
      `_Format: HH:MM (masalan: 16:00)_`,
      { parse_mode: 'Markdown' }
    );
  }
  
  // Tugash vaqti kiritildi — SAQLASH
  else if (state.step === 'end_time') {
    if (!vaqtTekshir(text)) {
      bot.sendMessage(chatId, '⚠️ Noto\'g\'ri format!\nMasalan: 16:00');
      return;
    }
    
    if (text <= state.start) {
      bot.sendMessage(chatId, '⚠️ Tugash vaqti boshlanishdan keyin bo\'lishi kerak!');
      return;
    }
    
    state.end = text;
    
    // Saqlash
    const all = yuklash();
    foydalanuvchi(chatId);
    all.users[chatId].tasks.push({
      name: state.name,
      daraja: state.daraja,
      start: state.start,
      end: state.end,
      done: false,
      failed: false,
      reminder5: false,    // 5 daqiqa oldin eslatilganmi
      reminderStart: false, // boshlanishda eslatilganmi
      reminderEnd: false    // oxirida tekshirilganmi
    });
    saqlash(all);
    
    delete userState[chatId];
    
    bot.sendMessage(chatId, 
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
  console.log('Xato:', error.message);
});

// =====================================================
// AVTOMATIK ESLATMALAR (HAR DAQIQA TEKSHIRADI)
// =====================================================
cron.schedule('* * * * *', () => {
  const all = yuklash();
  const hozir = hozirVaqt();
  
  for (const chatId in all.users) {
    const u = all.users[chatId];
    
    u.tasks.forEach((t, i) => {
      if (t.done || t.failed) return;
      
      // 5 daqiqa oldin eslatma
      const [sh, sm] = t.start.split(':').map(Number);
      let mins5 = sh * 60 + sm - 5;
      if (mins5 < 0) mins5 += 24 * 60;
      const h5 = String(Math.floor(mins5 / 60)).padStart(2, '0');
      const m5 = String(mins5 % 60).padStart(2, '0');
      const vaqt5 = `${h5}:${m5}`;
      
      if (hozir === vaqt5 && !t.reminder5) {
        t.reminder5 = true;
        bot.sendMessage(chatId, 
          `🔔 *5 daqiqadan keyin:*\n\n` +
          `${darajaEmoji(t.daraja)} *${t.name}*\n` +
          `⏰ ${t.start} - ${t.end}\n\n` +
          `Tayyorlaning! 💪`,
          { parse_mode: 'Markdown' }
        );
      }
      
      // Boshlanish vaqtida
      if (hozir === t.start && !t.reminderStart) {
        t.reminderStart = true;
        bot.sendMessage(chatId, 
          `⏰ *HOZIR VAQTI!*\n\n` +
          `${darajaEmoji(t.daraja)} *${t.name}*\n` +
          `${t.end} gacha tugating!\n\n` +
          `🔥 Boshlang!`,
          { parse_mode: 'Markdown' }
        );
      }
      
      // Tugash vaqtida — tekshirish
      if (hozir === t.end && !t.reminderEnd) {
        t.reminderEnd = true;
        bot.sendMessage(chatId, 
          `⏰ *Vaqt tugadi!*\n\n` +
          `${darajaEmoji(t.daraja)} *${t.name}*\n` +
          `Bajardingizmi?`,
          { 
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ Ha, bajardim', callback_data: `done_${i}` },
                { text: '❌ Yo\'q, bajarmadim', callback_data: `fail_${i}` }
              ]]
            }
          }
        );
      }
    });
  }
  
  saqlash(all);
});

// Yo'q deb javob berganda
bot.on('callback_query', (query) => {
  if (!query.data.startsWith('fail_')) return;
  const chatId = query.message.chat.id;
  const idx = parseInt(query.data.replace('fail_', ''));
  const all = yuklash();
  const u = all.users[chatId];
  
  if (u.tasks[idx] && !u.tasks[idx].failed && !u.tasks[idx].done) {
    u.tasks[idx].failed = true;
    const ball = darajaBall(u.tasks[idx].daraja);
    u.jazoBalli += ball;
    saqlash(all);
    bot.sendMessage(chatId, 
      `❌ *${u.tasks[idx].name}* bajarilmadi!\n\n` +
      `💀 Jazo: +${ball} ball\n` +
      `🔥 Jami: ${u.jazoBalli} ball`,
      { parse_mode: 'Markdown' }
    );
  }
});

// =====================================================
// KUN YAKUNI (HAR KUNI 23:55 DA)
// =====================================================
cron.schedule('55 23 * * *', () => {
  const all = yuklash();
  const bugun = bugunSana();
  
  for (const chatId in all.users) {
    const u = all.users[chatId];
    
    if (u.oxirgiKun === bugun) continue;
    if (u.tasks.length === 0) continue;
    
    const jami = u.tasks.length;
    const bajarilgan = u.tasks.filter(t => t.done).length;
    const bajarilmagan = u.tasks.filter(t => !t.done);
    const foiz = Math.round((bajarilgan / jami) * 100);
    
    // Jazo
    const jazoBall = bajarilmagan.reduce((s, t) => s + darajaBall(t.daraja), 0);
    u.jazoBalli += jazoBall;
    
    // Mukofot
    let mukofot = 0;
    if (foiz === 100) mukofot = 10;
    else if (foiz >= 80) mukofot = 5;
    else if (foiz >= 50) mukofot = 2;
    u.mukofotBalli += mukofot;
    
    // Streak
    if (foiz === 100) u.streak++;
    else u.streak = 0;
    
    // Tarix
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
    
    // Yakuniy xabar
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
    
    bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
    
    // Vazifalarni tozalash (ertaga uchun)
    u.tasks = [];
  }
  
  saqlash(all);
}, { timezone: 'Asia/Tashkent' });

// Ertalabki xabar (07:00)
cron.schedule('0 7 * * *', () => {
  const all = yuklash();
  for (const chatId in all.users) {
    bot.sendMessage(chatId, 
      `☀️ *Xayrli tong!*\n\n` +
      `Bugun nima rejalashtiryapsiz?\n` +
      `Vazifalaringizni qo'shing! 💪`,
      { 
        parse_mode: 'Markdown',
        ...asosiyMenyu() 
      }
    );
  }
}, { timezone: 'Asia/Tashkent' });