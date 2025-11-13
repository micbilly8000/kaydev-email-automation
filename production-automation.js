#!/usr/bin/env node
import Imap from 'imap';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

// Track forwarded emails to avoid duplicates
const FORWARDED_LOG = __dirname + '/forwarded-emails.json';

function loadForwardedEmails() {
  try {
    if (fs.existsSync(FORWARDED_LOG)) {
      const data = fs.readFileSync(FORWARDED_LOG, 'utf8');
      return new Set(JSON.parse(data));
    }
  } catch (error) {
    console.log('⚠️  Could not load forwarded log, starting fresh');
  }
  return new Set();
}

function saveForwardedEmail(emailId) {
  try {
    const forwarded = loadForwardedEmails();
    forwarded.add(emailId);
    fs.writeFileSync(FORWARDED_LOG, JSON.stringify([...forwarded]), 'utf8');
  } catch (error) {
    console.error('⚠️  Could not save to forwarded log:', error.message);
  }
}

const forwardedEmails = loadForwardedEmails();
console.log(`📋 Loaded ${forwardedEmails.size} previously forwarded emails`);

const CONFIG = {
  recruiterEmails: (process.env.RECRUITER_EMAILS || "").split(",").filter(Boolean),
  contractorEmails: (process.env.CONTRACTOR_EMAILS || "").split(",").filter(Boolean),
  claudeApiKey: process.env.ANTHROPIC_API_KEY,
  maxEmailsToProcess: 30, // Changed from 20 to 30
  ignoreFromDomains: [
    'railway.app',
    'railway.com',
    'github.com',
    'noreply',
    'no-reply',
    'notifications@',
    'donotreply',
    'kaydevtech.com',
    'kaydevai.com'
  ]
};

console.log("=".repeat(60));
console.log("  STAFFING EMAIL AUTOMATION");
console.log("  " + new Date().toLocaleString());
console.log("=".repeat(60));
console.log("");

if (CONFIG.recruiterEmails.length === 0) {
  console.error("❌ No RECRUITER_EMAILS configured!");
  process.exit(1);
}

console.log("📋 Configuration:");
console.log(`   Email: ${process.env.YAHOO_EMAIL}`);
console.log(`   Recruiters: ${CONFIG.recruiterEmails.join(", ")}`);
if (CONFIG.contractorEmails.length > 0) {
  console.log(`   Contractors: ${CONFIG.contractorEmails.join(", ")}`);
}
console.log(`   Scanning last ${CONFIG.maxEmailsToProcess} emails`);
console.log("");

const transporter = nodemailer.createTransport({
  host: 'smtp.mail.yahoo.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.YAHOO_EMAIL,
    pass: process.env.YAHOO_APP_PASSWORD
  },
  tls: {
    rejectUnauthorized: false,
    minVersion: 'TLSv1.2'
  },
  connectionTimeout: 30000,
  greetingTimeout: 30000,
  socketTimeout: 30000,
  debug: true,
  logger: true
});

const anthropic = CONFIG.claudeApiKey ? new Anthropic({ apiKey: CONFIG.claudeApiKey }) : null;

function isSystemEmail(fromEmail, subject) {
  const fromLower = fromEmail.toLowerCase();
  const subjectLower = subject.toLowerCase();
  
  for (const domain of CONFIG.ignoreFromDomains) {
    if (fromLower.includes(domain.toLowerCase())) {
      return true;
    }
  }
  
  const systemPatterns = [
    /deploy.*crashed/i,
    /build.*failed/i,
    /notification/i,
    /unsubscribe/i,
    /do not reply/i,
    /automated message/i
  ];
  
  for (const pattern of systemPatterns) {
    if (pattern.test(subjectLower)) {
      return true;
    }
  }
  
  return false;
}

function extractMVPKeyFields(body) {
  const dueDateMatch = body.match(/DUE DATE:\s*([^\n]+)/i);
  const durationMatch = body.match(/Duration of engagement:\s*([^\n]+)/i);
  const locationMatch = body.match(/Location:\s*([^\n]+)/i);
  const startDateMatch = body.match(/Targeted start:\s*([^\n]+)/i);
  
  let keyFields = '';
  if (dueDateMatch || durationMatch || locationMatch || startDateMatch) {
    keyFields = '═══════════════════════════════════════\n';
    if (dueDateMatch) keyFields += `DUE DATE: ${dueDateMatch[1].trim()}\n`;
    if (durationMatch) keyFields += `Duration of engagement: ${durationMatch[1].trim()}\n`;
    if (locationMatch) keyFields += `Location: ${locationMatch[1].trim()}\n`;
    if (startDateMatch) keyFields += `Targeted start: ${startDateMatch[1].trim()}\n`;
    keyFields += '═══════════════════════════════════════\n\n';
  }
  
  return keyFields;
}

function extractMindlanceKeyFields(body) {
  const roleMatch = body.match(/Role:\s*([^\n]+)/i);
  const locationMatch = body.match(/Location:\s*([^\n]+)/i);
  const durationMatch = body.match(/Duration:\s*([^\n]+)/i);
  const jobIdMatch = body.match(/Job Id:\s*([^\n]+)/i);
  const categoryMatch = body.match(/Category:\s*([^\n]+)/i);
  const dueDateMatch = body.match(/Due Date:\s*([^\n]+)/i);
  
  let keyFields = '';
  if (roleMatch || locationMatch || durationMatch || jobIdMatch || categoryMatch || dueDateMatch) {
    keyFields = '═══════════════════════════════════════\n';
    if (roleMatch) keyFields += `Role: ${roleMatch[1].trim()}\n`;
    if (locationMatch) keyFields += `Location: ${locationMatch[1].trim()}\n`;
    if (durationMatch) keyFields += `Duration: ${durationMatch[1].trim()}\n`;
    if (jobIdMatch) keyFields += `Job Id: ${jobIdMatch[1].trim()}\n`;
    if (categoryMatch) keyFields += `Category: ${categoryMatch[1].trim()}\n`;
    if (dueDateMatch) keyFields += `Due Date: ${dueDateMatch[1].trim()}\n`;
    keyFields += '═══════════════════════════════════════\n\n';
  }
  
  return keyFields;
}

function cleanEmailBody(body, fromEmail) {
  let cleaned = body;
  
  if (fromEmail.toLowerCase().includes('michealbillings76@gmail') || fromEmail.toLowerCase().includes('nancyg@mvpconsultingplus')) {
    console.log("   🧹 Applying MVP Consulting cleaning rules...");
    
    cleaned = cleaned.replace(/MVP Consulting Plus, Inc\. has a job opening[^\n]*/gi, '');
    cleaned = cleaned.replace(/If you know of anyone.*$/si, '');
    cleaned = cleaned.replace(/Thank you,[\s\S]*?(?:Nancy Gordon|Ramesh)[\s\S]*?mvpconsultingplus\.com.*$/mi, '');
    cleaned = cleaned.replace(/\[image:.*?\]/gi, '');
    cleaned = cleaned.replace(/Nancy Gordon/gi, '');
    cleaned = cleaned.replace(/Ramesh.*?mvpconsultingplus\.com/gi, '');
    cleaned = cleaned.replace(/Contract Manager/gi, '');
    cleaned = cleaned.replace(/MVP Consulting Plus.*$/gmi, '');
    cleaned = cleaned.replace(/\(A Speridian Technologies LLC Company\)/gi, '');
    cleaned = cleaned.replace(/401 New Karner Road.*$/gmi, '');
    cleaned = cleaned.replace(/Albany NY \d{5}.*$/gmi, '');
    cleaned = cleaned.replace(/O: \d{3}-\d{3}-\d{4}/gi, '');
    cleaned = cleaned.replace(/rameshr@mvpconsultingplus\.com/gi, '');
    cleaned = cleaned.replace(/nancyg@mvpconsultingplus\.com/gi, '');
    cleaned = cleaned.replace(/www\.mvpconsultingplus\.com/gi, '');
  }
  
  if (fromEmail.toLowerCase().includes('mwilliy2k@gmail') || fromEmail.toLowerCase().includes('aakashp@mindlance')) {
    console.log("   🧹 Applying Mindlance cleaning rules...");
    
    cleaned = cleaned.replace(/Greetings,?[\s\S]*?Please advise if you require any information or any help from our end\.?/gi, '');
    cleaned = cleaned.replace(/Regards,?[\s\S]*?Aakash[\s\S]*?mindlance\.com.*$/mi, '');
    
    const keyFieldsEnd = cleaned.indexOf('═══════════════════════════════════════');
    if (keyFieldsEnd > -1) {
      const afterKeyFields = cleaned.substring(keyFieldsEnd + 50);
      const beforeKeyFields = cleaned.substring(0, keyFieldsEnd + 50);
      cleaned = beforeKeyFields + afterKeyFields.replace(/Due Date:\s*[^\n]+\n?/gi, '');
    }
    
    cleaned = cleaned.replace(/Team Recruitment/gi, '');
    cleaned = cleaned.replace(/mindlance open jobs/gi, '');
    cleaned = cleaned.replace(/Union, NJ/gi, '');
    cleaned = cleaned.replace(/Follow us on.*/gi, '');
    cleaned = cleaned.replace(/w: \d{3}-\d{3}-\d{4}/gi, '');
    cleaned = cleaned.replace(/aakashp@mindlance\.com/gi, '');
    cleaned = cleaned.replace(/www\.mindlance\.com/gi, '');
    cleaned = cleaned.replace(/<http:\/\/[^>]*>/gi, '');
    cleaned = cleaned.replace(/<https:\/\/[^>]*>/gi, '');
    cleaned = cleaned.replace(/<mailto:[^>]*>/gi, '');
    cleaned = cleaned.replace(/To provide feedback.*$/mi, '');
    cleaned = cleaned.replace(/To unsubscribe.*$/mi, '');
    cleaned = cleaned.replace(/feedback@mindlance\.com/gi, '');
    cleaned = cleaned.replace(/unsubscribe@mindlance\.com/gi, '');
  }
  
  cleaned = cleaned.replace(/^From:.*$/gm, '');
  cleaned = cleaned.replace(/^Sent:.*$/gm, '');
  cleaned = cleaned.replace(/^To:.*$/gm, '');
  cleaned = cleaned.replace(/^Subject:.*$/gm, '');
  cleaned = cleaned.replace(/^Cc:.*$/gm, '');
  cleaned = cleaned.replace(/^Date:.*$/gm, '');
  cleaned = cleaned.replace(/^--\s*$/gm, '\n');
  cleaned = cleaned.replace(/^___+\s*$/gm, '');
  cleaned = cleaned.replace(/^-+\s*Forwarded message\s*-+/gmi, '');
  cleaned = cleaned.replace(/^Begin forwarded message:/gmi, '');
  cleaned = cleaned.replace(/\n\n\n+/g, '\n\n');
  cleaned = cleaned.replace(/^\s*\n/gm, '\n');
  cleaned = cleaned.trim();
  
  const jobStartMarkers = [
    /DUE DATE:/i,
    /POSITION:/i,
    /JOB TITLE:/i,
    /LOCATION:/i,
    /Duration of engagement:/i,
    /Job Description:/i,
    /Position Description:/i,
    /Position Title:/i,
    /Need:/i,
    /Role:/i
  ];
  
  for (const marker of jobStartMarkers) {
    const match = cleaned.match(marker);
    if (match && match.index !== undefined) {
      cleaned = cleaned.substring(match.index);
      break;
    }
  }
  
  const footerMarkers = [
    /^This email and any files transmitted with it/mi,
    /^CONFIDENTIALITY NOTICE/mi,
    /^The information contained in this/mi,
    /^Please consider the environment/mi,
    /^IRS CIRCULAR 230 NOTICE/mi,
    /^Unsubscribe/mi,
    /^Click here to unsubscribe/mi
  ];
  
  for (const marker of footerMarkers) {
    const match = cleaned.match(marker);
    if (match && match.index !== undefined) {
      cleaned = cleaned.substring(0, match.index);
      break;
    }
  }
  
  cleaned = cleaned.replace(/\n\n\n+/g, '\n\n');
  cleaned = cleaned.trim();
  
  return cleaned;
}

async function parseJobPosting(emailBody, subject) {
  if (!anthropic) return null;
  
  const prompt = `Extract job posting details from this email and return ONLY valid JSON.

Subject: ${subject}

Body:
${emailBody.substring(0, 4000)}

Return JSON with this structure (fill in what you can find):
{
  "positionTitle": "string",
  "location": {"city": "string", "state": "string", "remote": boolean},
  "payRate": {"min": number, "max": number, "type": "hourly"|"annual"},
  "requiredSkills": ["skill1", "skill2"],
  "contractType": "W2"|"C2C"|"1099",
  "dueDate": "string",
  "duration": "string",
  "startDate": "string",
  "confidence": number (0.0-1.0)
}`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }]
    });
    
    const text = message.content[0].type === "text" ? message.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } catch (error) {
    console.error("   ⚠️  Parse error:", error.message);
    return null;
  }
}

const imap = new Imap({
  user: process.env.YAHOO_EMAIL,
  password: process.env.YAHOO_APP_PASSWORD,
  host: 'imap.mail.yahoo.com',
  port: 993,
  tls: true,
  tlsOptions: { rejectUnauthorized: false }
});

imap.once('ready', () => {
  console.log("✅ Connected to Yahoo IMAP\n");
  
  imap.openBox('INBOX', false, async (err, box) => {
    if (err) {
      console.error("❌ Failed to open INBOX:", err.message);
      process.exit(1);
    }
    
    console.log(`📬 INBOX has ${box.messages.total} total emails\n`);
    
    if (box.messages.total === 0) {
      console.log("✨ No emails in inbox");
      imap.end();
      return;
    }
    
    const startSeq = Math.max(1, box.messages.total - CONFIG.maxEmailsToProcess + 1);
    const endSeq = box.messages.total;
    
    console.log(`📧 Scanning last ${CONFIG.maxEmailsToProcess} emails (${startSeq}:${endSeq})\n`);
    
    const fetch = imap.seq.fetch(`${startSeq}:${endSeq}`, { bodies: '', struct: true });
    const emailsToProcess = [];
    
    fetch.on('message', (msg, seqno) => {
      let uid;
      let flags = [];
      
      msg.on('attributes', (attrs) => {
        uid = attrs.uid;
        flags = attrs.flags || [];
      });
      
      msg.on('body', (stream) => {
        simpleParser(stream, (err, parsed) => {
          if (err) return;
          
          emailsToProcess.push({
            uid,
            flags,
            subject: parsed.subject || '',
            from: parsed.from?.text || '',
            date: parsed.date,
            body: parsed.text || '',
            messageId: parsed.messageId || `${uid}-${parsed.date?.getTime()}`
          });
        });
      });
    });
    
    fetch.once('end', async () => {
      console.log(`Processing ${emailsToProcess.length} emails...\n`);
      
      let processedCount = 0;
      
      for (const email of emailsToProcess) {
        console.log(`\n${"─".repeat(60)}`);
        console.log(`📧 ${email.subject}`);
        console.log(`   From: ${email.from}`);
        console.log(`   Date: ${email.date?.toLocaleString()}`);
        
        // Check if already forwarded (REMOVED read/unread check)
        if (forwardedEmails.has(email.messageId)) {
          console.log("   ⏭️  Already forwarded previously");
          continue;
        }
        
        if (isSystemEmail(email.from, email.subject)) {
          console.log("   🤖 System notification, skipping");
          continue;
        }
        
        const isFromContractor = CONFIG.contractorEmails.some(c => 
          email.from.toLowerCase().includes(c.toLowerCase())
        );
        
        if (!isFromContractor) {
          console.log("   ⏭️  Not from contractor, skipping");
          continue;
        }
        
        console.log("   ✓ From contractor - processing");
        
        const cleanBody = cleanEmailBody(email.body, email.from);
        
        let jobData = null;
        if (anthropic) {
          console.log("   🤖 Parsing with Claude...");
          jobData = await parseJobPosting(cleanBody, email.subject);
          if (jobData) {
            console.log(`   ✓ Position: ${jobData.positionTitle}`);
            console.log(`   ✓ Confidence: ${(jobData.confidence * 100).toFixed(0)}%`);
          }
        }
        
        try {
          console.log(`   📤 Forwarding to ${CONFIG.recruiterEmails.length} recruiter(s)...`);
          
          let emailBody = `🚨 KayDev New Job Posting\n\n`;
          
          const isMindlance = email.from.toLowerCase().includes('mwilliy2k@gmail') || email.from.toLowerCase().includes('aakashp@mindlance');
          const isMVP = email.from.toLowerCase().includes('michealbillings76@gmail') || email.from.toLowerCase().includes('nancyg@mvpconsultingplus');
          
          if (isMindlance) {
            const keyFields = extractMindlanceKeyFields(email.body);
            if (keyFields) {
              emailBody += keyFields;
            }
          }
          
          if (isMVP) {
            const keyFields = extractMVPKeyFields(email.body);
            if (keyFields) {
              emailBody += keyFields;
            }
          }
          
          emailBody += cleanBody;
          
          await transporter.sendMail({
            from: process.env.YAHOO_EMAIL,
            to: CONFIG.recruiterEmails.join(", "),
            subject: `KayDev - ${email.subject.replace("Fwd:", "").replace("Need:", "").trim()}`,
            text: emailBody
          });
          
          console.log("   ✅ Forwarded successfully!");
          processedCount++;
          
          // Save to forwarded log
          saveForwardedEmail(email.messageId);
          console.log("   ✓ Logged as forwarded");
          
        } catch (error) {
          console.log(`   ❌ Forward failed: ${error.message}`);
        }
      }
      
      console.log(`\n${"=".repeat(60)}`);
      console.log(`✅ Processed ${processedCount} contractor email(s)`);
      console.log("=".repeat(60));
      
      imap.end();
    });
  });
});

imap.once('error', (err) => {
  console.error("❌ IMAP Error:", err.message);
  process.exit(1);
});

imap.once('end', () => {
  console.log("\n👋 Connection closed");
  process.exit(0);
});

console.log("🔌 Connecting to Yahoo IMAP...");
imap.connect();

// Run every 5 minutes
setInterval(() => {
  console.log("\n" + "=".repeat(60));
  console.log("  🔄 SCHEDULED CHECK - " + new Date().toLocaleString());
  console.log("=".repeat(60));
  console.log("🔌 Connecting to Yahoo IMAP...");
  imap.connect();
}, 5 * 60 * 1000);
