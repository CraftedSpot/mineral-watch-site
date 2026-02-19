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
 * - AIRTABLE_DEMO_TABLE_ID: Demo Bookings table ID (tblDqFremDUvpOW7l)
 */

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCORS();
    }

    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/book-demo') {
      return handleDemoBooking(request, env);
    }

    // Only accept POST to /contact
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

      // Send confirmation email to the person who submitted
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Mineral Watch <support@mymineralwatch.com>',
          to: email,
          subject: 'We received your message - Mineral Watch',
          html: formatContactConfirmationEmail(name, topic)
        })
      });

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

function formatContactConfirmationEmail(name, topic) {
  const escapeHtml = (str) => (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1C2B36; margin: 0; padding: 0; background: #F8F9FA; }
    .wrapper { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
    .card { background: white; border-radius: 8px; overflow: hidden; border: 1px solid #E2E8F0; }
    .brand { background: #1C2B36; color: white; padding: 24px; text-align: center; }
    .brand h1 { margin: 0; font-size: 22px; letter-spacing: -0.5px; }
    .body { padding: 30px; }
    .body h2 { font-size: 20px; margin: 0 0 8px; color: #1C2B36; }
    .body p { color: #334E68; margin: 0 0 16px; font-size: 15px; }
    .detail-box { background: #F8F9FA; border: 1px solid #E2E8F0; border-radius: 6px; padding: 16px; margin-bottom: 20px; }
    .detail-row { font-size: 14px; color: #334E68; }
    .detail-label { font-weight: 600; color: #1C2B36; }
    .footer { padding: 20px 30px; border-top: 1px solid #E2E8F0; font-size: 12px; color: #718096; text-align: center; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="brand">
        <h1>Mineral Watch</h1>
      </div>
      <div class="body">
        <h2>We received your message</h2>
        <p>Hi ${escapeHtml(name)}, thanks for reaching out. We typically respond within one business day.</p>

        <div class="detail-box">
          <div class="detail-row">
            <span class="detail-label">Topic:</span> ${escapeHtml(topic)}
          </div>
        </div>

        <p>In the meantime, you might find these helpful:</p>
        <p style="margin-bottom: 8px;">
          <a href="https://mymineralwatch.com/features" style="color: #C05621; text-decoration: none; font-weight: 500;">Platform features</a> &mdash; See what Mineral Watch monitors
        </p>
        <p style="margin-bottom: 8px;">
          <a href="https://mymineralwatch.com/pricing" style="color: #C05621; text-decoration: none; font-weight: 500;">Plans &amp; pricing</a> &mdash; Find the right plan for your portfolio
        </p>
        <p style="margin-bottom: 8px;">
          <a href="https://mymineralwatch.com/demo" style="color: #C05621; text-decoration: none; font-weight: 500;">Book a demo</a> &mdash; Schedule a personalized walkthrough
        </p>
      </div>
      <div class="footer">
        Mineral Watch &middot; Oklahoma City, OK<br>
        <a href="mailto:support@mymineralwatch.com" style="color: #C05621;">support@mymineralwatch.com</a>
      </div>
    </div>
  </div>
</body>
</html>`.trim();
}

// ─── Demo Booking Handler ───

async function handleDemoBooking(request, env) {
  try {
    const data = await request.json();

    // Honeypot — silently accept but don't process
    if (data.website) {
      console.log('Honeypot triggered, ignoring submission');
      return jsonResponse({ success: true });
    }

    const { name, company, email, propertyCount, meetingType, preferredDate, preferredTime } = data;
    if (!name || !company || !email || !propertyCount || !meetingType || !preferredDate || !preferredTime) {
      return jsonResponse({ error: 'Missing required fields' }, 400);
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return jsonResponse({ error: 'Invalid email address' }, 400);
    }

    if (meetingType === 'Phone Call' && !data.phone) {
      return jsonResponse({ error: 'Phone number is required for phone call meetings' }, 400);
    }
    if (meetingType === 'In-Person' && !data.city) {
      return jsonResponse({ error: 'City is required for in-person meetings' }, 400);
    }

    console.log('Processing demo booking from:', email);

    // Save to Airtable
    const airtableFields = {
      Name: name,
      Company: company,
      Email: email,
      'Property Count': propertyCount,
      'Meeting Type': meetingType,
      'Preferred Date': preferredDate,
      'Preferred Time': preferredTime,
      'Submitted At': new Date().toISOString(),
      Status: 'New'
    };
    if (data.phone) airtableFields.Phone = data.phone;
    if (data.city) airtableFields.City = data.city;

    const demoTableId = env.AIRTABLE_DEMO_TABLE_ID || 'tblDqFremDUvpOW7l';

    const airtableResponse = await fetch(
      `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${demoTableId}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields: airtableFields })
      }
    );

    if (!airtableResponse.ok) {
      const airtableError = await airtableResponse.json();
      console.error('Airtable error:', JSON.stringify(airtableError));
    }

    // Format date for display
    const dateParts = preferredDate.split('-');
    const dateObj = new Date(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]));
    const displayDate = dateObj.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    // Send notification email to James
    const notifyResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: `Mineral Watch <${env.FROM_EMAIL}>`,
        to: env.NOTIFY_EMAIL,
        reply_to: email,
        subject: `[Demo Request] ${company} - ${name} (${propertyCount} properties)`,
        html: formatDemoNotificationEmail({ name, company, email, propertyCount, meetingType, phone: data.phone, city: data.city, displayDate, preferredTime })
      })
    });

    if (!notifyResponse.ok) {
      const errorData = await notifyResponse.json();
      console.error('Resend notify error:', JSON.stringify(errorData));
      return jsonResponse({ error: 'Failed to process request' }, 500);
    }

    // Send confirmation email to prospect
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Mineral Watch <support@mymineralwatch.com>',
        to: email,
        subject: 'Your Mineral Watch Demo Request',
        html: formatDemoConfirmationEmail({ name, meetingType, displayDate, preferredTime, email })
      })
    });

    return jsonResponse({ success: true });

  } catch (error) {
    console.error('Demo booking error:', error.message);
    console.error('Stack:', error.stack);
    return jsonResponse({ error: 'Internal server error', details: error.message }, 500);
  }
}

function formatDemoNotificationEmail({ name, company, email, propertyCount, meetingType, phone, city, displayDate, preferredTime }) {
  const escapeHtml = (str) => (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  let extraFields = '';
  if (phone) {
    extraFields += `
      <div class="field">
        <div class="label">Phone</div>
        <div class="value">${escapeHtml(phone)}</div>
      </div>`;
  }
  if (city) {
    extraFields += `
      <div class="field">
        <div class="label">City</div>
        <div class="value">${escapeHtml(city)}</div>
      </div>`;
  }

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
    .highlight-box { background: white; padding: 16px; border: 2px solid #C05621; border-radius: 6px; margin-bottom: 20px; }
    .highlight-box .value { font-size: 18px; font-weight: 700; color: #C05621; }
    .topic-badge { display: inline-block; background: #C05621; color: white; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 600; }
    .footer { margin-top: 20px; font-size: 12px; color: #718096; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>New Demo Request</h1>
    </div>
    <div class="content">
      <div class="highlight-box">
        <div class="label">Requested Date &amp; Time</div>
        <div class="value">${escapeHtml(displayDate)} at ${escapeHtml(preferredTime)} CT</div>
      </div>
      <div class="field">
        <div class="label">From</div>
        <div class="value"><strong>${escapeHtml(name)}</strong> &lt;${escapeHtml(email)}&gt;</div>
      </div>
      <div class="field">
        <div class="label">Company</div>
        <div class="value">${escapeHtml(company)}</div>
      </div>
      <div class="field">
        <div class="label">Property Count</div>
        <div class="value">${escapeHtml(propertyCount)}</div>
      </div>
      <div class="field">
        <div class="label">Meeting Type</div>
        <div class="value"><span class="topic-badge">${escapeHtml(meetingType)}</span></div>
      </div>
      ${extraFields}
      <div class="footer">
        Reply directly to this email to respond to ${escapeHtml(name)}.
      </div>
    </div>
  </div>
</body>
</html>`.trim();
}

function formatDemoConfirmationEmail({ name, meetingType, displayDate, preferredTime, email }) {
  const escapeHtml = (str) => (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1C2B36; margin: 0; padding: 0; background: #F8F9FA; }
    .wrapper { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
    .card { background: white; border-radius: 8px; overflow: hidden; border: 1px solid #E2E8F0; }
    .brand { background: #1C2B36; color: white; padding: 24px; text-align: center; }
    .brand h1 { margin: 0; font-size: 22px; letter-spacing: -0.5px; }
    .body { padding: 30px; }
    .body h2 { font-size: 20px; margin: 0 0 8px; color: #1C2B36; }
    .body p { color: #334E68; margin: 0 0 20px; font-size: 15px; }
    .detail-box { background: #F8F9FA; border: 1px solid #E2E8F0; border-radius: 6px; padding: 16px; margin-bottom: 24px; }
    .detail-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }
    .detail-label { color: #334E68; font-weight: 600; }
    .detail-value { color: #1C2B36; }
    .section-title { font-size: 14px; font-weight: 700; color: #1C2B36; margin: 24px 0 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    .expect-list { margin: 0; padding: 0 0 0 20px; color: #334E68; font-size: 14px; }
    .expect-list li { margin-bottom: 8px; }
    .footer { padding: 20px 30px; border-top: 1px solid #E2E8F0; font-size: 12px; color: #718096; text-align: center; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="brand">
        <h1>Mineral Watch</h1>
      </div>
      <div class="body">
        <h2>Demo Request Received</h2>
        <p>Hi ${escapeHtml(name)}, thanks for your interest in Mineral Watch. We'll confirm your ${escapeHtml(meetingType.toLowerCase())} within 24 hours.</p>

        <div class="detail-box">
          <div class="detail-row">
            <span class="detail-label">Date</span>
            <span class="detail-value">${escapeHtml(displayDate)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Time</span>
            <span class="detail-value">${escapeHtml(preferredTime)} CT</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Type</span>
            <span class="detail-value">${escapeHtml(meetingType)}</span>
          </div>
        </div>

        <div class="section-title">What to expect</div>
        <ul class="expect-list">
          <li>Full platform walkthrough tailored to your portfolio</li>
          <li>Bulk import setup for your properties and wells</li>
          <li>Team onboarding and account configuration</li>
        </ul>
      </div>
      <div class="footer">
        Mineral Watch &middot; Oklahoma City, OK<br>
        Questions? Reply to this email or contact <a href="mailto:support@mymineralwatch.com" style="color: #C05621;">support@mymineralwatch.com</a>
      </div>
    </div>
  </div>
</body>
</html>`.trim();
}
