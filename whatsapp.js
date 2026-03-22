const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
  jidDecode,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const agent = require('./agent');
const emailAutomation = require('./emailAutomation');

// Auth session folder — Railway pe bhi persist hoga
const AUTH_FOLDER = path.join(__dirname, 'wa_auth');
if (!fs.existsSync(AUTH_FOLDER)) fs.mkdirSync(AUTH_FOLDER);

let waSocket = null;
let isConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT = 5;

// Rate limiting — spam se bachne ke liye
const lastReplied = new Map();
const REPLY_COOLDOWN_MS = 3000; // 3 sec cooldown per number

function canReply(jid) {
  const last = lastReplied.get(jid);
  if (!last) return true;
  return Date.now() - last > REPLY_COOLDOWN_MS;
}

function markReplied(jid) {
  lastReplied.set(jid, Date.now());
}

// Jid se phone number nikalna
function getPhoneFromJid(jid) {
  try {
    const decoded = jidDecode(jid);
    return decoded?.user || jid.split('@')[0];
  } catch {
    return jid.split('@')[0];
  }
}

async function startWhatsApp() {
  console.log('🟡 WhatsApp connect ho raha hai...');

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false, // Hum manually handle karenge
    logger: pino({ level: 'silent' }), // Logs quiet rakhne ke liye
    browser: ['EduBazar Agent', 'Chrome', '120.0'],
    connectTimeoutMs: 30000,
    retryRequestDelayMs: 2000,
    markOnlineOnConnect: false, // Battery save
  });

  waSocket = sock;

  // QR Code — pehli baar scan karna hoga
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📱 WhatsApp QR Code — Phone se scan karo:\n');
      qrcode.generate(qr, { small: true });
      console.log('\n⏳ 60 seconds mein scan karo...\n');
    }

    if (connection === 'open') {
      console.log('✅ WhatsApp connected! 24/7 chalu hai.');
      isConnected = true;
      reconnectAttempts = 0;
    }

    if (connection === 'close') {
      isConnected = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(`⚠️ WhatsApp disconnected. Code: ${statusCode}`);

      if (shouldReconnect && reconnectAttempts < MAX_RECONNECT) {
        reconnectAttempts++;
        const delay = reconnectAttempts * 5000; // 5s, 10s, 15s...
        console.log(`🔄 Reconnecting in ${delay / 1000}s... (attempt ${reconnectAttempts}/${MAX_RECONNECT})`);
        setTimeout(startWhatsApp, delay);
      } else if (statusCode === DisconnectReason.loggedOut) {
        console.log('🔴 Logged out! Dobara QR scan karna hoga. wa_auth folder delete karo.');
        // Auth folder delete karo taaki fresh QR aaye
        try {
          fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
          fs.mkdirSync(AUTH_FOLDER);
        } catch (e) {}
        setTimeout(startWhatsApp, 3000);
      } else {
        console.log('❌ Max reconnect attempts reached. Server restart karo.');
      }
    }
  });

  // Credentials save karo
  sock.ev.on('creds.update', saveCreds);

  // Incoming messages handle karo
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        // Skip karo: apna message, broadcast, status update
        if (msg.key.fromMe) continue;
        if (msg.key.remoteJid === 'status@broadcast') continue;

        const jid = msg.key.remoteJid;
        const phone = getPhoneFromJid(jid);

        // Text message nikalo
        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          null;

        if (!text) continue; // Non-text messages ignore

        console.log(`📩 Message from ${phone}: ${text.slice(0, 50)}...`);

        // Rate limit check
        if (!canReply(jid)) {
          console.log(`⏳ Cooldown active for ${phone}, skipping`);
          continue;
        }

        // Typing indicator — human jaisa lagega
        await sock.sendPresenceUpdate('composing', jid);

        // AI se reply lo
        const session_id = `whatsapp_${phone}`;
        const result = await agent.processMessage(text, session_id, 'whatsapp');

        // Typing stop karo
        await sock.sendPresenceUpdate('paused', jid);

        // Reply bhejo
        await sock.sendMessage(jid, { text: result.reply });
        markReplied(jid);

        console.log(`✅ Replied to ${phone} | Intent: ${result.intent} | Score: ${result.lead_score}`);

        // Naya lead hai aur email mila toh welcome email bhejo
        if (result.intent === 'new_lead') {
          const leads = agent.getLeads();
          const lead = leads.find(l => l.phone === phone);
          if (lead?.email) {
            emailAutomation.sendWelcomeSequence(lead);
            console.log(`📧 Welcome email queued for ${lead.email}`);
          }
        }

      } catch (err) {
        console.error('❌ Message handle error:', err.message);
      }
    }
  });

  return sock;
}

// Message bhejne ka function (server.js se call hoga)
async function sendWhatsAppMessage(phone, message) {
  if (!waSocket || !isConnected) {
    throw new Error('WhatsApp connected nahi hai');
  }
  const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
  await waSocket.sendMessage(jid, { text: message });
  console.log(`📤 Sent to ${phone}`);
}

function getStatus() {
  return {
    connected: isConnected,
    reconnectAttempts,
  };
}

module.exports = { startWhatsApp, sendWhatsAppMessage, getStatus };
