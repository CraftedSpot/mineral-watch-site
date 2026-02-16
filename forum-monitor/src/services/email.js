/**
 * Email Service
 * Sends forum digest emails via Resend
 */

const RESEND_API_URL = 'https://api.resend.com/emails';

/**
 * Send forum digest email
 * @param {Object} env - Worker environment
 * @param {Array<Object>} posts - New forum posts with parsed data
 * @returns {Promise<Object>} - Resend response
 */
export async function sendForumDigest(env, posts) {
  if (!posts || posts.length === 0) return null;

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const subject = `New Oklahoma Forum Posts (${posts.length}) — ${dateStr}`;
  const html = buildDigestHtml(posts, dateStr);

  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Mineral Watch <support@mymineralwatch.com>',
      to: env.ADMIN_EMAIL,
      subject,
      html,
      text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Resend send failed: ${response.status} - ${error}`);
  }

  console.log(`[Email] Sent forum digest with ${posts.length} posts to ${env.ADMIN_EMAIL}`);
  return await response.json();
}

/**
 * Build HTML digest email
 */
function buildDigestHtml(posts, dateStr) {
  const postRows = posts
    .map((post) => {
      const locationBadge = post.detectedLocation
        ? `<span style="display:inline-block;background:#DBEAFE;color:#1E40AF;font-size:11px;padding:2px 8px;border-radius:4px;margin-top:4px;">${escapeHtml(post.detectedLocation)}</span>`
        : '';

      const operatorBadges = (post.operators || [])
        .map(
          (op) =>
            `<span style="display:inline-block;background:#EDE9FE;color:#6D28D9;font-size:11px;padding:2px 8px;border-radius:4px;margin-top:4px;margin-right:4px;">${escapeHtml(op)}</span>`
        )
        .join('');

      const timeAgo = post.postedAt ? formatTimeAgo(new Date(post.postedAt)) : '';

      return `
        <tr>
          <td style="padding:16px 0;border-bottom:1px solid #E2E8F0;">
            <a href="${escapeHtml(post.url)}" style="color:#1C2B36;font-size:15px;font-weight:600;text-decoration:none;line-height:1.3;">
              ${escapeHtml(post.title)}
            </a>
            <p style="margin:4px 0 0;font-size:12px;color:#64748B;">
              ${escapeHtml(post.author)}${timeAgo ? ` &bull; ${timeAgo}` : ''}${post.category ? ` &bull; ${escapeHtml(post.category)}` : ''}
            </p>
            ${locationBadge ? `<div style="margin-top:6px;">${locationBadge}</div>` : ''}
            ${operatorBadges ? `<div style="margin-top:4px;">${operatorBadges}</div>` : ''}
            ${post.excerpt ? `<p style="margin:8px 0 0;font-size:13px;color:#334E68;line-height:1.4;">${escapeHtml(post.excerpt.substring(0, 200))}${post.excerpt.length > 200 ? '...' : ''}</p>` : ''}
          </td>
        </tr>
      `;
    })
    .join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F3F4F6;padding:20px 0;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="background:#1C2B36;padding:20px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <span style="color:#ffffff;font-size:20px;font-weight:700;font-family:Georgia,serif;">Mineral Watch</span>
                  </td>
                  <td align="right">
                    <span style="color:#94A3B8;font-size:12px;">Forum Monitor</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding:24px;">
              <h1 style="font-size:22px;color:#1C2B36;margin:0 0 8px;font-family:Georgia,serif;font-weight:700;">
                ${posts.length} New Oklahoma Post${posts.length !== 1 ? 's' : ''}
              </h1>
              <p style="font-size:14px;color:#64748B;margin:0 0 20px;">
                ${dateStr} &mdash; from Mineral Rights Forum
              </p>

              <table width="100%" cellpadding="0" cellspacing="0">
                ${postRows}
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#F8FAFC;padding:16px 24px;border-top:1px solid #E2E8F0;">
              <p style="font-size:12px;color:#64748B;margin:0;text-align:center;">
                <a href="https://airtable.com/app3j3X29Uvp5stza" style="color:#2563EB;text-decoration:none;">View in Airtable</a>
                &bull;
                <a href="https://www.mineralrightsforum.com/c/oklahoma-mineral-rights/48" style="color:#2563EB;text-decoration:none;">Browse Forum</a>
              </p>
            </td>
          </tr>

          <!-- Copyright -->
          <tr>
            <td style="background:#1C2B36;padding:12px 24px;text-align:center;">
              <p style="color:#64748B;margin:0;font-size:11px;">&copy; ${new Date().getFullYear()} Mineral Watch Oklahoma</p>
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

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTimeAgo(date) {
  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
