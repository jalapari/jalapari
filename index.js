// Import library yang dibutuhkan
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  generateMessageID,
  generateWAMessageFromContent,
} = require('@whiskeysockets/baileys');

const qrcode = require('qrcode-terminal');
const axios = require('axios');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

// Konfigurasi .env
dotenv.config();

// Konfigurasi Groq API
const groq = axios.create({
  baseURL: 'https://api.groq.com/openai/v1/',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
  },
});

// Fungsi untuk mengirim pesan ke pengguna
async function kirimPesan(sock, m, pesan) {
  const message = generateWAMessageFromContent(m.key.remoteJid, {
    conversation: pesan,
  }, {});

  await sock.relayMessage(
    m.key.remoteJid,
    message.message,
    { messageId: generateMessageID() }
  );
}

// Fungsi untuk mengirim pesan ke Groq (LLM)
async function kirimPesanKeChatGroq(sock, m) {
  try {
    const userText = m.message?.conversation || '';

    const response = await groq.post('chat/completions', {
      model: 'llama3-70b-8192', // atau 'gemma-7b-it'
      messages: [
        {
          role: 'system',
          content: 'Kamu adalah asisten AI yang menjawab semua pertanyaan costumer dengan bahasa Indonesia yang jelas. Jika pertanyaan terlihat mendesak, balas dengan: "Pesan ini akan diteruskan ke HERWANSYAH dan akan dibalas saat dia online.',
        },
        {
          role: 'user',
          content: userText,
        },
      ],
    });

    const jawaban = response.data.choices[0].message.content;

    if (userText.toLowerCase().includes('mendesak')) {
      await kirimPesan(sock, m, 'Akan diteruskan ke HERWANSYAH.');
    } else {
      await kirimPesan(sock, m, jawaban);
    }
  } catch (error) {
    console.error('Gagal mengirim pesan ke Groq:', error?.response?.data || error);
    await kirimPesan(sock, m, 'Gagal mengirim pesan ke Groq. Silakan coba lagi.');
  }
}

// Fungsi untuk menghandle pesan masuk
async function handlePesan(sock, m) {
  const pesan = m.message?.conversation;
  if (!pesan) return;
  console.log('Pesan masuk dari', m.key.remoteJid, ':', pesan);
  await kirimPesanKeChatGroq(sock, m);
}

// Inisialisasi koneksi WhatsApp
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Koneksi terputus, reconnect:', shouldReconnect);
      if (shouldReconnect) {
        startBot();
      }
    } else if (connection === 'open') {
      console.log('Koneksi ke WhatsApp berhasil');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.key.fromMe && msg.message?.conversation) {
      await handlePesan(sock, msg);
    }
  });
}

startBot();
