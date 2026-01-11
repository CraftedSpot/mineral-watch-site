/**
 * Email Service - Sends alert emails via Postmark
 * Design matches Mineral Watch homepage mockups
 */

import { normalizeSection } from '../utils/normalize.js';
import { getOCCWellRecordsLink, getOCCCookieNotice } from '../utils/occLink.js';

const POSTMARK_API_URL = 'https://api.postmarkapp.com/email';

/**
 * Send a simple email via Postmark
 * @param {Object} env - Worker environment
 * @param {Object} data - Email data
 * @param {string} data.to - Recipient email
 * @param {string} data.subject - Email subject
 * @param {string} data.html - Email HTML body
 * @returns {Promise<Object>} Postmark response
 */
export async function sendEmail(env, { to, subject, html }) {
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
      HtmlBody: html,
      TextBody: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      MessageStream: 'outbound'
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Postmark send failed: ${response.status} - ${error}`);
  }

  console.log(`[Email] Sent to ${to}: ${subject}`);
  return await response.json();
}

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
 * @param {boolean} [data.isMultiSection] - Horizontal well crosses multiple sections
 * @param {string} [data.bhLocation] - Bottom hole location (S31 T19N R11W)
 * @param {number} [data.lateralLength] - Lateral length in feet
 * @param {string} [data.lateralDirection] - Lateral direction (SW, NE, etc.)
 * @param {string} [data.sectionsAffected] - Sections affected (S19, S31)
 * @param {string} [data.formationName] - Formation name (Woodford)
 * @param {number} [data.formationDepth] - Formation depth in feet
 * @param {number} [data.ipGas] - Initial gas production MCF/day
 * @param {number} [data.ipOil] - Initial oil production BBL/day
 * @param {number} [data.ipWater] - Initial water production BBL/day
 * @param {string} [data.pumpingFlowing] - FLOWING or PUMPING
 * @param {string} [data.spudDate] - Formatted spud date
 * @param {string} [data.completionDate] - Formatted completion date
 * @param {string} [data.firstProdDate] - Formatted first production date
 * @param {string} [data.approvalDate] - Permit approval date
 * @param {string} [data.expireDate] - Permit expiration date
 * @param {string} [data.bhSection] - Bottom hole section for directional wells
 * @param {string} [data.bhTownship] - Bottom hole township for directional wells
 * @param {string} [data.bhRange] - Bottom hole range for directional wells
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
    userId,
    // Horizontal well data (completions only)
    isMultiSection,
    bhLocation,
    lateralLength,
    lateralDirection,
    sectionsAffected,
    // Production data
    formationName,
    formationDepth,
    ipGas,
    ipOil,
    ipWater,
    pumpingFlowing,
    // Timeline
    spudDate,
    completionDate,
    firstProdDate,
    // Status change data
    statusChange
  } = data;
  
  const subject = buildSubject(alertLevel, activityType, county, statusChange);
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
function buildSubject(alertLevel, activityType, county, statusChange = null) {
  const levelEmoji = {
    'YOUR PROPERTY': '🔴',
    'ADJACENT SECTION': '🟠',
    'TRACKED WELL': '🔵',
    'STATUS CHANGE': '🔵'
  };

  const emoji = levelEmoji[alertLevel] || '⚡';

  // For status changes, make the subject more specific
  if (activityType === 'Status Change' && statusChange) {
    const { current } = statusChange;
    if (current === 'Plugged & Abandoned') {
      return `${emoji} Well Plugged & Abandoned - ${county} County | Mineral Watch`;
    }
    if (current === 'Active' || current === 'Producing') {
      return `${emoji} Well Now Active - ${county} County | Mineral Watch`;
    }
    if (current === 'Shut In') {
      return `${emoji} Well Shut In - ${county} County | Mineral Watch`;
    }
  }

  // For permit expiration, use urgent subject line
  if (activityType === 'Permit Expired') {
    return `⚠️ Permit Expired Without Drilling - ${county} County | Mineral Watch`;
  }
  if (activityType === 'Permit Expiring') {
    return `⏰ Drilling Permit Expiring Soon - ${county} County | Mineral Watch`;
  }

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
    },
    'Permit Expiring': {
      color: '#B45309',
      bgColor: '#FEF3C7',
      label: 'PERMIT EXPIRING'
    },
    'Permit Expired': {
      color: '#DC2626',
      bgColor: '#FEF2F2',
      label: 'PERMIT EXPIRED'
    }
  };
  return styles[activityType] || { color: '#374151', bgColor: '#F3F4F6', label: activityType.toUpperCase() };
}

/**
 * Get contextual explanation based on activity type
 */
function getExplanation(activityType, alertLevel, isMultiSection = false, isDirectional = false, statusChange = null) {
  // Handle special horizontal path alert levels
  if (alertLevel === 'HORIZONTAL PATH THROUGH PROPERTY') {
    return {
      meaning: 'A horizontal well passes through your property section. While the surface location is elsewhere, the wellbore travels underground through your minerals.',
      tip: 'You should be included in the drilling unit and receive royalties if you own minerals in this section.',
      tipType: 'warning'
    };
  }
  
  if (alertLevel === 'HORIZONTAL PATH ADJACENT') {
    return {
      meaning: 'A horizontal well passes near your property. The wellbore travels underground through a section adjacent to yours.',
      tip: 'Your minerals may be included in the drilling unit depending on spacing rules and drainage patterns.',
      tipType: 'info'
    };
  }
  
  const explanations = {
    'New Permit': {
      meaning: alertLevel === 'YOUR PROPERTY' 
        ? (isDirectional 
          ? 'An operator has filed a permit to drill a directional well. The drilling rig will be on your property, but the well path may target minerals in another section.'
          : 'An operator has filed a permit to drill a new well on your property.')
        : 'An operator has filed a permit to drill a new well in a section adjacent to yours. Your minerals may be included in the drilling unit.',
      tip: 'If you haven\'t already leased your minerals, you may receive a pooling notice or lease offer.',
      tipType: 'warning'
    },
    'Well Completed': {
      meaning: isMultiSection 
        ? 'This horizontal well crosses multiple sections and is now producing. If you received a pooling order for this unit, royalties should follow.'
        : 'Drilling is complete and the well is now producing oil or gas.',
      tip: 'Royalty checks should follow. First payment typically arrives 3-6 months after completion.',
      tipType: 'success'
    },
    'Operator Transfer': {
      meaning: 'Operational control of this well has transferred to a new company. The new operator will handle royalty payments going forward.',
      tip: '⚠️ Your checks will come from the new operator. Watch for a new division order in the mail.',
      tipType: 'warning'
    },
    'Status Change': {
      meaning: statusChange ? getStatusChangeMeaning(statusChange) : 'The well status has been updated in OCC records.',
      tip: statusChange ? getStatusChangeTip(statusChange) : 'Review the filing for details on what changed.',
      tipType: statusChange ? getStatusChangeTipType(statusChange) : 'info'
    },
    'Permit Expiring': {
      meaning: alertLevel === 'YOUR PROPERTY'
        ? 'A drilling permit on your property is approaching its expiration date. Oklahoma permits are valid for 1 year from approval. If the operator doesn\'t begin drilling (spud the well) before expiration, they\'ll need to file for a new permit.'
        : 'A drilling permit near your property is approaching expiration. If the operator doesn\'t begin drilling before expiration, they\'ll need to file for a new permit.',
      tip: `⏰ What to expect if a permit expires:\n• The operator may file for a new permit if still interested\n• You may receive a new lease offer or pooling notice\n• It does NOT mean your minerals are no longer leased—your lease terms still apply\n• Permits expire but leases continue under their own terms`,
      tipType: 'warning'
    },
    'Permit Expired': {
      meaning: alertLevel === 'YOUR PROPERTY'
        ? 'A drilling permit on your property has expired without drilling. The operator did not spud (begin drilling) the well within the 1-year permit window. They would need to file a new permit to drill this well.'
        : 'A drilling permit near your property has expired without drilling. The operator did not begin drilling within the 1-year permit window.',
      tip: `📋 What this means for you:\n• The specific well location permit is no longer valid\n• Your lease remains in effect under its own terms\n• The operator may file a new permit or pursue different locations\n• Watch for new permit filings or lease activity in your area`,
      tipType: 'warning'
    }
  };
  return explanations[activityType] || { meaning: 'New activity detected on this well.', tip: '', tipType: 'info' };
}

/**
 * Get status change specific meaning based on the transition
 */
function getStatusChangeMeaning(statusChange) {
  const { previous, current } = statusChange;
  
  // Common status transitions with specific meanings
  if (previous === 'Active' && current === 'Plugged & Abandoned') {
    return 'This well has been permanently plugged and abandoned. No further production is expected.';
  }
  if (previous === 'Never Drilled' && current === 'Active') {
    return 'This permitted well is now active! Drilling has been completed and the well is in production.';
  }
  if (previous === 'Active' && current === 'Shut In') {
    return 'This well has been temporarily shut in. Production has been suspended but may resume in the future.';
  }
  if (previous === 'Shut In' && current === 'Active') {
    return 'Good news! This well has been reactivated and is now producing again.';
  }
  if (current === 'Producing') {
    return 'This well is now actively producing oil or gas.';
  }
  if (current === 'Drilling') {
    return 'Drilling operations have commenced on this well.';
  }
  if (current === 'Completed') {
    return 'Drilling is complete and the well is being prepared for production.';
  }
  
  // Default message with status names
  return `Well status changed from ${previous} to ${current}.`;
}

/**
 * Get status change specific tip with actionable guidance
 */
function getStatusChangeTip(statusChange) {
  const { previous, current } = statusChange;
  
  // TO: Plugged & Abandoned
  if (current === 'Plugged & Abandoned') {
    return `The operator has formally plugged and abandoned this well. You may want to:
• Stop expecting future production from this well
• Check for final royalty payments within 90 days
• Look for nearby active wells or new permits on your tract
• Save all records for tax purposes`;
  }
  
  // TO: Active/Producing  
  if (current === 'Active' || current === 'Producing') {
    return `This well is now active and producing. You may want to:
• Review your lease terms or division orders
• Watch for new production or payment activity in upcoming months
• Keep an eye on nearby filings that could indicate additional development
• Expect royalty checks to begin/resume within 60-90 days`;
  }
  
  // TO: Shut In
  if (current === 'Shut In') {
    return `This well has been temporarily shut in. You may want to:
• Contact the operator for shut-in timeline expectations
• Review your lease for shut-in royalty provisions
• Monitor for reactivation notices
• Note that regular royalty payments will pause`;
  }
  
  // FROM: Plugged to Active (re-entry scenario)
  if (previous === 'Plugged & Abandoned' && (current === 'Active' || current === 'Producing')) {
    return `This previously plugged well is now active again. You may want to:
• Check if this is a re-entry or workover operation
• Review any new agreements or division orders
• Contact the operator about the reactivation
• Expect royalty checks to resume within 60-90 days`;
  }
  
  // Default for other transitions
  return `Status has changed to ${current}. You may want to:
• Review your lease terms or division orders
• Contact the operator for more information
• Monitor for changes in production or payments`;
}

/**
 * Get status change tip type (affects color)
 */
function getStatusChangeTipType(statusChange) {
  const { current } = statusChange;
  
  if (current === 'Plugged & Abandoned') return 'warning';
  if (current === 'Active' || current === 'Producing') return 'success';
  if (current === 'Shut In') return 'warning';
  
  return 'info';
}

/**
 * Format date string to MMM D, YYYY format
 */
function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr; // Return original if invalid
    const options = { month: 'short', day: 'numeric', year: 'numeric' };
    return date.toLocaleDateString('en-US', options);
  } catch (err) {
    return dateStr; // Return original on error
  }
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
    userId,
    // Horizontal well data
    isMultiSection,
    bhLocation,
    lateralLength,
    lateralDirection,
    sectionsAffected,
    // Production data
    formationName,
    formationDepth,
    ipGas,
    ipOil,
    ipWater,
    spudDate,
    completionDate,
    firstProdDate,
    operatorPhone,
    pumpingFlowing,
    // Permit-specific data
    approvalDate,
    expireDate,
    bhSection,
    bhTownship,
    bhRange,
    // Status change data
    statusChange,
    // Permit expiration data
    expirationDetails
  } = data;
  
  const levelStyle = getAlertLevelStyle(alertLevel);
  const activityStyle = getActivityStyle(activityType);
  
  const drillTypeLabel = {
    'HH': 'Horizontal',
    'DH': 'Directional',
    'VH': 'Vertical'
  }[drillType] || '';
  
  // Check if this is a directional well (for permits)
  const isDirectional = activityType === 'New Permit' && 
    bhSection && bhTownship && bhRange &&
    (bhSection !== '0' && bhTownship !== '0' && bhRange !== '0') &&
    (normalizeSection(bhSection) !== normalizeSection(location.split(' ')[0].replace('S', '')) ||
     bhTownship !== location.split(' ')[1].replace('T', '') ||
     bhRange !== location.split(' ')[2].replace('R', ''));
  
  const explanation = getExplanation(activityType, alertLevel, isMultiSection, isDirectional, statusChange);
  
  const tipStyles = {
    warning: { bg: '#FEF3C7', border: '#F59E0B', text: '#92400E' },
    success: { bg: '#F0FDF4', border: '#22C55E', text: '#166534' },
    info: { bg: '#F0F9FF', border: '#0EA5E9', text: '#0369A1' }
  };
  const tipStyle = tipStyles[explanation.tipType] || tipStyles.info;
  
  // Generate signed tracking link if we have apiNumber and userId
  // Only show for non-tracked wells (property/adjacent alerts)
  let trackingLink = null;
  const shouldShowTrackButton = alertLevel !== 'TRACKED WELL' && alertLevel !== 'STATUS CHANGE';
  
  if (shouldShowTrackButton && apiNumber && userId && env.TRACK_WELL_SECRET) {
    const expiration = Math.floor(Date.now() / 1000) + (48 * 60 * 60); // 48 hours from now
    const token = await generateTrackToken(userId, apiNumber, expiration, env.TRACK_WELL_SECRET);
    trackingLink = `https://portal.mymineralwatch.com/add-well?api=${apiNumber}&user=${userId}&token=${token}&exp=${expiration}`;
    console.log(`[Email] Generated track link for API ${apiNumber}, user ${userId}, token first 8 chars: ${token.substring(0, 8)}`);
  } else {
    const reason = !shouldShowTrackButton ? 'already tracked' : 
                   !apiNumber ? 'no API' : 
                   !userId ? 'no userId' : 
                   !env.TRACK_WELL_SECRET ? 'no secret' : 'unknown';
    console.log(`[Email] Track link not generated: reason=${reason}, alertLevel=${alertLevel}, apiNumber=${apiNumber}, userId=${userId}`);
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
                ${activityType === 'New Permit' ? 'New Drilling Permit Filed' : activityType}
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
                        ${isMultiSection ? `
                        <span style="display: inline-block; background: #9F580A; color: white; font-size: 10px; font-weight: 700; padding: 4px 8px; border-radius: 4px; margin-left: 4px;">⚠️ MULTI-SECTION</span>
                        ` : ''}
                        ${isDirectional ? `
                        <span style="display: inline-block; background: #7C3AED; color: white; font-size: 10px; font-weight: 700; padding: 4px 8px; border-radius: 4px; margin-left: 4px;">↗️ DIRECTIONAL</span>
                        ` : ''}
                      </td>
                    </tr>
                    <tr>
                      <td style="padding-top: 10px;">
                        <span style="font-size: 11px; color: #64748B; text-transform: uppercase; letter-spacing: 0.5px;">
                          ${bhLocation && bhLocation !== location 
                            ? `${location} → ${bhLocation}${lateralDirection ? ` (${lateralDirection})` : ''}${lateralLength ? ` · ${lateralLength.toLocaleString()} ft lateral` : ''} · ${county} County`
                            : `${location} · ${county} County`
                          }
                        </span>
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
                    ${(approvalDate || expireDate) && activityType === 'New Permit' ? `
                    <tr>
                      <td style="padding: 4px 0; font-size: 13px;">
                        ${approvalDate ? `<span style="color: #64748B;">Approved:</span> <span style="color: #1C2B36; margin-left: 8px;">${formatDate(approvalDate)}</span>` : ''}
                        ${approvalDate && expireDate ? ' · ' : ''}
                        ${expireDate ? `<span style="color: #64748B;">Expires:</span> <span style="color: #1C2B36; margin-left: 8px;">${formatDate(expireDate)}</span>` : ''}
                      </td>
                    </tr>
                    ` : ''}
                    ${previousOperator ? `
                    <tr>
                      <td style="padding: 4px 0; font-size: 13px;">
                        <span style="color: #64748B;">Previous:</span>
                        <span style="color: #1C2B36; margin-left: 8px;">${previousOperator}</span>
                      </td>
                    </tr>
                    ` : ''}
                    ${statusChange ? `
                    <tr>
                      <td style="padding: 8px 0; font-size: 14px;">
                        <div style="background: #F0F9FF; border-radius: 6px; padding: 10px; border-left: 3px solid #0EA5E9;">
                          <span style="color: #64748B;">Status Changed:</span>
                          <span style="color: #DC2626; font-weight: 600; margin-left: 8px;">${statusChange.previous}</span>
                          <span style="color: #64748B; margin: 0 8px;">→</span>
                          <span style="color: #047857; font-weight: 600;">${statusChange.current}</span>
                        </div>
                      </td>
                    </tr>
                    ` : ''}
                    ${expirationDetails ? `
                    <tr>
                      <td style="padding: 8px 0; font-size: 14px;">
                        <div style="background: ${expirationDetails.status === 'EXPIRED' ? '#FEF2F2' : '#FEF3C7'}; border-radius: 6px; padding: 12px; border-left: 4px solid ${expirationDetails.status === 'EXPIRED' ? '#DC2626' : '#F59E0B'};">
                          <div style="font-size: 22px; font-weight: 700; color: ${expirationDetails.status === 'EXPIRED' ? '#DC2626' : '#B45309'}; margin-bottom: 4px;">
                            ${expirationDetails.status === 'EXPIRED'
                              ? '⚠️ PERMIT EXPIRED'
                              : expirationDetails.daysUntilExpiration <= 7
                                ? `⏰ ${expirationDetails.daysUntilExpiration} DAY${expirationDetails.daysUntilExpiration !== 1 ? 'S' : ''} LEFT`
                                : `⏰ EXPIRES IN ${expirationDetails.daysUntilExpiration} DAYS`
                            }
                          </div>
                          <div style="font-size: 12px; color: ${expirationDetails.status === 'EXPIRED' ? '#991B1B' : '#92400E'};">
                            ${expirationDetails.status === 'EXPIRED'
                              ? 'This permit expired without drilling. The operator would need to file a new permit.'
                              : 'Drilling must begin before expiration or the operator must file a new permit.'
                            }
                          </div>
                        </div>
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
                    ${isDirectional ? `
                    <tr>
                      <td style="padding: 4px 0; font-size: 13px;">
                        <span style="color: #64748B; display: block; margin-bottom: 4px;">⚠️ Surface location on your property</span>
                        <span style="color: #6B7280;">Well targets: <strong style="color: #1C2B36;">S${normalizeSection(bhSection)} T${bhTownship} R${bhRange}</strong></span>
                      </td>
                    </tr>
                    ` : ''}
                    ${formationName ? `
                    <tr>
                      <td style="padding: 4px 0; font-size: 13px;">
                        <span style="color: #64748B;">Formation:</span>
                        <span style="color: #1C2B36; margin-left: 8px;">${formationName}${formationDepth ? ` @ ${formationDepth.toLocaleString()} ft` : ''}</span>
                      </td>
                    </tr>
                    ` : ''}
                    ${(ipGas || ipOil) ? `
                    <tr>
                      <td style="padding: 4px 0; font-size: 13px;">
                        <span style="color: #64748B;">Initial Production:</span>
                        <span style="color: #1C2B36; margin-left: 8px;">
                          ${ipGas ? `Gas: ${ipGas.toLocaleString()} MCF/day` : ''}${ipGas && ipOil ? ' · ' : ''}${ipOil ? `Oil: ${ipOil.toLocaleString()} BBL/day` : ''}
                          ${pumpingFlowing ? ` <span style="color: #64748B; font-size: 11px;">(${pumpingFlowing.toLowerCase()})</span>` : ''}
                        </span>
                      </td>
                    </tr>
                    ` : ''}
                  </table>
                  
                  <!-- Timeline Section -->
                  ${(spudDate || completionDate || firstProdDate) ? `
                  <div style="background: #F0F9FF; border-radius: 6px; padding: 12px; margin-bottom: 12px; border-left: 3px solid #0EA5E9;">
                    <p style="margin: 0 0 6px; font-size: 12px; font-weight: 600; color: #0369A1;">Timeline</p>
                    <p style="margin: 0; font-size: 13px; color: #334E68;">
                      ${spudDate ? `Spud: ${spudDate}` : ''}${spudDate && completionDate ? ' · ' : ''}${completionDate ? `Completed: ${completionDate}` : ''}${(spudDate || completionDate) && firstProdDate ? ' · ' : ''}${firstProdDate ? `First Prod: ${firstProdDate}` : ''}
                    </p>
                    ${firstProdDate ? `<p style="margin: 8px 0 0; font-size: 12px; color: #64748B;">Expect your first royalty check 60-90 days after first sales</p>` : ''}
                  </div>
                  ` : ''}
                  
                  <!-- What This Means -->
                  <div style="background: #F8FAFC; border-radius: 6px; padding: 12px; margin-bottom: 12px;">
                    <p style="margin: 0; font-size: 13px; color: #334E68; line-height: 1.5;">
                      <strong style="color: #1C2B36;">What this means:</strong> ${explanation.meaning}
                    </p>
                  </div>
                  
                  <!-- Tip Box -->
                  ${explanation.tip ? `
                  <div style="background: ${tipStyle.bg}; border-radius: 6px; padding: 12px; border-left: 3px solid ${tipStyle.border}; margin-bottom: 16px;">
                    <p style="margin: 0; font-size: 13px; color: ${tipStyle.text}; line-height: 1.5; white-space: pre-line;">
                      ${explanation.tip}
                    </p>
                  </div>
                  ` : ''}
                  
                  <!-- Action Buttons -->
                  <table width="100%" cellpadding="0" cellspacing="0" style="padding-top: 8px;">
                    <tr>
                      ${apiNumber ? `
                      <td align="center" style="padding: 2px;">
                        <a href="${getOCCWellRecordsLink(apiNumber)}" style="display: inline-block; background: #C05621; color: #ffffff; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 13px; text-align: center; white-space: nowrap;">View OCC Records →</a>
                      </td>
                      ` : occLink ? `
                      <td align="center" style="padding: 2px;">
                        <a href="${occLink}" style="display: inline-block; background: #C05621; color: #ffffff; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 13px; text-align: center; white-space: nowrap;">View OCC Filing →</a>
                      </td>
                      ` : ''}
                      ${mapLink ? `
                      <td align="center" style="padding: 2px;">
                        <a href="${mapLink}" style="display: inline-block; background: #1C2B36; color: #ffffff; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 13px; text-align: center; white-space: nowrap;">OCC Map →</a>
                      </td>
                      ` : ''}
                      ${trackingLink ? `
                      <td align="center" style="padding: 2px;">
                        <a href="${trackingLink}" style="display: inline-block; background: #047857; color: #ffffff; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 13px; text-align: center; white-space: nowrap;">Track This Well →</a>
                      </td>
                      ` : ''}
                    </tr>
                  </table>
                  
                  ${apiNumber ? `
                  <!-- OCC Tip -->
                  <div style="margin-top: 12px; padding: 10px; background: #FEF8F1; border-radius: 6px; border-left: 3px solid #F97316;">
                    <p style="margin: 0; font-size: 11px; color: #92400E; line-height: 1.4;">
                      <strong>OCC Well Records Tip:</strong> ${getOCCCookieNotice(true)}
                    </p>
                  </div>
                  ` : ''}
                  
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
                    <a href="https://portal.mymineralwatch.com" style="color: #334E68; text-decoration: none; margin-right: 16px;">Dashboard</a>
                    <a href="https://portal.mymineralwatch.com/settings" style="color: #334E68; text-decoration: none; margin-right: 16px;">Settings</a>
                    <a href="https://portal.mymineralwatch.com/settings" style="color: #64748B; text-decoration: none;">Unsubscribe</a>
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
    apiNumber,
    // Horizontal well data
    isMultiSection,
    bhLocation,
    lateralLength,
    lateralDirection,
    sectionsAffected,
    // Production data
    formationName,
    formationDepth,
    ipGas,
    ipOil,
    ipWater,
    pumpingFlowing,
    // Timeline
    spudDate,
    completionDate,
    firstProdDate,
    // Status change data
    statusChange,
    // Permit expiration data
    expirationDetails
  } = data;

  const explanation = getExplanation(activityType, alertLevel, isMultiSection, false, statusChange);

  // Build expiration message
  let expirationText = '';
  if (expirationDetails) {
    if (expirationDetails.status === 'EXPIRED') {
      expirationText = `\n*** PERMIT EXPIRED ***\nThis permit expired without drilling. The operator would need to file a new permit.\n`;
    } else if (expirationDetails.daysUntilExpiration <= 7) {
      expirationText = `\n*** ${expirationDetails.daysUntilExpiration} DAY${expirationDetails.daysUntilExpiration !== 1 ? 'S' : ''} UNTIL EXPIRATION ***\nDrilling must begin before expiration or the operator must file a new permit.\n`;
    } else {
      expirationText = `\n*** EXPIRES IN ${expirationDetails.daysUntilExpiration} DAYS ***\nDrilling must begin before expiration or the operator must file a new permit.\n`;
    }
  }

  let text = `
MINERAL WATCH - ${activityType.toUpperCase()}
${'='.repeat(40)}

Alert Level: ${alertLevel}

Hi ${userName || 'there'},

We found activity that matches your monitored ${alertLevel === 'TRACKED WELL' ? 'well' : 'properties'}:

Well: ${wellName || 'Not specified'}
${apiNumber ? `API: ${apiNumber}\n` : ''}Operator: ${operator || 'Not specified'}
${previousOperator ? `Previous Operator: ${previousOperator}\n` : ''}${statusChange ? `\nSTATUS CHANGED: ${statusChange.previous} → ${statusChange.current}\n\n` : ''}${expirationText}${isMultiSection ? 'Type: Multi-Section Horizontal\n' : ''}Location: ${bhLocation && bhLocation !== location ? `${location} → ${bhLocation}${lateralDirection ? ` (${lateralDirection})` : ''}${lateralLength ? ` · ${lateralLength.toLocaleString()} ft lateral` : ''}` : location}
County: ${county}
${formationName ? `Formation: ${formationName}${formationDepth ? ` @ ${formationDepth.toLocaleString()} ft` : ''}\n` : ''}${(ipGas || ipOil) ? `Initial Production: ${ipGas ? `Gas: ${ipGas.toLocaleString()} MCF/day` : ''}${ipGas && ipOil ? ' · ' : ''}${ipOil ? `Oil: ${ipOil.toLocaleString()} BBL/day` : ''}${pumpingFlowing ? ` (${pumpingFlowing.toLowerCase()})` : ''}\n` : ''}${(spudDate || completionDate || firstProdDate) ? `\nTimeline:\n${spudDate ? `Spud: ${spudDate}` : ''}${spudDate && completionDate ? ' · ' : ''}${completionDate ? `Completed: ${completionDate}` : ''}${(spudDate || completionDate) && firstProdDate ? ' · ' : ''}${firstProdDate ? `First Prod: ${firstProdDate}` : ''}${firstProdDate ? '\nExpected first royalty check: 60-90 days after first sales' : ''}\n` : ''}

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
