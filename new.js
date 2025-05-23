// Import library yang dibutuhkan
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  generateMessageID,
  generateWAMessageFromContent,
} = require('@whiskeysockets/baileys');

const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const dotenv = require('dotenv');

// Konfigurasi .env
dotenv.config();

// Load data produk
const dataProduk = fs.readFileSync(path.join(__dirname, 'data.txt'), 'utf-8');

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

// Fungsi mencatat ke log jika perlu diteruskan ke admin
function logToAdmin(jid, pesan) {
  const log = `[${new Date().toISOString()}] ${jid}: ${pesan}\n`;
  fs.appendFileSync(path.join(__dirname, 'log_admin.txt'), log);
}

// Fungsi untuk mengirim pesan ke Groq (LLM)
async function kirimPesanKeChatGroq(sock, m) {
  try {
    const userText = m.message?.conversation?.trim() || '';
    const lowerText = userText.toLowerCase();

    // Respon cepat untuk sapaan ringan
    const greetings = ['halo', 'hi', 'test', 'assalamualaikum', 'pagi', 'malam'];
    if (greetings.some(greet => lowerText.includes(greet))) {
      await kirimPesan(sock, m, 'Halo! Ada yang bisa saya bantu seputar produk kami? 😊');
      return;
    }

    const response = await groq.post('chat/completions', {
      model: 'llama3-70b-8192',
      messages: [
        {
          role: 'system',
          content: `Kamu adalah asisten AI profesional berbahasa indonesia yang menjawab pertanyaan yang ada hubungannya berdasarkan data produk berikut:\n\n${dataProduk}\n\nTugasmu:\n1. Jawab dengan sopan dan ramah, berdasarkan data.\n2. Jika ditanya hal ringan seperti "ada yang lain?", "warna lain?", "yang lebih murah?", jawablah dengan profesional berdasarkan isi data.\n3. Jika tidak ada informasi yang relevan, balas:\n"Maaf, saya tidak menemukan informasi tersebut. Saya akan meneruskan pertanyaan ini ke admin."\n4. Jangan mengarang atau menggunakan informasi di luar data produk.`,
        },
        {
          role: 'user',
          content: userText,
        },
      ],
    });

    const jawaban = response.data.choices[0].message.content.trim();
    const lowerJawaban = jawaban.toLowerCase();

    const isAlihkanKeAdmin =
      lowerJawaban.includes('saya akan meneruskan') ||
      lowerJawaban.includes('tidak menemukan informasi') ||
      lowerJawaban.includes('saya tidak tahu');

    if (isAlihkanKeAdmin) {
      await kirimPesan(sock, m, 'saya adalah asisten AI untuk saat ini saya tidak bisa menjawab pertanyaan diluar dari yang diprogramkan ke saya, jadi pertanyaan kamu akan diteruskan ke Herwan.');
      logToAdmin(m.key.remoteJid, userText);
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
