const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  jidDecode,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const agent = require('./agent');
const emailAutomation = require('./emailAutomation');

const AUTH_FOLDER = path.join(__dirname, 'wa_auth');
if (!fs.existsSync(AUTH_FOLDER)) fs.mkdirSync(AUTH_FOLDER, { recursive: true });

let waSocket = null;
let isConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT = 10;

const lastReplied = new Map();
const REPLY_COOLDOWN_MS = 3000;

function canReply(jid) {
  const last = lastReplied.get(jid);
  if (!last) return true;
  return Date.now() - last > REPLY_COOLDOWN_MS;
}

function markReplied(jid) {
  lastReplied.set(jid, Date.now());
}

function getPhoneFromJid(jid) {
  try {
    const decoded = jidDecode(jid);
    return decoded?.user || jid.split('@')[0];
  } catch {
    return jid.split('@')[0];
  }
}

async function startWhatsApp() {
  try {
    console.log('🟡 WhatsApp connect ho raha hai...');

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
    
    let version;
    try {
      const result = await fetchLatestBaileysVersion();
      version = result.version;
    } catch(e) {
      version = [2, 3000, 1015901307];
      console.log('Using fallback WA version:', version);
    }

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: true,
      logger: pino({ level: 'silent' }),
      browser: ['Ubuntu', 'Chrome', '22.0.0'],
      connectTimeoutMs: 60000,
      retryRequestDelayMs: 5000,
      markOnlineOnConnect: false,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
    });

    waSocket = sock;

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('\n📱 WhatsApp QR Code scan karo:\n');
        qrcode.generate(qr, { small: true });
        console.log('\n⏳ 60 seconds mein scan karo!\n');
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

        if (statusCode === DisconnectReason.loggedOut) {
          console.log('🔴 Logged out! wa_auth folder delete karke redeploy karo.');
          try {
            fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
            fs.mkdirSync(AUTH_FOLDER, { recursive: true });
          } catch (e) {}
          setTimeout(startWhatsApp, 5000);
        } else if (shouldReconnect && reconnectAttempts < MAX_RECONNECT) {
          reconnectAttempts++;
          const delay = Math.min(reconnectAttempts * 5000, 30000);
          console.log(`🔄 Reconnecting in ${delay/1000}s... (attempt ${reconnectAttempts}/${MAX_RECONNECT})`);
          setTimeout(startWhatsApp, delay);
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        try {
          if (msg.key.fromMe) continue;
          if (msg.key.remoteJid === 'status@broadcast') continue;

          const jid = msg.key.remoteJid;
          const phone = getPhoneFromJid(jid);

          const text =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            null;

          if (!text) continue;

          console.log(`📩 Message from ${phone}: ${text.slice(0, 50)}`);

          if (!canReply(jid)) continue;

          await sock.sendPresenceUpdate('composing', jid);

          const session_id = `whatsapp_${phone}`;
          const result = await agent.processMessage(text, session_id, 'whatsapp');

          await sock.sendPresenceUpdate('paused', jid);
          await sock.sendMessage(jid, { text: result.reply });
          markReplied(jid);

          console.log(`✅ Replied | Intent: ${result.intent} | Score: ${result.lead_score}`);

          if (result.intent === 'new_lead') {
            const leads = agent.getLeads();
            const lead = leads.find(l => l.phone === phone);
            if (lead?.email) {
              emailAutomation.sendWelcomeSequence(lead);
            }
          }
        } catch (err) {
          console.error('❌ Message handle error:', err.message);
        }
      }
    });

  } catch (err) {
    console.error('❌ WhatsApp start error:', err.message);
    reconnectAttempts++;
    if (reconnectAttempts < MAX_RECONNECT) {
      const delay = Math.min(reconnectAttempts * 5000, 30000);
      console.log(`🔄 Retry in ${delay/1000}s...`);
      setTimeout(startWhatsApp, delay);
    }
  }
}

async function sendWhatsAppMessage(phone, message) {
  if (!waSocket || !isConnected) {
    throw new Error('WhatsApp connected nahi hai');
  }
  const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
  await waSocket.sendMessage(jid, { text: message });
}

function getStatus() {
  return { connected: isConnected, reconnectAttempts };
}

module.exports = { startWhatsApp, sendWhatsAppMessage, getStatus };
