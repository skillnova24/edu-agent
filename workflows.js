const cron = require('node-cron');
const agent = require('./agent');
const emailAutomation = require('./emailAutomation');

function startWorkflows() {
  console.log('Starting workflows...');
  
  // Workflow A: Follow-up Reminder - Every 24 hours at 9 AM
  cron.schedule('0 9 * * *', async () => {
    console.log('Running follow-up reminder workflow...');
    try {
      const leads = agent.getLeads();
      const now = new Date();
      
      for (const lead of leads) {
        if (lead.status === 'warm' && lead.last_contacted) {
          const lastContacted = new Date(lead.last_contacted);
          const hoursDiff = (now - lastContacted) / (1000 * 60 * 60);
          
          if (hoursDiff >= 24) {
            // Generate follow-up message via AI
            const followUpMessage = "Bhai, kal baat hui thi course ke bare mein. Koi sawal hai? Agar purchase karna hai toh link hai: https://edubazar.shop/courses 😊";
            
            // Log the follow-up
            const sessionId = lead.phone ? `whatsapp_${lead.phone}` : `email_${lead.email}`;
            await agent.logInteraction(sessionId, {
              channel: lead.channel,
              user_message: "System follow-up reminder",
              ai_response: followUpMessage,
              intent: "follow_up",
              leadScore: Math.min(lead.lead_score + 5, 100) // Increase score for engagement
            });
            
            console.log(`Follow-up sent to lead ${lead.id}`);
          }
        }
      }
    } catch (error) {
      console.error('Error in follow-up reminder workflow:', error);
    }
  });
  
  // Workflow B: Lead Scoring - Every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    console.log('Running lead scoring workflow...');
    try {
      const leads = agent.getLeads();
      const now = new Date();
      
      for (const lead of leads) {
        let scoreAdjustment = 0;
        
        // Messages count: +5 each (max +25)
        const messagePoints = Math.min(lead.messages.length * 5, 25);
        scoreAdjustment += messagePoints;
        
        // Asked about price: +20 (check if any message contains price-related keywords)
        const priceKeywords = ['price', 'cost', 'fee', 'paise', 'rupaya', 'daam', 'kitna'];
        const askedAboutPrice = lead.messages.some(msg => 
          priceKeywords.some(keyword => 
            msg.user_message.toLowerCase().includes(keyword)
          )
        );
        if (askedAboutPrice) scoreAdjustment += 20;
        
        // Category specified: +15
        if (lead.category_interest) scoreAdjustment += 15;
        
        // Returned after 1 day: +25
        if (lead.messages.length > 1) {
          const firstMessage = new Date(lead.messages[0].timestamp);
          const lastMessage = new Date(lead.messages[lead.messages.length - 1].timestamp);
          const daysDiff = (lastMessage - firstMessage) / (1000 * 60 * 60 * 24);
          if (daysDiff >= 1) scoreAdjustment += 25;
        }
        
        // Cart behavior: +30 (simulated - in real app would check cart abandonment)
        // For now, we'll add this if lead has shown interest but not converted
        if (lead.status === 'interested' || lead.status === 'hot') {
          scoreAdjustment += 30;
        }
        
        // Apply score adjustment (but don't decrease score)
        if (scoreAdjustment > 0) {
          const newScore = Math.min(lead.lead_score + scoreAdjustment, 100);
          if (newScore !== lead.lead_score) {
            lead.lead_score = newScore;
            lead.status = calculateStatusFromScore(newScore);
            
            // Update last contacted time
            lead.last_contacted = now.toISOString();
            
            console.log(`Updated lead ${lead.id} score from ${lead.lead_score - scoreAdjustment} to ${newScore}`);
          }
        }
      }
      
      // Save updated leads
      agent.saveData();
      
      // Update analytics
      agent.updateAnalytics();
      
    } catch (error) {
      console.error('Error in lead scoring workflow:', error);
    }
  });
  
  // Workflow C: Daily Report - Every day at 9 PM
  cron.schedule('0 21 * * *', async () => {
    console.log('Running daily report workflow...');
    try {
      const analytics = agent.getAnalytics();
      
      const topCategory = Object.entries(analytics.leadsByCategory || {})
        .sort((a, b) => b[1] - a[1]);
      
      const report = `
📊 EduBazar Daily Report - ${new Date().toLocaleDateString()}
├── Total Leads: ${analytics.totalLeads}
├── Hot Leads: ${analytics.hotLeads}
├── Converted: ${analytics.convertedLeads}
├── Revenue: ₹${analytics.revenue}
├── Top Category: ${topCategory.length > 0 ? `${topCategory[0][0]} (${topCategory[0][1]} leads)` : 'None'}
└── Conversion Funnel: 
    New: ${analytics.conversionFunnel.new} → 
    Warm: ${analytics.conversionFunnel.warm} → 
    Hot: ${analytics.conversionFunnel.hot} → 
    Converted: ${analytics.conversionFunnel.converted}
      `.trim();
      
      console.log(report);
      
      // In a real app, we would send this to WhatsApp or email
      // For now, just log it
      
    } catch (error) {
      console.error('Error in daily report workflow:', error);
    }
  });
  
  console.log('All workflows started successfully');
}

function calculateStatusFromScore(score) {
  if (score >= 90) return "converted";
  if (score >= 60) return "hot";
  if (score >= 30) return "warm";
  return "new";
}

module.exports = {
  startWorkflows
};