/**
 * Mineral Watch Contact Form Handler
 * Cloudflare Worker that receives form submissions and sends via Resend
 *
 * Environment Variables Required:
 * - RESEND_API_KEY: Your Resend API key
 * - NOTIFY_EMAIL: Email address to receive contact form submissions (e.g., support@mymineralwatch.com)
 * - FROM_EMAIL: Verified sender email in Resend (e.g., noreply@mymineralwatch.com)
 * - MINERAL_AIRTABLE_API_KEY: Your Airtable API key
 * - AIRTABLE_BASE_ID: Your Airtable base ID (app3j3X29Uvp5stza)
 * - AIRTABLE_TABLE_ID: Contact form table ID (tblTJtePevMqzntKL)
 */

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCORS();
    }

    // Only accept POST to /contact
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/contact') {
      return new Response('Not Found', { status: 404 });
    }

    try {
      const data = await request.json();
      
      // Validate required fields
      const { name, email, topic, message } = data;
      if (!name || !email || !topic || !message) {
        return jsonResponse({ error: 'Missing required fields' }, 400);
      }

      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return jsonResponse({ error: 'Invalid email address' }, 400);
      }

      console.log('Processing contact form submission from:', email);
      
      // Save to Airtable
      const airtableData = {
        fields: {
          Name: name,
          Email: email,
          Topic: topic,
          Message: message,
          'Submitted At': new Date().toISOString(),
          Status: 'New'
        }
      };

      const airtableResponse = await fetch(
        `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_ID}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(airtableData)
        }
      );

      if (!airtableResponse.ok) {
        const airtableError = await airtableResponse.json();
        console.error('Airtable error:', JSON.stringify(airtableError));
        console.error('Airtable request data:', JSON.stringify(airtableData));
        // Continue with email even if Airtable fails
      }

      console.log('Airtable submission completed, sending email...');
      
      // Send email via Resend
      const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: `Mineral Watch <${env.FROM_EMAIL}>`,
          to: env.NOTIFY_EMAIL,
          reply_to: email,
          subject: `[Mineral Watch Contact] ${topic} - ${name}`,
          text: formatTextEmail(name, email, topic, message),
          html: formatHtmlEmail(name, email, topic, message)
        })
      });

      if (!resendResponse.ok) {
        const errorData = await resendResponse.json();
        console.error('Resend error:', JSON.stringify(errorData));
        console.error('Resend status:', resendResponse.status);
        return jsonResponse({ error: 'Failed to send message', resendError: errorData }, 500);
      }

      return jsonResponse({ success: true, message: 'Message sent successfully' }, 200);

    } catch (error) {
      console.error('Contact form error:', error.message);
      console.error('Stack:', error.stack);
      return jsonResponse({ error: 'Internal server error', details: error.message }, 500);
    }
  }
};

function handleCORS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function formatTextEmail(name, email, topic, message) {
  return `
New Contact Form Submission
============================

Name: ${name}
Email: ${email}
Topic: ${topic}

Message:
${message}

---
Sent from Mineral Watch contact form
`.trim();
}

function formatHtmlEmail(name, email, topic, message) {
  // Escape HTML to prevent XSS in email
  const escapeHtml = (str) => str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1C2B36; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #1C2B36; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .header h1 { margin: 0; font-size: 20px; }
    .content { background: #F8F9FA; padding: 25px; border: 1px solid #E2E8F0; border-top: none; border-radius: 0 0 8px 8px; }
    .field { margin-bottom: 15px; }
    .label { font-size: 12px; font-weight: 600; color: #334E68; text-transform: uppercase; letter-spacing: 0.5px; }
    .value { font-size: 15px; margin-top: 4px; }
    .message-box { background: white; padding: 15px; border: 1px solid #E2E8F0; border-radius: 6px; margin-top: 20px; }
    .footer { margin-top: 20px; font-size: 12px; color: #718096; }
    .topic-badge { display: inline-block; background: #C05621; color: white; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>New Contact Form Submission</h1>
    </div>
    <div class="content">
      <div class="field">
        <div class="label">From</div>
        <div class="value"><strong>${escapeHtml(name)}</strong> &lt;${escapeHtml(email)}&gt;</div>
      </div>
      <div class="field">
        <div class="label">Topic</div>
        <div class="value"><span class="topic-badge">${escapeHtml(topic)}</span></div>
      </div>
      <div class="message-box">
        <div class="label">Message</div>
        <div class="value" style="margin-top: 10px;">${escapeHtml(message)}</div>
      </div>
      <div class="footer">
        Reply directly to this email to respond to ${escapeHtml(name)}.
      </div>
    </div>
  </div>
</body>
</html>
`.trim();
}
