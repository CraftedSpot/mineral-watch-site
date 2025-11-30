/**
 * Email Service - Sends alert emails via Postmark
 * Design matches Mineral Watch homepage mockups
 */

const POSTMARK_API_URL = 'https://api.postmarkapp.com/email';

/**
 * Generate a signed token for track-this-well links
 * @param {string} userId - Airtable user record ID
 * @param {string} apiNumber - Well API number
 * @param {number} expiration - Unix timestamp
 * @param {string} secret - Secret key from environment
 * @returns {string} - SHA256 hash token
 */
async function generateTrackToken(userId, apiNumber, expiration, secret) {
  const payload = `${userId}:${apiNumber}:${expiration}:${secret}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(payload);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  const hashHex = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * Send an alert email to a user
 * @param {Object} env - Worker environment
 * @param {Object} data - Email data
 * @param {string} data.to - Recipient email
 * @param {string} data.userName - Recipient name
 * @param {string} data.alertLevel - YOUR PROPERTY, ADJACENT SECTION, or TRACKED WELL
 * @param {string} data.activityType - New Permit, Well Completed, Operator Transfer, etc.
 * @param {string} data.wellName - Name of the well
 * @param {string} data.operator - Current operator
 * @param {string} data.location - Section-Township-Range string
 * @param {string} data.county - County name
 * @param {string} [data.occLink] - Link to OCC filing document
 * @param {string} [data.mapLink] - Pin-drop link to OCC GIS map (pre-generated)
 * @param {string} [data.previousOperator] - For transfers
 * @param {string} [data.drillType] - HH, DH, VH
 * @param {string} [data.apiNumber] - 10-digit API number
 * @param {string} [data.wellType] - OIL, GAS, etc.
 * @param {string} [data.userId] - Airtable user record ID for signed links
 */
export async function sendAlertEmail(env, data) {
  const {
    to,
    userName,
    alertLevel,
    activityType,
    wellName,
    operator,
    location,
    county,
    occLink,
    mapLink,
    previousOperator,
    drillType,
    apiNumber,
    wellType,
    userId
  } = data;
  
  const subject = buildSubject(alertLevel, activityType, county);
  const htmlBody = await buildHtmlBody(data, env);
  const textBody = buildTextBody(data);
  
  const response = await fetch(POSTMARK_API_URL, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': env.POSTMARK_API_KEY
    },
    body: JSON.stringify({
      From: 'alerts@mymineralwatch.com',
      To: to,
      Subject: subject,
      HtmlBody: htmlBody,
      TextBody: textBody,
      MessageStream: 'outbound'
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Postmark send failed: ${response.status} - ${error}`);
  }
  
  console.log(`[Email] Sent ${activityType} alert to ${to}`);
  return await response.json();
}

/**
 * Build email subject line
 */
function buildSubject(alertLevel, activityType, county) {
  const levelEmoji = {
    'YOUR PROPERTY': '🔴',
    'ADJACENT SECTION': '🟠',
    'TRACKED WELL': '🔵'
  };
  
  const emoji = levelEmoji[alertLevel] || '⚡';
  return `${emoji} ${activityType} - ${county} County | Mineral Watch`;
}

/**
 * Get styling config based on alert level
 */
function getAlertLevelStyle(alertLevel) {
  const styles = {
    'YOUR PROPERTY': {
      color: '#DC2626',
      bgColor: '#FEF2F2',
      borderColor: '#DC2626'
    },
    'ADJACENT SECTION': {
      color: '#D97706',
      bgColor: '#FFFBEB',
      borderColor: '#D97706'
    },
    'TRACKED WELL': {
      color: '#0D9488',
      bgColor: '#F0FDFA',
      borderColor: '#0D9488'
    }
  };
  return styles[alertLevel] || styles['YOUR PROPERTY'];
}

/**
 * Get styling config based on activity type
 */
function getActivityStyle(activityType) {
  const styles = {
    'New Permit': {
      color: '#1E40AF',
      bgColor: '#DBEAFE',
      label: 'NEW PERMIT'
    },
    'Well Completed': {
      color: '#047857',
      bgColor: '#D1FAE5',
      label: 'WELL COMPLETED'
    },
    'Operator Transfer': {
      color: '#6D28D9',
      bgColor: '#EDE9FE',
      label: 'OPERATOR TRANSFER'
    },
    'Status Change': {
      color: '#0369A1',
      bgColor: '#E0F2FE',
      label: 'STATUS CHANGE'
    }
  };
  return styles[activityType] || { color: '#374151', bgColor: '#F3F4F6', label: activityType.toUpperCase() };
}

/**
 * Get contextual explanation based on activity type
 */
function getExplanation(activityType, alertLevel) {
  const explanations = {
    'New Permit': {
      meaning: alertLevel === 'YOUR PROPERTY' 
        ? 'An operator has filed a permit to drill a new well on your property.'
        : 'An operator has filed a permit to drill a new well in a section adjacent to yours. Your minerals may be included in the drilling unit.',
      tip: 'Watch for pooling notices or lease offers in the coming weeks.',
      tipType: 'warning'
    },
    'Well Completed': {
      meaning: 'Drilling is complete and the well is now producing oil or gas.',
      tip: '🎉 Royalty checks should follow. First payment typically arrives 3-6 months after completion.',
      tipType: 'success'
    },
    'Operator Transfer': {
      meaning: 'Operational control of this well has transferred to a new company. The new operator will handle royalty payments going forward.',
      tip: '⚠️ Your checks will come from the new operator. Watch for a new division order in the mail.',
      tipType: 'warning'
    },
    'Status Change': {
      meaning: 'The well status has been updated in OCC records.',
      tip: 'Review the filing for details on what changed.',
      tipType: 'info'
    }
  };
  return explanations[activityType] || { meaning: 'New activity detected on this well.', tip: '', tipType: 'info' };
}

/**
 * Build HTML email body - matches homepage mockup design
 */
async function buildHtmlBody(data, env) {
  const {
    userName,
    alertLevel,
    activityType,
    wellName,
    operator,
    location,
    county,
    occLink,
    mapLink,
    previousOperator,
    drillType,
    apiNumber,
    wellType,
    userId
  } = data;
  
  const levelStyle = getAlertLevelStyle(alertLevel);
  const activityStyle = getActivityStyle(activityType);
  const explanation = getExplanation(activityType, alertLevel);
  
  const drillTypeLabel = {
    'HH': 'Horizontal',
    'DH': 'Directional',
    'VH': 'Vertical'
  }[drillType] || '';
  
  const tipStyles = {
    warning: { bg: '#FEF3C7', border: '#F59E0B', text: '#92400E' },
    success: { bg: '#F0FDF4', border: '#22C55E', text: '#166534' },
    info: { bg: '#F0F9FF', border: '#0EA5E9', text: '#0369A1' }
  };
  const tipStyle = tipStyles[explanation.tipType] || tipStyles.info;
  
  // Generate signed tracking link if we have apiNumber and userId
  let trackingLink = null;
  if (apiNumber && userId && env.TRACK_WELL_SECRET) {
    const expiration = Math.floor(Date.now() / 1000) + (48 * 60 * 60); // 48 hours from now
    const token = await generateTrackToken(userId, apiNumber, expiration, env.TRACK_WELL_SECRET);
    trackingLink = `https://portal.mymineralwatch.com/add-well?api=${apiNumber}&user=${userId}&token=${token}&exp=${expiration}`;
  }
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #F3F4F6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #F3F4F6; padding: 20px 0;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 480px; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          
          <!-- Header -->
          <tr>
            <td style="background: #1C2B36; padding: 20px 24px;">
              <span style="color: #ffffff; font-size: 20px; font-weight: 700; font-family: Georgia, serif;">Mineral Watch</span>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 24px;">
              
              <!-- Greeting -->
              <p style="font-size: 12px; color: #64748B; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 6px;">Daily Alert</p>
              <h1 style="font-size: 20px; color: #1C2B36; margin: 0 0 8px; font-family: Georgia, serif; font-weight: 700;">
                ${activityType === 'New Permit' ? 'New Permit Filed' : activityType}
              </h1>
              <p style="font-size: 15px; color: #334E68; margin: 0 0 20px;">
                Hi ${userName || 'there'}, we found activity that matches your monitored ${alertLevel === 'TRACKED WELL' ? 'well' : 'properties'}.
              </p>
              
              <!-- Alert Card -->
              <div style="border: 1px solid #E2E8F0; border-left: 4px solid ${levelStyle.borderColor}; border-radius: 0 8px 8px 0; overflow: hidden;">
                
                <!-- Card Header -->
                <div style="background: ${levelStyle.bgColor}; padding: 12px 16px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td>
                        <span style="display: inline-block; background: ${levelStyle.color}; color: white; font-size: 10px; font-weight: 700; padding: 4px 8px; border-radius: 4px; margin-right: 8px;">${alertLevel}</span>
                        <span style="display: inline-block; background: ${activityStyle.bgColor}; color: ${activityStyle.color}; font-size: 10px; font-weight: 700; padding: 4px 8px; border-radius: 4px;">${activityStyle.label}</span>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding-top: 10px;">
                        <span style="font-size: 11px; color: #64748B; text-transform: uppercase; letter-spacing: 0.5px;">${location} · ${county} County</span>
                      </td>
                    </tr>
                  </table>
                </div>
                
                <!-- Card Body -->
                <div style="padding: 16px;">
                  
                  <!-- Well Details -->
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 16px;">
                    <tr>
                      <td style="padding: 4px 0; font-size: 13px;">
                        <span style="color: #64748B;">Well:</span>
                        <span style="color: #1C2B36; font-weight: 600; margin-left: 8px;">${wellName || 'Not specified'}</span>
                      </td>
                    </tr>
                    ${apiNumber ? `
                    <tr>
                      <td style="padding: 4px 0; font-size: 13px;">
                        <span style="color: #64748B;">API:</span>
                        <span style="color: #1C2B36; font-family: monospace; margin-left: 8px;">${apiNumber}</span>
                      </td>
                    </tr>
                    ` : ''}
                    <tr>
                      <td style="padding: 4px 0; font-size: 13px;">
                        <span style="color: #64748B;">Operator:</span>
                        <span style="color: #1C2B36; font-weight: 600; margin-left: 8px;">${operator || 'Not specified'}</span>
                      </td>
                    </tr>
                    ${previousOperator ? `
                    <tr>
                      <td style="padding: 4px 0; font-size: 13px;">
                        <span style="color: #64748B;">Previous:</span>
                        <span style="color: #1C2B36; margin-left: 8px;">${previousOperator}</span>
                      </td>
                    </tr>
                    ` : ''}
                    ${drillTypeLabel ? `
                    <tr>
                      <td style="padding: 4px 0; font-size: 13px;">
                        <span style="color: #64748B;">Type:</span>
                        <span style="color: #1C2B36; margin-left: 8px;">${drillTypeLabel}</span>
                      </td>
                    </tr>
                    ` : ''}
                  </table>
                  
                  <!-- What This Means -->
                  <div style="background: #F8FAFC; border-radius: 6px; padding: 12px; margin-bottom: 12px;">
                    <p style="margin: 0; font-size: 13px; color: #334E68; line-height: 1.5;">
                      <strong style="color: #1C2B36;">What this means:</strong> ${explanation.meaning}
                    </p>
                  </div>
                  
                  <!-- Tip Box -->
                  ${explanation.tip ? `
                  <div style="background: ${tipStyle.bg}; border-radius: 6px; padding: 12px; border-left: 3px solid ${tipStyle.border}; margin-bottom: 16px;">
                    <p style="margin: 0; font-size: 13px; color: ${tipStyle.text}; line-height: 1.5;">
                      ${explanation.tip}
                    </p>
                  </div>
                  ` : ''}
                  
                  <!-- Action Buttons -->
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td align="center" style="padding-top: 8px;">
                        ${occLink ? `
                        <a href="${occLink}" style="display: inline-block; background: #C05621; color: #ffffff; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 13px; margin-right: 8px;">View OCC Filing →</a>
                        ` : ''}
                        ${mapLink ? `
                        <a href="${mapLink}" style="display: inline-block; background: #1C2B36; color: #ffffff; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 13px; margin-right: 8px;">View on Map →</a>
                        ` : ''}
                        ${trackingLink ? `
                        <a href="${trackingLink}" style="display: inline-block; background: #047857; color: #ffffff; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 13px;">Track This Well →</a>
                        ` : ''}
                      </td>
                    </tr>
                  </table>
                  
                </div>
              </div>
              
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background: #F8FAFC; padding: 20px 24px; border-top: 1px solid #E2E8F0;">
              <p style="font-size: 11px; color: #64748B; margin: 0 0 12px; line-height: 1.5;">
                <strong>Note:</strong> This alert indicates activity near your mineral interests. It does not guarantee you hold rights in the spacing unit or will receive royalties.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size: 12px;">
                    <a href="https://mymineralwatch.com/dashboard" style="color: #334E68; text-decoration: none; margin-right: 16px;">Dashboard</a>
                    <a href="https://mymineralwatch.com/settings" style="color: #334E68; text-decoration: none; margin-right: 16px;">Settings</a>
                    <a href="https://mymineralwatch.com/unsubscribe" style="color: #64748B; text-decoration: none;">Unsubscribe</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Copyright -->
          <tr>
            <td style="background: #1C2B36; padding: 16px 24px; text-align: center;">
              <p style="color: #64748B; margin: 0; font-size: 11px;">© ${new Date().getFullYear()} Mineral Watch Oklahoma</p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Build plain text email body
 */
function buildTextBody(data) {
  const {
    userName,
    alertLevel,
    activityType,
    wellName,
    operator,
    location,
    county,
    occLink,
    mapLink,
    previousOperator,
    apiNumber
  } = data;
  
  const explanation = getExplanation(activityType, alertLevel);
  
  let text = `
MINERAL WATCH - ${activityType.toUpperCase()}
${'='.repeat(40)}

Alert Level: ${alertLevel}

Hi ${userName || 'there'},

We found activity that matches your monitored ${alertLevel === 'TRACKED WELL' ? 'well' : 'properties'}:

Well: ${wellName || 'Not specified'}
${apiNumber ? `API: ${apiNumber}\n` : ''}Operator: ${operator || 'Not specified'}
${previousOperator ? `Previous Operator: ${previousOperator}\n` : ''}Location: ${location}
County: ${county}

WHAT THIS MEANS:
${explanation.meaning}

${explanation.tip ? `TIP: ${explanation.tip}\n` : ''}
${occLink ? `View OCC Filing: ${occLink}\n` : ''}${mapLink ? `View on OCC Map: ${mapLink}\n` : ''}
---

Note: This alert indicates activity near your mineral interests. It does not guarantee you hold rights in the spacing unit or will receive royalties.

---
Mineral Watch Oklahoma
https://mymineralwatch.com
  `.trim();
  
  return text;
}
