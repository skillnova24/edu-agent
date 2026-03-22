const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();

// Import routes and services
const agent = require('./agent');
const workflows = require('./workflows');
const emailAutomation = require('./emailAutomation');
const whatsapp = require('./whatsapp');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Chat endpoint
app.post('/chat', async (req, res) => {
  try {
    const { message, session_id, channel } = req.body;
    const result = await agent.processMessage(message, session_id, channel);
    res.json(result);
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      reply: 'Maaf karo, kuch technical problem hai. Thodi der baad try karo.'
    });
  }
});

// WhatsApp webhook endpoint
app.post('/whatsapp/webhook', async (req, res) => {
  try {
    const { from, message, name } = req.body;
    const session_id = `whatsapp_${from}`;
    const result = await agent.processMessage(message, session_id, 'whatsapp');
    
    // Log the interaction for lead tracking
    await agent.logInteraction(session_id, {
      channel: 'whatsapp',
      from,
      message,
      name,
      intent: result.intent,
      leadScore: result.lead_score
    });
    
    res.json({ 
      reply: result.reply,
      intent: result.intent,
      suggested_action: result.suggested_action
    });
  } catch (error) {
    console.error('WhatsApp webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Email incoming endpoint
app.post('/email/incoming', async (req, res) => {
  try {
    const { from, subject, body, name } = req.body;
    const session_id = `email_${from}`;
    const result = await agent.processMessage(`${subject}: ${body}`, session_id, 'email');
    
    // Log the interaction for lead tracking
    await agent.logInteraction(session_id, {
      channel: 'email',
      from,
      subject,
      body: body.substring(0, 100) + '...', // Truncate for storage
      name,
      intent: result.intent,
      leadScore: result.lead_score
    });
    
    res.json({ 
      draft: {
        subject: `Re: ${subject}`,
        body: result.reply
      },
      intent: result.intent,
      suggested_action: result.suggested_action
    });
  } catch (error) {
    console.error('Email incoming error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Send email endpoint
app.post('/email/send', async (req, res) => {
  try {
    const { to, subject, body } = req.body;
    await emailAutomation.sendEmail(to, subject, body);
    res.json({ success: true, message: 'Email sent successfully' });
  } catch (error) {
    console.error('Email send error:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// Leads endpoints
app.get('/leads', (req, res) => {
  try {
    const leads = agent.getLeads();
    res.json(leads);
  } catch (error) {
    console.error('Get leads error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/leads', (req, res) => {
  try {
    const leadData = req.body;
    const newLead = agent.createLead(leadData);
    res.status(201).json(newLead);
  } catch (error) {
    console.error('Create lead error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Analytics endpoint
app.get('/analytics', (req, res) => {
  try {
    const analytics = agent.getAnalytics();
    res.json(analytics);
  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// WhatsApp status endpoint
app.get('/whatsapp/status', (req, res) => {
  res.json(whatsapp.getStatus());
});

// Send WhatsApp message manually
app.post('/whatsapp/send', async (req, res) => {
  try {
    const { phone, message } = req.body;
    await whatsapp.sendWhatsAppMessage(phone, message);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Initialize workflows
workflows.startWorkflows();
emailAutomation.startEmailSequences();

// Start WhatsApp bot
whatsapp.startWhatsApp().catch(err => console.error('WhatsApp start error:', err));

// Start server
app.listen(PORT, () => {
  console.log(`EduBazar AI Sales Agent running on port ${PORT}`);
});

module.exports = app;