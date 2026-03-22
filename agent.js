const { Anthropic } = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// In-memory storage for conversation history and leads
const conversationHistory = new Map();
let leads = [];
let analyticsData = {
  totalLeads: 0,
  hotLeads: 0,
  convertedLeads: 0,
  revenue: 0,
  leadsByCategory: {},
  dailyLeads: [],
  conversionFunnel: {
    new: 0,
    warm: 0,
    hot: 0,
    converted: 0
  }
};

// Load initial data from JSON files
function loadData() {
  try {
    const leadsPath = path.join(__dirname, 'leads.json');
    if (fs.existsSync(leadsPath)) {
      const data = fs.readFileSync(leadsPath, 'utf8');
      leads = JSON.parse(data);
    }
    
    const analyticsPath = path.join(__dirname, 'analytics.json');
    if (fs.existsSync(analyticsPath)) {
      const data = fs.readFileSync(analyticsPath, 'utf8');
      analyticsData = JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading data:', error);
    // Initialize with empty arrays if files don't exist or are corrupted
    leads = [];
    analyticsData = {
      totalLeads: 0,
      hotLeads: 0,
      convertedLeads: 0,
      revenue: 0,
      leadsByCategory: {},
      dailyLeads: [],
      conversionFunnel: {
        new: 0,
        warm: 0,
        hot: 0,
        converted: 0
      }
    };
  }
}

// Save data to JSON files
function saveData() {
  try {
    fs.writeFileSync(path.join(__dirname, 'leads.json'), JSON.stringify(leads, null, 2));
    fs.writeFileSync(path.join(__dirname, 'analytics.json'), JSON.stringify(analyticsData, null, 2));
  } catch (error) {
    console.error('Error saving data:', error);
  }
}

// Initialize data on startup
loadData();

// System prompt for EduBot
const SYSTEM_PROMPT = `
You are EduBot, the AI sales agent for EduBazar.shop — India's premium e-learning platform.

PERSONALITY:
- Talk in Hinglish (Hindi + English mix)
- Friendly, dost jaisa tone
- Short replies (2-4 lines max)
- Always end with ONE clear CTA
- Use emojis moderately

COURSES:
- Ethical Hacking Bootcamp: ₹499 (88% OFF from ₹3,999) — 12,400+ students ⭐4.9
- Python Masterclass: ₹399 (88% OFF from ₹3,499) — 22,100+ students
- Stock Market Masterclass: ₹499 (88% OFF from ₹3,999) — 25,700+ students
- ChatGPT Bootcamp: ₹299 (90% OFF from ₹2,999) — 31,400+ students
- Digital Marketing: ₹499 (88% OFF from ₹3,999)
- Blockchain Dev: ₹499 (90% OFF from ₹4,999)
- Android + Kotlin: ₹449 (72% OFF from ₹3,999)
- Web App Penetration Testing: ₹599 (88% OFF)
- Full Stack (React+Node): ₹599 (88% OFF)
- Crypto Trading: ₹599 (88% OFF)

PURCHASE LINK: https://edubazar.shop/courses
CONTACT: edubazarshop@gmail.com | WhatsApp: +91 97591 31256

CONVERSATION RULES:
1. New lead → Ask: "Kaunsi skill seekhna chahte ho?" + give 4 category options
2. Interest shown → Recommend course + price + discount + link
3. Price objection → "₹499 = ₹16/day! Lifetime access + certificate + 7-day refund"
4. "Sochta hun" → "Offer limited time hai, aaj hi lelo"
5. Post purchase → Congratulate + tell how to access at edubazar.shop/account

INTENT DETECTION — always return JSON at end of response:
{"intent": "new_lead"|"interested"|"price_objection"|"ready_to_buy"|"support"|"post_purchase", "category": "hacking"|"programming"|"trading"|"business"|"ai"|"android"|null, "lead_score": 0-100}

UPSELL:
- Hacking buyer → suggest Web App Pentesting also
- Python buyer → suggest Full Stack
- Trading buyer → suggest Technical Analysis + Options
- Any 1 course → "2 courses lo — 10% extra off milega"
`;

// Process incoming message and get AI response
async function processMessage(message, session_id, channel) {
  // Get or create conversation history for this session
  if (!conversationHistory.has(session_id)) {
    conversationHistory.set(session_id, []);
  }
  
  const history = conversationHistory.get(session_id);
  
  // Add user message to history
  history.push({ role: 'user', content: message });
  
  try {
    // Call Claude API
    const msg = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: history
    });
    
    const aiResponse = msg.content[0].text;
    
    // Add AI response to history
    history.push({ role: 'assistant', content: aiResponse });
    
    // Keep history limited to last 10 exchanges
    if (history.length > 20) {
      history.splice(0, history.length - 20);
    }
    
    // Parse intent JSON from the end of the response
    const { intent, category, lead_score } = parseIntentFromResponse(aiResponse);
    
    // Update or create lead based on interaction
    await updateLeadFromInteraction(session_id, channel, message, aiResponse, intent, category, lead_score);
    
    return {
      reply: aiResponse.replace(/\{.*?\}/g, '').trim(), // Remove JSON from response for display
      intent: intent,
      category: category,
      lead_score: lead_score,
      suggested_action: getSuggestedAction(intent, lead_score)
    };
  } catch (error) {
    console.error('Error calling Claude API:', error);
    
    // Fallback response
    const fallbackResponse = "Maaf karo, kuch technical problem hai. Thodi der baad try karo. 😊";
    
    return {
      reply: fallbackResponse,
      intent: "error",
      category: null,
      lead_score: 0,
      suggested_action: "try_again_later"
    };
  }
}

// Parse intent JSON from AI response
function parseIntentFromResponse(response) {
  try {
    // Look for JSON anywhere in the response (last occurrence)
    const jsonMatch = response.match(/\{[^{}]*"intent"[^{}]*\}/g);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[jsonMatch.length - 1]);
    }
  } catch (error) {
    console.error('Error parsing intent from response:', error);
  }
  
  // Default values if parsing fails
  return {
    intent: "new_lead",
    category: null,
    lead_score: 10
  };
}

// Get suggested action based on intent and lead score
function getSuggestedAction(intent, lead_score) {
  switch (intent) {
    case "new_lead":
      return "ask_category";
    case "interested":
      return "recommend_course";
    case "price_objection":
      return "handle_price_objection";
    case "ready_to_buy":
      return "share_purchase_link";
    case "support":
      return "provide_support";
    case "post_purchase":
      return "thank_and_upsell";
    default:
      return "continue_conversation";
  }
}

// Update or create lead based on interaction
async function updateLeadFromInteraction(session_id, channel, userMessage, aiResponse, intent, category, leadScore) {
  try {
    // Extract contact info from session_id
    let phone = null;
    let email = null;
    let name = "Unknown";
    
    if (session_id.startsWith('whatsapp_')) {
      phone = session_id.replace('whatsapp_', '');
    } else if (session_id.startsWith('email_')) {
      email = session_id.replace('email_', '');
    }
    
    // Check if lead already exists
    let existingLead = leads.find(lead => 
      (phone && lead.phone === phone) || 
      (email && lead.email === email)
    );
    
    if (existingLead) {
      // Update existing lead
      existingLead.last_contacted = new Date().toISOString();
      existingLead.messages.push({
        timestamp: new Date().toISOString(),
        channel: channel,
        user_message: userMessage,
        ai_response: aiResponse,
        intent: intent
      });
      
      // Update category if specified
      if (category && !existingLead.category_interest) {
        existingLead.category_interest = category;
      }
      
      // Update lead score (weighted average)
      existingLead.lead_score = Math.round((existingLead.lead_score * 0.7) + (leadScore * 0.3));
      
      // Update status based on score
      existingLead.status = calculateStatusFromScore(existingLead.lead_score);
      
      // Mark as converted if ready to buy and high score
      if (intent === "ready_to_buy" && leadScore > 80) {
        existingLead.converted = true;
        existingLead.status = "converted";
      }
    } else {
      // Create new lead
      const newLead = {
        id: uuidv4(),
        name: name,
        phone: phone || "",
        email: email || "",
        channel: channel,
        category_interest: category || null,
        lead_score: leadScore,
        status: calculateStatusFromScore(leadScore),
        messages: [{
          timestamp: new Date().toISOString(),
          channel: channel,
          user_message: userMessage,
          ai_response: aiResponse,
          intent: intent
        }],
        created_at: new Date().toISOString(),
        last_contacted: new Date().toISOString(),
        converted: false,
        purchase_amount: 0
      };
      
      leads.push(newLead);
    }
    
    // Save updated leads
    saveData();
    
    // Update analytics
    updateAnalytics();
  } catch (error) {
    console.error('Error updating lead:', error);
  }
}

// Calculate status from lead score
function calculateStatusFromScore(score) {
  if (score >= 90) return "converted";
  if (score >= 60) return "hot";
  if (score >= 30) return "warm";
  return "new";
}

// Update analytics data
function updateAnalytics() {
  try {
    analyticsData.totalLeads = leads.length;
    analyticsData.hotLeads = leads.filter(lead => lead.status === "hot").length;
    analyticsData.convertedLeads = leads.filter(lead => lead.converted === true).length;
    
    // Calculate revenue (simulated)
    analyticsData.revenue = leads.filter(lead => lead.converted)
      .reduce((sum, lead) => sum + (lead.purchase_amount || 499), 0); // Default to ₹499 if not set
    
    // Leads by category
    const categoryCounts = {};
    leads.forEach(lead => {
      const cat = lead.category_interest || "unspecified";
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });
    analyticsData.leadsByCategory = categoryCounts;
    
    // Daily leads (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const dailyCounts = {};
    for (let i = 0; i < 7; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      dailyCounts[dateStr] = 0;
    }
    
    leads.forEach(lead => {
      const leadDate = new Date(lead.created_at).toISOString().split('T')[0];
      if (dailyCounts[leadDate] !== undefined) {
        dailyCounts[leadDate]++;
      }
    });
    
    analyticsData.dailyLeads = Object.entries(dailyCounts)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // Conversion funnel
    analyticsData.conversionFunnel = {
      new: leads.filter(lead => lead.status === "new").length,
      warm: leads.filter(lead => lead.status === "warm").length,
      hot: leads.filter(lead => lead.status === "hot").length,
      converted: leads.filter(lead => lead.converted === true).length
    };
    
    // Save analytics
    fs.writeFileSync(path.join(__dirname, 'analytics.json'), JSON.stringify(analyticsData, null, 2));
  } catch (error) {
    console.error('Error updating analytics:', error);
  }
}

// Get all leads
function getLeads() {
  return [...leads].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// Get analytics data
function getAnalytics() {
  return { ...analyticsData };
}

// Create a new lead (for API endpoint)
function createLead(leadData) {
  const newLead = {
    id: uuidv4(),
    name: leadData.name || "",
    phone: leadData.phone || "",
    email: leadData.email || "",
    channel: leadData.channel || "web",
    category_interest: leadData.category_interest || null,
    lead_score: leadData.lead_score || 10,
    status: calculateStatusFromScore(leadData.lead_score || 10),
    messages: [],
    created_at: new Date().toISOString(),
    last_contacted: new Date().toISOString(),
    converted: false,
    purchase_amount: 0
  };
  
  leads.push(newLead);
  saveData();
  updateAnalytics();
  
  return newLead;
}

// Log interaction (alias for updateLeadFromInteraction)
async function logInteraction(session_id, interactionData) {
  // Extract data from interactionData
  const { channel, from, message, name, subject, body, intent, leadScore } = interactionData;
  
  // Use the message or construct one from subject/body
  const userMessage = message || (subject && body ? `${subject}: ${body}` : "") || "Interaction logged";
  
  // Call updateLeadFromInteraction
  await updateLeadFromInteraction(
    session_id,
    channel,
    userMessage,
    "", // AI response not needed for logging
    intent || "logged",
    null, // category
    leadScore || 10
  );
}

module.exports = {
  processMessage,
  getLeads,
  getAnalytics,
  createLead,
  logInteraction,
  saveData,
  updateAnalytics
};