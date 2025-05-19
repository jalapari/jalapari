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

// Konfigurasi OpenAI API
const openai = axios.create({
  baseURL: 'https://api.openai.com/v1/',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
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

// Fungsi untuk mengirim pesan ke ChatGPT
async function kirimPesanKeChatGPT(sock, m) {
  try {
    const userText = m.message?.conversation || '';

    const response = await openai.post('chat/completions', {
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'Anda adalah asisten virtual yang dapat menjawab pertanyaan dengan akurat.',
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
    console.error('Gagal mengirim pesan ke ChatGPT:', error);
    await kirimPesan(sock, m, 'Gagal mengirim pesan ke ChatGPT. Silakan coba lagi.');
  }
}

// Fungsi untuk menghandle pesan masuk
async function handlePesan(sock, m) {
  const pesan = m.message?.conversation;
  if (!pesan) return;
  console.log('Pesan masuk dari', m.key.remoteJid, ':', pesan);
  await kirimPesanKeChatGPT(sock, m);
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
