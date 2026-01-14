/**
 * Postmark Email Service
 * 
 * Handles all email sending functionality for the Portal Worker
 * Includes magic link emails, welcome emails, and template generation
 */

import type { Env } from '../types/env.js';

/**
 * Send a magic link email for user login
 * @param env Worker environment
 * @param email User's email address
 * @param name User's display name
 * @param magicLink The magic login link
 * @returns Promise that resolves when email is sent
 */
export async function sendMagicLinkEmail(env: Env, email: string, name: string, magicLink: string): Promise<void> {
  const response = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": env.POSTMARK_API_KEY
    },
    body: JSON.stringify({
      From: "support@mymineralwatch.com",
      To: email,
      Subject: "Your Mineral Watch Login Link",
      HtmlBody: `
        <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
          <h2 style="color: #1C2B36;">Log in to Mineral Watch</h2>
          <p style="color: #334E68;">Hi ${name},</p>
          <p style="color: #334E68;">Click below to log in. This link expires in 15 minutes.</p>
          <div style="margin: 30px 0;">
            <a href="${magicLink}" style="background-color: #C05621; color: white; padding: 14px 28px; text-decoration: none; border-radius: 4px; font-weight: 600;">Log In to Mineral Watch</a>
          </div>
          <p style="color: #718096; font-size: 14px;">If you didn't request this, you can ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;">
          <p style="color: #A0AEC0; font-size: 12px;">Mineral Watch - Oklahoma Mineral Rights Monitoring</p>
        </div>
      `,
      TextBody: `Hi ${name},

Click this link to log in to Mineral Watch: ${magicLink}

This link expires in 15 minutes.

If you didn't request this, you can ignore this email.

— Mineral Watch - Oklahoma Mineral Rights Monitoring`
    })
  });

  if (!response.ok) {
    const emailError = await response.text();
    throw new Error(`Postmark email error: ${emailError}`);
  }
}

/**
 * Send a welcome email to new users using Postmark
 * @param env Worker environment
 * @param email User's email address
 * @param name User's display name
 * @param magicLink The verification/login link
 * @returns Promise that resolves when email is sent
 */
export async function sendWelcomeEmail(env: Env, email: string, name: string, magicLink: string): Promise<void> {
  const htmlBody = getFreeWelcomeEmailHtml(name, magicLink);
  const textBody = getFreeWelcomeEmailText(name, magicLink);

  const response = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": env.POSTMARK_API_KEY
    },
    body: JSON.stringify({
      From: "support@mymineralwatch.com",
      To: email,
      Subject: "Welcome to Mineral Watch - Verify Your Account",
      HtmlBody: htmlBody,
      TextBody: textBody
    })
  });

  if (!response.ok) {
    const emailError = await response.text();
    throw new Error(`Postmark email error: ${emailError}`);
  }
}

/**
 * Generate HTML email template for free welcome email
 * @param name User's display name
 * @param magicLink The verification/login link
 * @returns HTML email content
 */
export function getFreeWelcomeEmailHtml(name: string, magicLink: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f7fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden;">
      
      <!-- Header -->
      <div style="background: #1C2B36; padding: 30px; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 700;">Mineral Watch</h1>
      </div>
      
      <!-- Content -->
      <div style="padding: 40px 30px;">
        <p style="font-size: 18px; color: #1C2B36; margin: 0 0 20px;">Hi ${name},</p>
        
        <p style="font-size: 16px; color: #334E68; line-height: 1.6; margin: 0 0 25px;">
          Welcome to Mineral Watch! Your free account is ready.
        </p>
        
        <!-- CTA Button -->
        <div style="text-align: center; margin: 30px 0;">
          <a href="${magicLink}" style="display: inline-block; background: #C05621; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">Verify & Log In →</a>
        </div>
        
        <p style="text-align: center; font-size: 13px; color: #718096; margin: 0 0 30px;">
          This link expires in 15 minutes.
        </p>
        
        <div style="background: #FEF3CD; border: 1px solid #F59E0B; border-radius: 6px; padding: 16px; margin: 0 0 30px;">
          <p style="font-size: 14px; color: #92400E; margin: 0; text-align: center;">
            <strong>📧 Email delivery note:</strong> Your first few emails may take 5-10 minutes as email providers verify our sender reputation. After that, emails arrive instantly. Also check Promotions, Updates, or Spam folders if you don't see future alerts in your inbox.
          </p>
        </div>
        
        <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;">
        
        <!-- What You're Getting -->
        <h2 style="color: #1C2B36; font-size: 18px; margin: 0 0 16px;">What You're Getting</h2>
        
        <p style="font-size: 15px; color: #334E68; line-height: 1.6; margin: 0 0 20px;">
          Mineral Watch monitors Oklahoma Corporation Commission filings and alerts you when something happens on your minerals. Here's what makes us different:
        </p>
        
        <!-- Feature: Watch the neighbors -->
        <div style="margin-bottom: 20px;">
          <h3 style="color: #1C2B36; font-size: 15px; margin: 0 0 6px;">We watch the neighbors</h3>
          <p style="font-size: 14px; color: #334E68; line-height: 1.5; margin: 0;">
            Enter your property once and we automatically monitor your section PLUS the 8 surrounding sections. This catches horizontal wells headed your way—not just activity in your exact section.
          </p>
        </div>
        
        <!-- Feature: Check daily -->
        <div style="margin-bottom: 20px;">
          <h3 style="color: #1C2B36; font-size: 15px; margin: 0 0 6px;">We check daily</h3>
          <p style="font-size: 14px; color: #334E68; line-height: 1.5; margin: 0;">
            Every day we scan for new drilling permits, rigs on location, and well completions.
          </p>
        </div>
        
        <!-- Feature: Status changes -->
        <div style="margin-bottom: 20px;">
          <h3 style="color: #1C2B36; font-size: 15px; margin: 0 0 6px;">We track status changes</h3>
          <p style="font-size: 14px; color: #334E68; line-height: 1.5; margin: 0;">
            Every week we check for changes like "Shut-In," "Plugged," or change of operator.
          </p>
        </div>
        
        <!-- Feature: Translate -->
        <div style="margin-bottom: 20px;">
          <h3 style="color: #1C2B36; font-size: 15px; margin: 0 0 6px;">We translate it</h3>
          <p style="font-size: 14px; color: #334E68; line-height: 1.5; margin: 0;">
            No confusing OCC codes. You get plain English alerts like "New Drilling Permit" or "Rig on Location."
          </p>
        </div>
        
        <!-- Feature: Every operator -->
        <div style="margin-bottom: 20px;">
          <h3 style="color: #1C2B36; font-size: 15px; margin: 0 0 6px;">We track every operator</h3>
          <p style="font-size: 14px; color: #334E68; line-height: 1.5; margin: 0;">
            We scan the official state database, so we catch activity from everyone—including small operators who don't show up in paid services.
          </p>
        </div>
        
        <!-- Feature: Set and forget -->
        <div style="margin-bottom: 20px;">
          <h3 style="color: #1C2B36; font-size: 15px; margin: 0 0 6px;">Set it and forget it</h3>
          <p style="font-size: 14px; color: #334E68; line-height: 1.5; margin: 0;">
            You enter your legal description once. We handle the rest and only email you when something changes.
          </p>
        </div>
        
        <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;">
        
        <!-- Your Free Plan -->
        <div style="background: #F7FAFC; border-radius: 6px; padding: 20px; margin: 0 0 25px;">
          <h3 style="margin: 0 0 12px; color: #1C2B36; font-size: 16px;">Your Free Plan</h3>
          <ul style="margin: 0; padding: 0 0 0 20px; color: #334E68; line-height: 1.8; font-size: 14px;">
            <li>1 monitored property</li>
            <li>Adjacent section monitoring included</li>
            <li>Daily permit scans + weekly status checks</li>
            <li>Plain English email alerts</li>
          </ul>
          <p style="font-size: 14px; color: #718096; margin: 16px 0 0;">
            Want to monitor more properties or track specific wells by API number? Upgrade anytime from your dashboard.
          </p>
        </div>
        
        <!-- What We Don't Do -->
        <h3 style="color: #1C2B36; font-size: 16px; margin: 0 0 10px;">What We Don't Do</h3>
        <p style="font-size: 14px; color: #334E68; line-height: 1.5; margin: 0 0 25px;">
          We're focused on drilling activity and well status—not revenue. We don't track pooling applications or royalty payments.
        </p>
        
        <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;">
        
        <!-- Getting Started -->
        <h3 style="color: #1C2B36; font-size: 16px; margin: 0 0 12px;">Getting Started</h3>
        <p style="font-size: 14px; color: #334E68; line-height: 1.6; margin: 0 0 12px;">
          After you log in, add your first property. You'll need:
        </p>
        <ul style="margin: 0 0 20px; padding: 0 0 0 20px; color: #334E68; line-height: 1.8; font-size: 14px;">
          <li>County</li>
          <li>Section (1-36)</li>
          <li>Township (e.g., 12N)</li>
          <li>Range (e.g., 4W)</li>
        </ul>
        <p style="font-size: 14px; color: #334E68; line-height: 1.5; margin: 0;">
          Paid plans also let you monitor individual wells by API number—with a direct link to the well location on the OCC map.
        </p>
        
        <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;">
        
        <p style="font-size: 14px; color: #718096; margin: 0;">
          <strong>Questions?</strong> Just reply to this email.
        </p>
        
        <p style="font-size: 16px; color: #334E68; margin: 30px 0 0;">
          — Mineral Watch
        </p>
      </div>
      
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Send an organization invite email
 * @param env Worker environment
 * @param email User's email address
 * @param inviterName Name of the person sending the invite
 * @param organizationName Name of the organization
 * @param role The role being assigned
 * @param magicLink The verification/login link
 * @returns Promise that resolves when email is sent
 */
export async function sendInviteEmail(
  env: Env, 
  email: string, 
  inviterName: string, 
  organizationName: string,
  role: string,
  magicLink: string
): Promise<void> {
  console.log(`📮 Postmark: Preparing invite email for ${email}`);
  console.log(`📮 Postmark API Key length: ${env.POSTMARK_API_KEY ? env.POSTMARK_API_KEY.length : 'undefined'}`);
  
  const emailPayload = {
    From: "support@mymineralwatch.com",
    To: email,
    Subject: `${inviterName} invited you to join ${organizationName} on Mineral Watch`,
    HtmlBody: getInviteEmailHtml(email, inviterName, organizationName, role, magicLink),
    TextBody: getInviteEmailText(email, inviterName, organizationName, role, magicLink)
  };
  
  console.log(`📮 Postmark: Sending with subject: ${emailPayload.Subject}`);
  
  const response = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": env.POSTMARK_API_KEY
    },
    body: JSON.stringify(emailPayload)
  });

  console.log(`📮 Postmark response status: ${response.status} ${response.statusText}`);
  
  if (!response.ok) {
    const emailError = await response.text();
    console.error(`📮 Postmark error response: ${emailError}`);
    throw new Error(`Postmark email error: ${emailError}`);
  }
  
  console.log(`📮 Postmark: Invite email sent successfully to ${email}`);
}

/**
 * Generate HTML email template for organization invites
 */
export function getInviteEmailHtml(
  email: string,
  inviterName: string,
  organizationName: string,
  role: string,
  magicLink: string
): string {
  const name = email.split('@')[0];
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f7fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden;">
      
      <!-- Header -->
      <div style="background: #1C2B36; padding: 30px; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 700;">Mineral Watch</h1>
      </div>
      
      <!-- Content -->
      <div style="padding: 40px 30px;">
        <p style="font-size: 18px; color: #1C2B36; margin: 0 0 20px;">Hi ${name},</p>
        
        <p style="font-size: 16px; color: #334E68; line-height: 1.6; margin: 0 0 25px;">
          <strong>${inviterName}</strong> has invited you to join <strong>${organizationName}</strong> on Mineral Watch as ${role === 'Admin' ? 'an' : 'a'} <strong>${role}</strong>.
        </p>

        <p style="font-size: 16px; color: #334E68; line-height: 1.6; margin: 0 0 25px;">
          ${organizationName} uses Mineral Watch to monitor drilling activity on their mineral rights in Oklahoma.
        </p>
        
        <!-- CTA Button -->
        <div style="text-align: center; margin: 30px 0;">
          <a href="${magicLink}" style="display: inline-block; background: #C05621; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">Accept Invitation →</a>
        </div>

        <p style="text-align: center; font-size: 13px; color: #718096; margin: 0 0 30px;">
          This link expires in 72 hours.
        </p>
        
        <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;">
        
        <!-- What happens next -->
        <h3 style="color: #1C2B36; font-size: 16px; margin: 0 0 12px;">What happens when you accept:</h3>
        <ul style="margin: 0 0 20px; padding: 0 0 0 20px; color: #334E68; line-height: 1.8; font-size: 14px;">
          <li>Your account will be created automatically</li>
          <li>You'll join ${organizationName}'s team</li>
          <li>You'll have access to monitor properties and wells</li>
          <li>You'll receive alerts when activity is detected</li>
        </ul>

        <!-- Role description -->
        <div style="background: #F7FAFC; border-radius: 6px; padding: 20px; margin: 20px 0;">
          <h4 style="margin: 0 0 10px; color: #1C2B36; font-size: 14px;">Your role: ${role}</h4>
          <p style="margin: 0; font-size: 14px; color: #334E68; line-height: 1.5;">
            ${role === 'Admin' 
              ? 'As an Admin, you can add/remove properties and wells, invite team members, and manage the organization.'
              : role === 'Editor'
              ? 'As an Editor, you can add/remove properties and wells, and view all organization data.'
              : 'As a Viewer, you can view properties, wells, and activity reports.'}
          </p>
        </div>
        
        <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;">
        
        <p style="font-size: 14px; color: #718096; margin: 0;">
          <strong>Questions?</strong> Just reply to this email or contact ${inviterName}.
        </p>
        
        <p style="font-size: 16px; color: #334E68; margin: 30px 0 0;">
          — Mineral Watch Team
        </p>
      </div>
      
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Generate text email template for organization invites
 */
export function getInviteEmailText(
  email: string,
  inviterName: string,
  organizationName: string,
  role: string,
  magicLink: string
): string {
  const name = email.split('@')[0];
  return `Hi ${name},

${inviterName} has invited you to join ${organizationName} on Mineral Watch as ${role === 'Admin' ? 'an' : 'a'} ${role}.

${organizationName} uses Mineral Watch to monitor drilling activity on their mineral rights in Oklahoma.

Click here to accept the invitation:
${magicLink}

This link expires in 72 hours.

----

What happens when you accept:
- Your account will be created automatically
- You'll join ${organizationName}'s team  
- You'll have access to monitor properties and wells
- You'll receive alerts when activity is detected

Your role: ${role}
${role === 'Admin' 
  ? 'As an Admin, you can add/remove properties and wells, invite team members, and manage the organization.'
  : role === 'Editor'
  ? 'As an Editor, you can add/remove properties and wells, and view all organization data.'
  : 'As a Viewer, you can view properties, wells, and activity reports.'}

----

Questions? Just reply to this email or contact ${inviterName}.

— Mineral Watch Team`;
}

/**
 * Generate text email template for free welcome email
 * @param name User's display name
 * @param magicLink The verification/login link
 * @returns Plain text email content
 */
export function getFreeWelcomeEmailText(name: string, magicLink: string): string {
  return `Hi ${name},

Welcome to Mineral Watch! Your free account is ready.

Click here to verify your email and log in:
${magicLink}

This link expires in 15 minutes.

📧 EMAIL DELIVERY NOTE: Your first few emails may take 5-10 minutes as email providers verify our sender reputation. After that, emails arrive instantly. Also check Promotions, Updates, or Spam folders if you don't see future alerts in your inbox.

----

WHAT YOU'RE GETTING

Mineral Watch monitors Oklahoma Corporation Commission filings and alerts you when something happens on your minerals. Here's what makes us different:

WE WATCH THE NEIGHBORS
Enter your property once and we automatically monitor your section PLUS the 8 surrounding sections. This catches horizontal wells headed your way—not just activity in your exact section.

WE CHECK DAILY
Every day we scan for new drilling permits, rigs on location, and well completions.

WE TRACK STATUS CHANGES
Every week we check for changes like "Shut-In," "Plugged," or change of operator.

WE TRANSLATE IT
No confusing OCC codes. You get plain English alerts like "New Drilling Permit" or "Rig on Location."

WE TRACK EVERY OPERATOR
We scan the official state database, so we catch activity from everyone—including small operators who don't show up in paid services.

SET IT AND FORGET IT
You enter your legal description once. We handle the rest and only email you when something changes.

----

YOUR FREE PLAN
- 1 monitored property
- Adjacent section monitoring included
- Daily permit scans + weekly status checks
- Plain English email alerts

Want to monitor more properties or track specific wells by API number? Upgrade anytime from your dashboard.

----

WHAT WE DON'T DO

We're focused on drilling activity and well status—not revenue. We don't track pooling applications or royalty payments.

----

GETTING STARTED

After you log in, add your first property. You'll need:
- County
- Section (1-36)  
- Township (e.g., 12N)
- Range (e.g., 4W)

Paid plans also let you monitor individual wells by API number—with a direct link to the well location on the OCC map.

----

Questions? Just reply to this email.

— Mineral Watch`;
}