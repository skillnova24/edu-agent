const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const agent = require('./agent');
const cron = require('node-cron');

// Email queue storage
let emailQueue = [];

// Load email queue from file
function loadEmailQueue() {
  try {
    const queuePath = path.join(__dirname, 'emailQueue.json');
    if (fs.existsSync(queuePath)) {
      const data = fs.readFileSync(queuePath, 'utf8');
      emailQueue = JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading email queue:', error);
    emailQueue = [];
  }
}

// Save email queue to file
function saveEmailQueue() {
  try {
    fs.writeFileSync(path.join(__dirname, 'emailQueue.json'), JSON.stringify(emailQueue, null, 2));
  } catch (error) {
    console.error('Error saving email queue:', error);
  }
}

// Initialize nodemailer transporter
let transporter = null;

function initTransporter() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.warn('Gmail credentials not configured. Email functionality will be disabled.');
    return;
  }
  
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });
  
  // Verify connection
  transporter.verify((error, success) => {
    if (error) {
      console.error('Error connecting to Gmail:', error);
    } else {
      console.log('Gmail transporter is ready to send emails');
    }
  });
}

// Send email function
async function sendEmail(to, subject, body) {
  if (!transporter) {
    throw new Error('Email transporter not initialized. Check Gmail credentials.');
  }
  
  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: to,
    subject: subject,
    text: body
  };
  
  return new Promise((resolve, reject) => {
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error('Error sending email:', error);
        reject(error);
      } else {
        console.log('Email sent:', info.response);
        resolve(info);
      }
    });
  });
}

// Add email to queue
function queueEmail(to, subject, body, metadata = {}) {
  const email = {
    id: Math.random().toString(36).substr(2, 9),
    to,
    subject,
    body,
    metadata,
    createdAt: new Date().toISOString(),
    attempts: 0,
    maxAttempts: 3
  };
  
  emailQueue.push(email);
  saveEmailQueue();
  console.log(`Email queued for ${to}: ${subject}`);
}

// Process email queue
function processEmailQueue() {
  if (!transporter) {
    console.log('Email transporter not available, skipping queue processing');
    return;
  }
  
  console.log(`Processing email queue (${emailQueue.length} emails)`);
  
  // Process emails that haven't exceeded max attempts
  emailQueue = emailQueue.filter(email => {
    if (email.attempts >= email.maxAttempts) {
      console.log(`Email ${email.id} exceeded max attempts, removing from queue`);
      return false;
    }
    
    // Attempt to send email
    sendEmail(email.to, email.subject, email.body)
      .then(() => {
        console.log(`Email ${email.id} sent successfully`);
        return false; // Remove from queue after successful send
      })
      .catch(error => {
        console.error(`Failed to send email ${email.id}:`, error);
        email.attempts++;
        return true; // Keep in queue for retry
      });
    
    return true; // Keep in queue while waiting for async operation
  });
  
  saveEmailQueue();
}

// Welcome email sequence
function sendWelcomeSequence(lead) {
  // Day 0: Welcome email + ₹100 off mention
  const welcomeEmail = {
    to: lead.email,
    subject: "Welcome to EduBazar! 🎁 Special Gift Inside",
    body: `
Hi ${lead.name || 'there'},

Welcome to EduBazar - India's premium e-learning platform! 🎉

As a welcome gift, enjoy an extra ₹100 OFF on any course today!
Use code: WELCOME100 at checkout.

Explore our popular courses:
• Ethical Hacking Bootcamp: ₹499 (₹3,999)
• Python Masterclass: ₹399 (₹3,499) 
• Stock Market Masterclass: ₹499 (₹3,999)
• ChatGPT Prompt Engineering: ₹299 (₹2,999)

👉 Browse all courses: https://edubazar.shop/courses

Hurry, this offer expires in 24 hours!

Best regards,
Team EduBazar
edubazarshop@gmail.com | WhatsApp: +91 97591 31256
    `.trim()
  };
  
  queueEmail(welcomeEmail.to, welcomeEmail.subject, welcomeEmail.body, {
    type: 'welcome',
    leadId: lead.id,
    day: 0
  });
  
  // Schedule follow-up emails (in a real app, we'd use a proper job scheduler)
  // For demo purposes, we're just showing the logic
  
  console.log(`Welcome sequence initiated for lead ${lead.id}`);
}

// Post-purchase email sequence
function sendPostPurchaseSequence(lead) {
  // Immediately: Purchase confirmation + how to access
  const confirmationEmail = {
    to: lead.email,
    subject: "Your EduBazar Purchase Confirmation 🎉",
    body: `
Hi ${lead.name || 'there'},

Congratulations on your purchase! 🎊

Your course access details:
🌐 Login URL: https://edubazar.shop/account
📧 Username: ${lead.email}
🔐 Password: Check your email for temporary password (sent separately)

📚 Available Courses:
${lead.category_interest ? `• ${getCourseName(lead.category_interest)}` : 'Check your dashboard for all enrolled courses'}

💡 Need help? Reply to this email or WhatsApp us at +91 97591 31256

Happy learning!
Team EduBazar
    `.trim()
  };
  
  queueEmail(confirmationEmail.to, confirmationEmail.subject, confirmationEmail.body, {
    type: 'purchase_confirmation',
    leadId: lead.id,
    day: 0
  });
  
  console.log(`Post-purchase sequence initiated for lead ${lead.id}`);
}

// Helper function to get course name from category
function getCourseName(category) {
  const courseMap = {
    hacking: 'Ethical Hacking Bootcamp',
    programming: 'Python Masterclass',
    trading: 'Stock Market Masterclass',
    business: 'Digital Marketing Masterclass',
    ai: 'ChatGPT Prompt Engineering Bootcamp',
    android: 'Android + Kotlin Complete'
  };
  
  return courseMap[category] || 'EduBazar Course';
}

// Start email automation workflows
function startEmailSequences() {
  console.log('Starting email automation...');
  
  // Load existing queue
  loadEmailQueue();
  
  // Initialize transporter
  initTransporter();
  
  // Process email queue every hour
  cron.schedule('0 * * * *', () => {
    console.log('Processing email queue...');
    processEmailQueue();
  });
  
  console.log('Email automation started');
}

// Helper function to save data (needed for workflows)
function saveData() {
  // This would normally call agent.saveData(), but to avoid circular dependency
  // we'll just note that the agent handles its own saving
  // In a real implementation, we'd restructure to avoid this
}

module.exports = {
  sendEmail,
  queueEmail,
  processEmailQueue,
  sendWelcomeSequence,
  sendPostPurchaseSequence,
  startEmailSequences
};