const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const axios = require('axios');

const app = express();
// Naikkan limit JSON agar kuat menampung data Base64 gambar KTP
app.use(express.json({ limit: '50mb' }));

// 1. INITIALIZE BOT (Versi Server Production / Linux)
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        // executablePath DIHAPUS agar Puppeteer pakai Chromium bawaan server
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', // Wajib untuk server gratisan minim RAM
            '--single-process',        // Menghemat memori drastis
            '--no-zygote'
        ]
    }
});

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('^ Please scan the QR Code above with your WhatsApp account ^');
});

client.on('ready', () => {
    console.log('Medic AI Bot is ready and running!');
});

// --- FITUR ANTI-BENGONG (DISCONNECT HANDLER) ---
client.on('disconnected', (reason) => {
    console.log('-! [WARNING] Bot disconnected! Reason:', reason);
    console.log('-> Restarting client to recover...');
    client.destroy().then(() => {
        client.initialize();
    });
});

client.on('auth_failure', (msg) => {
    console.error('-! [ERROR] Authentication failure:', msg);
});
// -----------------------------------------------------------

// 2. INBOUND: WhatsApp -> n8n
client.on('message', async (msg) => {
    if (msg.from === 'status@broadcast' || msg.fromMe) return;

    // Biar di terminal kelihatan kalau yang masuk itu gambar/media
    console.log(`New message from ${msg.from}: ${msg.type === 'chat' ? msg.body : '[' + msg.type + ' received]'}`);

    // --- FITUR DOWNLOAD GAMBAR UNTUK OCR ---
    let base64Image = null;
    let mimeType = null;

    if (msg.hasMedia) {
        try {
            const media = await msg.downloadMedia();
            if (media) {
                base64Image = media.data; // Data gambar mentah (Base64)
                mimeType = media.mimetype; // Tipe file (misal: image/jpeg)
                console.log(`-> [INFO] Media downloaded successfully (${mimeType})`);
            }
        } catch (err) {
            console.log('-! [ERROR] Failed to download media:', err.message);
        }
    }
    // ---------------------------------------------------

    const payload = {
        chatId: msg.from,
        text: msg.body,
        hasMedia: msg.hasMedia,
        mimeType: mimeType,
        imageBase64: base64Image // Ini yang bakal ditarik sama n8n buat dibaca Gemini
    };

    const testUrl = 'https://n8n.jgt-test.my.id/webhook-test/medic-ai-wa';
    const prodUrl = 'https://n8n.jgt-test.my.id/webhook/medic-ai-wa';

    try {
        await axios.post(testUrl, payload);
        console.log('-> [TEST] Successfully sent to Webhook (Listen Mode)');

    } catch (error) {
        console.log('-> [INFO] Test Webhook inactive. Retrying via Production URL...');

        try {
            await axios.post(prodUrl, payload);
            console.log('-> [PROD] Successfully sent to n8n Production (Active Workflow)');
        } catch (prodError) {
            console.log('-! [ERROR] Failed to send to n8n. Please ensure the service is running.');
        }
    }
});

// 3. OUTBOUND: n8n -> WhatsApp
app.post('/api/send', async (req, res) => {
    const { chatId, text } = req.body;
    if (!chatId || !text) return res.status(400).send('Incomplete data');

    try {
        await client.sendMessage(chatId, text);
        res.status(200).send('Message successfully sent to WhatsApp!');
    } catch (error) {
        res.status(500).send('Failed to send: ' + error.message);
    }
});

app.post('/api/typing', async (req, res) => {
    const { chatId } = req.body;
    try {
        const chat = await client.getChatById(chatId);
        await chat.sendStateTyping();
        res.status(200).send('Typing status activated!');
    } catch (error) {
        res.status(500).send('Failed to send typing status: ' + error.message);
    }
});

// 4. RUN SERVER (Versi Production)
client.initialize();

// Port dinamis mengikuti environment dari Render, dengan fallback ke 3000 kalau di-test lokal
const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => console.log(`Server standing by on port ${port}...`));