const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Groq } = require('groq-sdk');
const fs = require('fs');
const P = require('pino');
require('dotenv').config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const sesiChat = new Map(); // Menyimpan histori percakapan per user

const dataProduk = fs.readFileSync('./data.txt', 'utf8');

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    printQRInTerminal: true,
    auth: state,
    logger: P({ level: 'silent' })
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const m = messages[0];
    if (!m.message || m.key.fromMe) return;
    await kirimPesanKeChatGroq(sock, m);
  });

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
      startSock();
    }
  });
}

function getPesanTeks(m) {
  const msg = m.message;
  if (msg.conversation) return msg.conversation;
  if (msg.extendedTextMessage) return msg.extendedTextMessage.text;
  if (msg.imageMessage?.caption) return msg.imageMessage.caption;
  return '';
}

async function kirimPesan(sock, m, teks) {
  await sock.sendMessage(m.key.remoteJid, { text: teks }, { quoted: m });
}

async function kirimPesanKeChatGroq(sock, m) {
  try {
    const userText = getPesanTeks(m).trim();
    const senderJid = m.key.remoteJid;

    if (!sesiChat.has(senderJid)) {
      sesiChat.set(senderJid, [
        {
          role: 'system',
          content: `kamu adalah sistem jika user mengetik sebuah nama cari datanya dan jabarkan gratisan apa yang dia miliki,
gunakan data produk sebagai referensi :

${dataProduk}`
        }
      ]);
    }

    const sesi = sesiChat.get(senderJid);
    sesi.push({ role: 'user', content: userText });

    const response = await groq.chat.completions.create({
      model: 'llama3-70b-8192',
      messages: sesi
    });

    const jawaban = response.choices[0].message.content.trim();
    sesi.push({ role: 'assistant', content: jawaban });

    if (sesi.length > 30) sesi.splice(1, sesi.length - 20); // Jaga performa

    await kirimPesan(sock, m, jawaban);
  } catch (error) {
    console.error('Gagal kirim ke Groq:', error?.response?.data || error);
    await kirimPesan(sock, m, 'Maaf, terjadi kesalahan saat menjawab.');
  }
}

startSock();
