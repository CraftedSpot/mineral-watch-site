#!/usr/bin/env node

/**
 * Waitlist Launch Email Sender
 * Sends personalized launch emails to waitlist subscribers via Postmark
 */

const POSTMARK_API_KEY = process.env.POSTMARK_API_KEY;
const FROM_EMAIL = "james@mymineralwatch.com";

// Waitlist data from Airtable
const waitlistUsers = [
  { name: "Steve", email: "steve.foerster@griffin.news" },
  { name: "Stan", email: "condor71@suddenlinkmail.com" },
  { name: "Daryl", email: "baronofly@hotmail.com" },
  { name: "Mary Suzanne", email: "SuzanneParksHauser@gmail.com" },
  { name: "Kara", email: "kara.conn8945@gmail.com" },
  { name: "Katrina", email: "kattexas68@gmail.com" }
];

const emailTemplate = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Welcome to Mineral Watch – 1 year on us</title>
  </head>
  <body style="margin:0; padding:0; background-color:#f5f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px; background-color:#ffffff; border-radius:8px; overflow:hidden;">
            <!-- Header -->
            <tr>
              <td style="padding:24px; text-align:left;">
                <h1 style="margin:0; font-size:24px; color:#111827;">
                  Welcome to Mineral Watch – 1 year on us
                </h1>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="padding:0 24px 24px 24px; font-size:15px; line-height:1.6; color:#374151;">
                <p style="margin:0 0 12px 0;">Hi {{FIRST_NAME}},</p>

                <p style="margin:0 0 12px 0;">
                  Thanks again for being one of the first Mineral Watch users. As promised, here's your
                  <strong>free 1‑year Starter plan</strong> (tracks up to
                  <strong>25 properties</strong> and <strong>25 well API numbers</strong>).
                </p>

                <p style="margin:16px 0 8px 0; font-weight:600; color:#111827;">
                  What Mineral Watch will track for you:
                </p>
                <ul style="margin:0 0 12px 20px; padding:0;">
                  <li style="margin-bottom:6px;">
                    New drill permits filed on or near your property, so you get early warning before activity starts.
                  </li>
                  <li style="margin-bottom:6px;">
                    Well status changes like Active (AC) to Plugged &amp; Abandoned (PA) or Temporarily Abandoned.
                  </li>
                  <li style="margin-bottom:6px;">
                    Well completions, when a well is finished and oil or gas starts flowing.
                  </li>
                  <li style="margin-bottom:6px;">
                    Operator transfers, so you know when to update your division order and payment info.
                  </li>
                </ul>

                <p style="margin:16px 0 8px 0; font-weight:600; color:#111827;">
                  How to claim your free year:
                </p>
                <ol style="margin:0 0 16px 20px; padding:0;">
                  <li style="margin-bottom:6px;">
                    Go to <a href="https://mymineralwatch.com" style="color:#2563eb; text-decoration:none;">mymineralwatch.com</a>.
                  </li>
                  <li style="margin-bottom:6px;">
                    Choose the <strong>Starter Annual</strong> plan.
                  </li>
                  <li style="margin-bottom:6px;">
                    At checkout, enter promo code <strong>FOUNDER</strong> to get 100% off your first year.
                  </li>
                </ol>

                <!-- Button -->
                <table cellpadding="0" cellspacing="0" style="margin:16px 0 20px 0;">
                  <tr>
                    <td align="center" bgcolor="#f97316" style="border-radius:999px;">
                      <a href="https://mymineralwatch.com/pricing"
                         style="display:inline-block; padding:10px 24px; font-size:15px; font-weight:600; color:#ffffff; text-decoration:none;">
                        Claim Your Free Year
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 12px 0;">
                  After 12 months you can keep the Starter plan, upgrade, downgrade, or cancel any time before renewal.
                </p>

                <p style="margin:0 0 12px 0;">
                  If anything in signup feels rough or confusing, just hit reply and let me know. Your feedback right now is incredibly valuable.
                </p>

                <p style="margin:16px 0 0 0;">
                  Thanks again,<br />
                  James<br />
                  Founder, Mineral Watch<br />
                  <a href="mailto:james@mymineralwatch.com" style="color:#2563eb; text-decoration:none;">james@mymineralwatch.com</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

async function sendEmail(user) {
  const personalizedEmail = emailTemplate.replace('{{FIRST_NAME}}', user.name);
  
  console.log(`Sending to: ${user.name} (${user.email})`);
  
  try {
    const response = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": POSTMARK_API_KEY
      },
      body: JSON.stringify({
        From: FROM_EMAIL,
        To: user.email,
        Subject: "Mineral Watch is live – Your free year is ready! 🎉",
        HtmlBody: personalizedEmail,
        MessageStream: "outbound"
      })
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`✅ Sent to ${user.name}: Message ID ${result.MessageID}`);
      return { success: true, user: user.name, messageId: result.MessageID };
    } else {
      const error = await response.text();
      console.error(`❌ Failed to send to ${user.name}: ${error}`);
      return { success: false, user: user.name, error };
    }
  } catch (err) {
    console.error(`❌ Error sending to ${user.name}: ${err.message}`);
    return { success: false, user: user.name, error: err.message };
  }
}

async function sendAllEmails() {
  if (!POSTMARK_API_KEY) {
    console.error("❌ POSTMARK_API_KEY environment variable not set");
    process.exit(1);
  }

  console.log(`🚀 Sending launch emails to ${waitlistUsers.length} subscribers...\n`);

  const results = [];
  
  for (const user of waitlistUsers) {
    const result = await sendEmail(user);
    results.push(result);
    
    // Add delay between emails to be respectful to Postmark
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Summary
  console.log("\n📊 SEND SUMMARY:");
  console.log(`✅ Successful: ${results.filter(r => r.success).length}`);
  console.log(`❌ Failed: ${results.filter(r => !r.success).length}`);
  
  if (results.some(r => !r.success)) {
    console.log("\nFailed sends:");
    results.filter(r => !r.success).forEach(r => {
      console.log(`  - ${r.user}: ${r.error}`);
    });
  }

  console.log("\n🎉 Launch email campaign complete!");
}

// Run the script
sendAllEmails().catch(err => {
  console.error("💥 Script failed:", err);
  process.exit(1);
});