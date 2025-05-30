// Import library yang dibutuhkan
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  generateMessageID,
  generateWAMessageFromContent,
} = require('@whiskeysockets/baileys');

require('./keepalive'); // agar tetap aktif

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

// Fungsi bantu untuk ambil isi pesan teks dari berbagai format
function getPesanTeks(msg) {
  return msg.message?.conversation ||
         msg.message?.extendedTextMessage?.text ||
         null;
}

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

// Fungsi untuk kirim pesan ke admin (WA: +6285821255044)
async function kirimKeAdminLangsung(sock, pesan) {
  const adminJid = '62895385191311@s.whatsapp.net';
  const message = generateWAMessageFromContent(adminJid, {
    conversation: pesan,
  }, {});
  await sock.relayMessage(adminJid, message.message, {
    messageId: generateMessageID(),
  });
}

// Fungsi untuk mengirim pesan ke Groq (LLM)
async function kirimPesanKeChatGroq(sock, m) {
  try {
    const userText = getPesanTeks(m)?.trim() || '';
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
          content: `Kamu adalah AI Marketing profesional yang sopan, ramah, dan proaktif. Tugas kamu adalah membantu calon customer yang tertarik dengan Hydraulic Breaker dari toko kami. Jawabanmu selalu menggunakan bahasa Indonesia, singkat, jelas, dan berbasis data produk di bawah.

Panduan utama kamu:

1. TIDAK BOLEH mengarang jawaban. Jawab hanya jika informasinya tertulis jelas di data produk.
2. Jika data kurang lengkap, jangan langsung jawab. Tanyakan dulu ke user:
   - Model atau kapasitas excavator mereka
   - Jenis pekerjaan yang akan dilakukan (batu, konstruksi, tanah, dll)
   - Di mana lokasi alat berat
   - Breaker dibutuhkan untuk kelas berapa ton
3. Jika customer terlihat bingung, bantu arahkan dengan bertanya: "Boleh tahu, excavator Anda berapa ton?" atau "Untuk area mana alat ini digunakan?"
4. Jika ditanya tentang fitur yang tidak ada di data produk (misalnya: warna, stok), jawab:
   "Maaf, saya tidak menemukan informasi tersebut dalam data. Saya akan teruskan ke Admin."
5. Jika semua info sudah cukup, bantu pilihkan produk yang cocok dari data yang tersedia, sebutkan nama produknya dan harganya jika ada.
6. Akhiri setiap jawaban dengan pertanyaan lanjutan agar percakapan tidak putus.
7. JANGAN MENAWARKAN ATAU MENYEBUT FITUR seperti warna, stok, harga jika tidak ada di data produk.

Gunakan data produk berikut sebagai referensi:

${dataProduk}
`,
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
      /saya.*tidak.*(bisa|dapat).*jawab/.test(lowerJawaban) ||
      lowerJawaban.includes('saya akan meneruskan') ||
      lowerJawaban.includes('tidak menemukan informasi') ||
      lowerJawaban.includes('saya tidak tahu');

    if (isAlihkanKeAdmin) {
      const nomorUser = m.key.remoteJid.replace('@s.whatsapp.net', '');
      const notifikasi = `📩 Pertanyaan dari https://wa.me/${nomorUser}:\n"${userText}"\nTidak bisa dijawab oleh AI.`;

      await kirimPesan(sock, m, 'Saya adalah asisten AI. Untuk saat ini saya tidak bisa menjawab pertanyaan di luar dari yang diprogramkan ke saya, jadi pertanyaan kamu akan diteruskan ke Admin.');
      logToAdmin(m.key.remoteJid, userText);
      await kirimKeAdminLangsung(sock, notifikasi);
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
  const teks = getPesanTeks(m);
  if (!teks) return;
  console.log('Pesan masuk dari', m.key.remoteJid, ':', teks);
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

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    console.log('\n=== Event messages.upsert ===');
    console.log('Tipe update:', type);
    console.log('Isi messages:', JSON.stringify(messages, null, 2));

    const msg = messages?.[0];
    if (!msg) {
      console.log('Pesan kosong. Tidak diproses.');
      return;
    }

    const isFromMe = msg.key.fromMe;
    const teks = getPesanTeks(msg);
    console.log('Dari saya sendiri?:', isFromMe);
    console.log('Isi teks pesan:', teks);

    if (!isFromMe && teks) {
      console.log('>> Menjalankan handlePesan...');
      await handlePesan(sock, msg);
    } else {
      console.log('>> Pesan tidak diproses karena tidak memenuhi syarat.');
    }
  });
}

startBot();
