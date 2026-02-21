import { COUNTIES, COUNTY_DETAILS, genericOverview, genericHero, UPPER_TO_SLUG } from './data';
import type { CountyStats, OperatorRow, ActivityItem, CountyIndexRow } from './queries';

// HTML entity escaping
function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function num(n: number): string {
  return n.toLocaleString('en-US');
}

function formatDate(dateStr: string): { month: string; day: string; year: string } {
  if (!dateStr) return { month: '', day: '', year: '' };
  const d = new Date(dateStr + 'T00:00:00Z');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return {
    month: months[d.getUTCMonth()] || '',
    day: String(d.getUTCDate()),
    year: String(d.getUTCFullYear()),
  };
}

// Add contextual links to guide pages (first occurrence of each phrase only, skip if inside <a>)
function addGuideLinks(html: string): string {
  const rules = [
    { pattern: /pooling orders?/gi, href: '/insights/guides/understanding-pooling-orders', key: 'pooling' },
    { pattern: /spacing (?:applications?|orders?)/gi, href: '/insights/guides/occ-filing-types', key: 'spacing' },
    { pattern: /increased density/gi, href: '/insights/guides/occ-filing-types', key: 'density' },
    { pattern: /division orders?/gi, href: '/insights/guides/division-orders-101', key: 'division' },
    { pattern: /20[- ]days?/gi, href: '/insights/guides/understanding-pooling-orders', key: '20day' },
    { pattern: /royalty checks?/gi, href: '/insights/guides/auditing-royalty-checks', key: 'royalty' },
  ];
  const linked = new Set<string>();
  for (const { pattern, href, key } of rules) {
    if (linked.has(key)) continue;
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(html)) !== null) {
      // Skip if inside an anchor tag
      const before = html.substring(0, m.index);
      const opens = (before.match(/<a[\s>]/g) || []).length;
      const closes = (before.match(/<\/a>/g) || []).length;
      if (opens > closes) continue;
      const link = `<a href="${href}" style="color:var(--red-dirt)">${m[0]}</a>`;
      html = html.substring(0, m.index) + link + html.substring(m.index + m[0].length);
      linked.add(key);
      break;
    }
  }
  return html;
}

const TYPE_CLASS: Record<string, string> = {
  permit: 'type-permit',
  completion: 'type-completion',
  pooling: 'type-pooling',
  spacing: 'type-spacing',
};
const TYPE_LABEL: Record<string, string> = {
  permit: 'Permit',
  completion: 'Completion',
  pooling: 'Pooling',
  spacing: 'Spacing',
};

// ─── Shared HTML fragments ───

const CSS = `
:root {
    --oil-navy: #1C2B36;
    --slate-blue: #334E68;
    --red-dirt: #C05621;
    --red-dirt-dark: #9C4215;
    --paper: #F8F9FA;
    --border: #E2E8F0;
    --success: #03543F;
    --success-bg: #DEF7EC;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Inter', sans-serif; line-height: 1.6; color: var(--oil-navy); background-color: #fff; }
h1, h2, h3, .logo { font-family: 'Merriweather', serif; }
.container { max-width: 1100px; margin: 0 auto; padding: 0 20px; }
.skip-nav { position: absolute; top: -100%; left: 16px; z-index: 10000; padding: 8px 16px; background: var(--oil-navy); color: #fff; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 0 0 4px 4px; }
.skip-nav:focus { top: 0; }
header { background: #fff; padding: 20px 0; border-bottom: 1px solid var(--border); }
.header-inner { display: flex; justify-content: space-between; align-items: center; }
.logo { font-size: 22px; font-weight: 900; color: var(--oil-navy); letter-spacing: -0.5px; text-decoration: none; }
.nav-links { display: flex; gap: 30px; align-items: center; }
.nav-links a { color: var(--slate-blue); text-decoration: none; font-weight: 500; font-size: 15px; transition: color 0.2s; }
.nav-links a:hover { color: var(--oil-navy); }
.nav-links a.active { color: var(--red-dirt); font-weight: 600; border-bottom: 2px solid var(--red-dirt); padding-bottom: 2px; }
.nav-links .btn-start { background: var(--red-dirt); color: white; padding: 10px 20px; border-radius: 4px; font-weight: 600; }
.nav-links .btn-start:hover { background: var(--red-dirt-dark); color: white; }
.nav-links .btn-login { color: var(--slate-blue); font-weight: 600; }
.nav-links .btn-login:hover { color: var(--oil-navy); }
.menu-toggle { display: none; background: none; border: none; cursor: pointer; padding: 8px; color: var(--oil-navy); }
.breadcrumb { padding: 16px 0; font-size: 13px; color: #596674; border-bottom: 1px solid var(--border); }
.breadcrumb a { color: var(--slate-blue); text-decoration: none; }
.breadcrumb a:hover { color: var(--oil-navy); text-decoration: underline; }
.breadcrumb span { margin: 0 8px; color: #CBD5E0; }
.county-hero { background: var(--oil-navy); padding: 60px 0; color: white; }
.county-hero-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 50px; align-items: center; }
.county-label { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; color: rgba(255,255,255,0.6); margin-bottom: 12px; }
.county-hero h1 { font-size: 40px; font-weight: 900; line-height: 1.2; margin-bottom: 16px; }
.county-hero h1 em { color: var(--red-dirt); font-style: normal; }
.county-hero-description { font-size: 17px; line-height: 1.7; color: rgba(255,255,255,0.85); margin-bottom: 28px; }
.hero-cta { display: inline-block; padding: 14px 28px; background: var(--red-dirt); color: white; border-radius: 4px; font-size: 15px; font-weight: 600; text-decoration: none; transition: background 0.2s; }
.hero-cta:hover { background: var(--red-dirt-dark); }
.county-stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.county-stat-card { background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.12); border-radius: 4px; padding: 24px; text-align: center; }
.county-stat-number { font-family: 'Merriweather', serif; font-size: 32px; font-weight: 900; color: #fff; line-height: 1.2; }
.county-stat-label { font-size: 12px; color: rgba(255,255,255,0.55); text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }
main { padding: 60px 0; }
.content-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 50px; }
.section-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 24px; padding-bottom: 12px; border-bottom: 2px solid var(--oil-navy); }
.section-header h2 { font-size: 22px; font-weight: 700; }
.section-header .view-all { font-size: 13px; color: var(--red-dirt); text-decoration: none; font-weight: 600; }
.section-header .view-all:hover { text-decoration: underline; }
.activity-feed { margin-bottom: 50px; }
.activity-item { display: grid; grid-template-columns: 70px 1fr auto; gap: 16px; align-items: start; padding: 20px 0; border-bottom: 1px solid var(--border); }
.activity-date { font-size: 12px; color: #596674; font-weight: 500; line-height: 1.4; }
.activity-date strong { display: block; font-size: 14px; color: var(--oil-navy); }
.activity-title { font-weight: 600; color: var(--oil-navy); font-size: 15px; margin-bottom: 4px; }
.activity-detail { font-size: 13px; color: #596674; line-height: 1.5; }
.activity-type { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; padding: 4px 10px; border-radius: 3px; white-space: nowrap; }
.type-permit { background: #EBF5FF; color: #1A56DB; }
.type-pooling { background: #FFF3E0; color: #C05621; }
.type-completion { background: var(--success-bg); color: var(--success); }
.type-spacing { background: #F3E8FF; color: #7C3AED; }
.operators-section { margin-bottom: 50px; }
.operators-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.operators-table th { text-align: left; padding: 10px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #596674; border-bottom: 2px solid var(--border); font-weight: 600; }
.operators-table td { padding: 12px; border-bottom: 1px solid var(--border); color: var(--oil-navy); }
.operators-table tr:hover { background: var(--paper); }
.operator-name { font-weight: 600; }
.operator-wells { font-family: 'Merriweather', serif; font-weight: 700; color: var(--red-dirt); }
.operator-filings { font-family: 'Merriweather', serif; font-weight: 700; color: var(--slate-blue); }
.operator-filings.quiet { color: #CBD5E0; font-weight: 400; }
.op-tabs { display: flex; gap: 0; margin-bottom: 0; }
.op-tab { padding: 8px 16px; font-size: 13px; font-weight: 600; color: #596674; background: none; border: 1px solid var(--border); border-bottom: none; cursor: pointer; transition: all 0.15s; }
.op-tab:first-child { border-radius: 4px 0 0 0; }
.op-tab:last-child { border-radius: 0 4px 0 0; border-left: none; }
.op-tab.active { color: var(--oil-navy); background: var(--paper); border-bottom: 2px solid var(--red-dirt); }
.op-tab:not(.active):hover { color: var(--oil-navy); background: #f1f5f9; }
.county-overview { margin-bottom: 50px; }
.county-overview h2 { font-size: 22px; margin-bottom: 16px; }
.county-overview p { color: #4A5568; font-size: 15px; line-height: 1.8; margin-bottom: 16px; }
.county-overview h3 { font-size: 17px; margin-top: 28px; margin-bottom: 10px; color: var(--oil-navy); }
.sidebar-card { background: var(--paper); border: 1px solid var(--border); border-radius: 4px; padding: 28px; margin-bottom: 24px; }
.sidebar-card h3 { font-size: 16px; margin-bottom: 16px; padding-bottom: 10px; border-bottom: 2px solid var(--red-dirt); }
.sidebar-cta { background: var(--oil-navy); color: white; border: none; border-top: 4px solid var(--red-dirt); }
.sidebar-cta h3 { color: white; border-bottom-color: rgba(255,255,255,0.2); }
.sidebar-cta p { color: rgba(255,255,255,0.8); font-size: 14px; line-height: 1.6; margin-bottom: 20px; }
.sidebar-cta .hero-cta { display: block; text-align: center; width: 100%; }
.quick-fact { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--border); font-size: 14px; }
.quick-fact:last-child { border-bottom: none; }
.quick-fact-label { color: #596674; }
.quick-fact-value { font-weight: 600; color: var(--oil-navy); }
.neighbor-links { display: flex; flex-wrap: wrap; gap: 8px; }
.neighbor-link { display: inline-block; padding: 6px 14px; background: white; border: 1px solid var(--border); border-radius: 3px; font-size: 13px; color: var(--slate-blue); text-decoration: none; font-weight: 500; transition: all 0.2s; }
.neighbor-link:hover { border-color: var(--red-dirt); color: var(--red-dirt); }
.bottom-cta { background: linear-gradient(135deg, var(--oil-navy) 0%, #2D4A5E 100%); padding: 60px 0; text-align: center; color: white; }
.bottom-cta h2 { font-size: 30px; margin-bottom: 12px; font-weight: 900; }
.bottom-cta p { font-size: 17px; color: rgba(255,255,255,0.8); margin-bottom: 28px; max-width: 550px; margin-left: auto; margin-right: auto; }
.site-footer { background: var(--oil-navy); color: #b0bec9; padding: 40px 0; font-size: 14px; }
.site-footer a { color: #b0bec9; text-decoration: none; }
.site-footer a:hover { color: white; }
.footer-inner { max-width: 1100px; margin: 0 auto; padding: 0 20px; display: flex; justify-content: space-between; align-items: start; gap: 48px; flex-wrap: wrap; }
.footer-brand { max-width: 300px; }
.footer-brand .logo { color: white; display: inline-block; margin-bottom: 12px; }
.footer-brand p { font-size: 14px; line-height: 1.6; }
.footer-links { display: flex; gap: 48px; }
.footer-col h4 { color: white; font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 14px; }
.footer-col a { display: block; font-size: 14px; color: #b0bec9; margin-bottom: 10px; transition: color 0.2s; }
.footer-col a:hover { color: white; }
.footer-bottom { max-width: 1100px; margin: 20px auto 0; padding: 20px 20px 0; border-top: 1px solid #2D3748; font-size: 13px; color: #94a3b8; }
.footer-bottom .copyright { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; }
.disclaimer { font-size: 11px; color: #94a3b8; line-height: 1.6; }
@media (max-width: 768px) {
    .menu-toggle { display: block; }
    .nav-links { display: none; position: absolute; top: 100%; left: 0; right: 0; background: #fff; flex-direction: column; padding: 20px; gap: 0; border-bottom: 1px solid var(--border); box-shadow: 0 4px 12px rgba(0,0,0,0.08); z-index: 1000; }
    .nav-links.open { display: flex; }
    .nav-links a { padding: 12px 0; border-bottom: 1px solid var(--border); font-size: 16px; }
    .nav-links a:last-child { border-bottom: none; }
    .nav-links .btn-start { text-align: center; margin-top: 8px; padding: 12px 20px; background: var(--red-dirt); color: white; border-radius: 4px; }
    .nav-links .btn-login { text-align: center; padding: 12px 0; }
    header { position: relative; z-index: 1000; }
    .county-hero-layout { grid-template-columns: 1fr; gap: 30px; }
    .county-hero h1 { font-size: 30px; }
    .content-grid { grid-template-columns: 1fr; }
    .activity-item { grid-template-columns: 60px 1fr; }
    .activity-type { grid-column: 2; justify-self: start; margin-top: 8px; }
    .county-stats-grid { grid-template-columns: 1fr 1fr; gap: 10px; }
    .county-stat-card { padding: 16px; }
    .county-stat-number { font-size: 24px; }
    .footer-inner { flex-direction: column; }
    .footer-links { gap: 32px; }
}
`;

const HEADER = `
<header>
    <div class="container">
        <div class="header-inner">
            <a href="/" class="logo">Mineral Watch</a>
            <button class="menu-toggle" aria-label="Menu">
                <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
            </button>
            <nav class="nav-links">
                <a href="/features">Features</a>
                <a href="/pricing">Pricing</a>
                <a href="/insights">Insights</a>
                <a href="/tools">Tools</a>

                <a href="/about">About</a>
                <a href="/contact">Contact</a>
                <a href="/demo">Demo</a>
                <a href="https://portal.mymineralwatch.com/portal/login?new=1" class="btn-start">Start Free</a>
                <a href="https://portal.mymineralwatch.com" class="btn-login">Sign In</a>
            </nav>
        </div>
    </div>
</header>`;

const FOOTER = `
<footer class="site-footer">
  <div class="footer-inner">
    <div class="footer-brand">
      <span class="logo">Mineral Watch</span>
      <p>Professional mineral rights monitoring and intelligence for Oklahoma mineral owners and operators.</p>
    </div>
    <div class="footer-links">
      <div class="footer-col">
        <h4>Platform</h4>
        <a href="https://mymineralwatch.com/features">Features</a>
        <a href="https://mymineralwatch.com/pricing">Pricing</a>
        <a href="https://mymineralwatch.com/insights">Insights</a>
        <a href="https://mymineralwatch.com/counties">Counties</a>
        <a href="https://mymineralwatch.com/tools/mineral-calculator">Tools</a>
        <a href="https://portal.mymineralwatch.com">Sign In</a>
      </div>
      <div class="footer-col">
        <h4>Company</h4>
        <a href="https://mymineralwatch.com/about">About</a>
        <a href="https://mymineralwatch.com/contact">Contact</a>
        <a href="https://mymineralwatch.com/demo">Book a Demo</a>
      </div>
      <div class="footer-col">
        <h4>Legal</h4>
        <a href="https://mymineralwatch.com/terms">Terms of Service</a>
        <a href="https://mymineralwatch.com/privacy">Privacy Policy</a>
      </div>
    </div>
  </div>
  <div class="footer-bottom">
    <div class="copyright">
      <span>&copy; 2026 Mineral Watch. Built by owners, for owners.</span>
      <span>Oklahoma City, OK</span>
    </div>
    <div class="disclaimer">
      <p><strong>Disclaimer:</strong> Mineral Watch is an automated monitoring tool provided for informational purposes only. We rely on public data from the Oklahoma Corporation Commission (OCC) and cannot guarantee the accuracy, completeness, or timeliness of this data. Government databases frequently contain errors, delays, or omissions. This service does not constitute legal, financial, or investment advice. Mineral Watch is not responsible for any missed deadlines, lost revenue, financial losses, or actions taken based on these alerts. Users should always verify official records directly with the OCC or a qualified attorney before making decisions.</p>
    </div>
  </div>
</footer>`;

const MENU_SCRIPT = `
<script>
document.querySelector('.menu-toggle').addEventListener('click', function() {
    document.querySelector('.nav-links').classList.toggle('open');
});
</script>`;

// ─── County Detail Page ───

export function renderCountyPage(
  slug: string,
  stats: CountyStats,
  operatorsByWells: OperatorRow[],
  operatorsByFilings: OperatorRow[],
  activity: ActivityItem[],
): string {
  const county = COUNTIES[slug];
  if (!county) return render404();

  const detail = COUNTY_DETAILS[slug];
  const countyName = county.name;
  const heroDesc = detail?.heroDescription ?? genericHero(countyName);
  let overviewHtml = addGuideLinks(detail?.overviewHtml ?? genericOverview(countyName));
  if (detail?.play && /SCOOP|STACK/i.test(detail.play)) {
    overviewHtml += `\n      <p>Learn more about what this means for your minerals in our <a href="/insights/guides/scoop-stack-overview" style="color:var(--red-dirt)">SCOOP &amp; STACK Play Overview</a>.</p>`;
  }

  // Build activity feed HTML
  let activityHtml = '';
  if (activity.length === 0) {
    activityHtml = '<p style="color:#596674;padding:20px 0;">No recent filings in the last 90 days.</p>';
  } else {
    for (const item of activity) {
      const d = formatDate(item.date);
      const cls = TYPE_CLASS[item.type] || 'type-permit';
      const label = TYPE_LABEL[item.type] || item.type;
      activityHtml += `
        <div class="activity-item">
            <div class="activity-date"><strong>${esc(d.month)} ${esc(d.day)}</strong>${esc(d.year)}</div>
            <div>
                <div class="activity-title">${esc(item.title)}</div>
                <div class="activity-detail">${esc(item.detail)}</div>
            </div>
            <span class="activity-type ${cls}">${label}</span>
        </div>`;
    }
  }

  // Build operators table with toggle tabs
  let operatorsHtml = '';
  if (operatorsByWells.length === 0 && operatorsByFilings.length === 0) {
    operatorsHtml = '<p style="color:#596674;padding:20px 0;">No active operators found.</p>';
  } else {
    const hasFilings = operatorsByFilings.length > 0;

    // Build "By Wells" tbody rows
    let wellsRows = '';
    for (const op of operatorsByWells) {
      const filingsCell = op.recent_filings > 0
        ? `<td class="operator-filings">${num(op.recent_filings)}</td>`
        : `<td class="operator-filings quiet">&mdash;</td>`;
      wellsRows += `
            <tr>
                <td class="operator-name">${esc(op.operator || 'Unknown')}</td>
                <td class="operator-wells">${num(op.active_wells)}</td>
                ${filingsCell}
            </tr>`;
    }

    // Build "By Filings" tbody rows
    let filingsRows = '';
    for (const op of operatorsByFilings) {
      const wellsCell = op.active_wells > 0
        ? `<td class="operator-wells">${num(op.active_wells)}</td>`
        : `<td class="operator-wells quiet">&mdash;</td>`;
      filingsRows += `
            <tr>
                <td class="operator-name">${esc(op.operator || 'Unknown')}</td>
                ${wellsCell}
                <td class="operator-filings">${num(op.recent_filings)}</td>
            </tr>`;
    }

    operatorsHtml = hasFilings ? `
      <div class="op-tabs">
          <button class="op-tab active" data-tab="wells">By Wells</button>
          <button class="op-tab" data-tab="filings">By Filings (90d)</button>
      </div>` : '';
    operatorsHtml += `
      <table class="operators-table">
          <thead><tr><th>Operator</th><th>Active Wells</th><th>Filings (90d)</th></tr></thead>
          <tbody id="op-tbody-wells">${wellsRows}</tbody>
          <tbody id="op-tbody-filings" style="display:none">${filingsRows}</tbody>
      </table>`;
  }

  // Sidebar: quick facts
  let quickFactsHtml = '';
  if (detail) {
    quickFactsHtml = `
      <div class="sidebar-card">
          <h3>${esc(countyName)} County Quick Facts</h3>
          <div class="quick-fact"><span class="quick-fact-label">County Seat</span><span class="quick-fact-value">${esc(detail.seat)}</span></div>
          <div class="quick-fact"><span class="quick-fact-label">Area</span><span class="quick-fact-value">${esc(detail.area)}</span></div>
          <div class="quick-fact"><span class="quick-fact-label">Primary Play</span><span class="quick-fact-value">${esc(detail.play)}</span></div>
          <div class="quick-fact"><span class="quick-fact-label">Key Formations</span><span class="quick-fact-value">${esc(detail.formations)}</span></div>
          <div class="quick-fact"><span class="quick-fact-label">Township Range</span><span class="quick-fact-value">${esc(detail.townshipRange)}</span></div>
          <div class="quick-fact"><span class="quick-fact-label">Courthouse</span><span class="quick-fact-value">${esc(detail.seat)}, OK</span></div>
      </div>`;
  }

  // Sidebar: neighboring counties
  let neighborsHtml = '';
  if (detail?.neighbors?.length) {
    const links = detail.neighbors
      .map(s => {
        const c = COUNTIES[s];
        return c ? `<a href="/counties/${s}" class="neighbor-link">${esc(c.name)}</a>` : '';
      })
      .filter(Boolean)
      .join('\n                            ');
    neighborsHtml = `
      <div class="sidebar-card">
          <h3>Neighboring Counties</h3>
          <div class="neighbor-links">${links}</div>
      </div>`;
  }

  // JSON-LD
  const geoJson = detail ? `,"about":{"@type":"Place","name":"${esc(countyName)} County, Oklahoma","geo":{"@type":"GeoCoordinates","latitude":${detail.latitude},"longitude":${detail.longitude}}}` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
    <title>${esc(countyName)} County Mineral Rights Intelligence | Mineral Watch</title>
    <meta name="description" content="OCC alerts, production data, document extraction, and interactive mapping for ${esc(countyName)} County, Oklahoma mineral rights owners.">
    <link rel="canonical" href="https://mymineralwatch.com/counties/${slug}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="https://mymineralwatch.com/counties/${slug}">
    <meta property="og:title" content="${esc(countyName)} County Mineral Rights Intelligence | Mineral Watch">
    <meta property="og:description" content="OCC alerts, production data, document extraction, and interactive mapping for ${esc(countyName)} County, Oklahoma mineral rights owners.">
    <meta property="og:image" content="https://mymineralwatch.com/assets/pooling-bonus-rates-by-township.png">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${esc(countyName)} County Mineral Rights Intelligence | Mineral Watch">
    <meta name="twitter:description" content="OCC alerts, production data, document extraction, and interactive mapping for ${esc(countyName)} County, Oklahoma mineral rights owners.">
    <meta name="twitter:image" content="https://mymineralwatch.com/assets/pooling-bonus-rates-by-township.png">
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"WebPage","name":"${esc(countyName)} County Mineral Rights Intelligence","description":"OCC alerts, production data, document extraction, and interactive mapping for ${esc(countyName)} County, Oklahoma mineral rights owners.","url":"https://mymineralwatch.com/counties/${slug}","publisher":{"@type":"Organization","name":"Mineral Watch","url":"https://mymineralwatch.com"}${geoJson}}
    </script>
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"https://mymineralwatch.com/"},{"@type":"ListItem","position":2,"name":"Counties","item":"https://mymineralwatch.com/counties/"},{"@type":"ListItem","position":3,"name":"${esc(countyName)} County","item":"https://mymineralwatch.com/counties/${slug}"}]}
    </script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:wght@400;700;900&display=swap" media="print" onload="this.media='all'">
    <noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:wght@400;700;900&display=swap"></noscript>
    <style>${CSS}</style>
</head>
<body>
<a href="#main-content" class="skip-nav">Skip to main content</a>
${HEADER}

    <div class="breadcrumb">
        <div class="container">
            <a href="/">Home</a><span>&rsaquo;</span><a href="/counties/">Counties</a><span>&rsaquo;</span>${esc(countyName)} County
        </div>
    </div>

    <section class="county-hero">
        <div class="container">
            <div class="county-hero-layout">
                <div>
                    <div class="county-label">Oklahoma County Profile</div>
                    <h1>${esc(countyName)} County, Oklahoma <em>Mineral</em> Intelligence</h1>
                    <p class="county-hero-description">${esc(heroDesc)}</p>
                    <a href="https://portal.mymineralwatch.com/" class="hero-cta">Start Free &rarr;</a>
                </div>
                <div class="county-stats-grid">
                    <div class="county-stat-card">
                        <div class="county-stat-number">${num(stats.activeWells)}</div>
                        <div class="county-stat-label">Active Wells</div>
                    </div>
                    <div class="county-stat-card">
                        <div class="county-stat-number">${num(stats.recentPooling)}</div>
                        <div class="county-stat-label">OCC Filings (90 days)</div>
                    </div>
                    <div class="county-stat-card">
                        <div class="county-stat-number">${num(stats.recentPermits)}</div>
                        <div class="county-stat-label">New Permits (90 days)</div>
                    </div>
                    <div class="county-stat-card">
                        <div class="county-stat-number">${num(stats.recentCompletions)}</div>
                        <div class="county-stat-label">Completions (90 days)</div>
                    </div>
                </div>
            </div>
        </div>
    </section>

    <main id="main-content">
        <div class="container">
            <div class="content-grid">
                <div>
                    <section class="activity-feed">
                        <div class="section-header">
                            <h2>Recent OCC Activity</h2>
                        </div>
                        ${activityHtml}
                    </section>

                    <section class="operators-section">
                        <div class="section-header">
                            <h2>Top Operators in ${esc(countyName)} County</h2>
                        </div>
                        ${operatorsHtml}
                    </section>

                    <section class="county-overview">
                        <h2>About ${esc(countyName)} County Mineral Rights</h2>
                        ${overviewHtml}
                    </section>
                </div>

                <aside>
                    <div class="sidebar-card sidebar-cta">
                        <h3>Your Mineral Command Center</h3>
                        <p>Pooling order data, production tracking, OCC alerts, AI document extraction, reports & analysis, and interactive mapping for your ${esc(countyName)} County minerals.</p>
                        <a href="https://portal.mymineralwatch.com/" class="hero-cta">Start Free &rarr;</a>
                    </div>
                    ${quickFactsHtml}
                    ${neighborsHtml}
                    <div class="sidebar-card">
                        <h3>Resources for Mineral Owners</h3>
                        <div style="font-size: 14px; line-height: 1.8;">
                            <p style="margin-bottom: 10px;"><a href="/features" style="color: var(--red-dirt); text-decoration: none; font-weight: 500;">See All Features &rarr;</a></p>
                            <p style="margin-bottom: 10px;"><a href="/pricing" style="color: var(--red-dirt); text-decoration: none; font-weight: 500;">View Pricing Plans &rarr;</a></p>
                            <p style="margin-bottom: 10px;"><a href="/contact" style="color: var(--red-dirt); text-decoration: none; font-weight: 500;">Contact Us &rarr;</a></p>
                        </div>
                        <h3 style="margin-top: 20px;">Related Guides</h3>
                        <div style="font-size: 14px; line-height: 1.8;">
                            <p style="margin-bottom: 10px;"><a href="/insights/guides/understanding-pooling-orders" style="color: var(--red-dirt); text-decoration: none; font-weight: 500;">Understanding Pooling Orders &rarr;</a></p>
                            <p style="margin-bottom: 10px;"><a href="/insights/guides/occ-filing-types" style="color: var(--red-dirt); text-decoration: none; font-weight: 500;">Every OCC Filing Type Explained &rarr;</a></p>
                            <p><a href="/insights/guides/auditing-royalty-checks" style="color: var(--red-dirt); text-decoration: none; font-weight: 500;">How to Audit Your Royalty Checks &rarr;</a></p>
                        </div>
                    </div>
                </aside>
            </div>
        </div>
    </main>

    <section class="bottom-cta">
        <div class="container">
            <h2>Your ${esc(countyName)} County Minerals Deserve Better</h2>
            <p>The complete mineral intelligence platform — OCC alerts, production data, document extraction, and portfolio management. Start with one property free.</p>
            <a href="https://portal.mymineralwatch.com/" class="hero-cta">Start Free &rarr;</a>
        </div>
    </section>

${FOOTER}
${MENU_SCRIPT}
<script>
(function(){
    var tabs = document.querySelectorAll('.op-tab');
    if (!tabs.length) return;
    tabs.forEach(function(tab) {
        tab.addEventListener('click', function() {
            var t = this.getAttribute('data-tab');
            tabs.forEach(function(b) { b.classList.remove('active'); });
            this.classList.add('active');
            document.getElementById('op-tbody-wells').style.display = t === 'wells' ? '' : 'none';
            document.getElementById('op-tbody-filings').style.display = t === 'filings' ? '' : 'none';
        });
    });
})();
</script>
</body>
</html>`;
}

// ─── County Index Page ───

const INDEX_CSS = `
.index-hero { background: var(--oil-navy); padding: 50px 0; color: white; text-align: center; }
.index-hero h1 { font-size: 36px; font-weight: 900; margin-bottom: 12px; }
.index-hero p { font-size: 17px; color: rgba(255,255,255,0.8); max-width: 600px; margin: 0 auto; }
.county-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; padding: 50px 0; }
.county-card { display: block; background: var(--paper); border: 1px solid var(--border); border-radius: 4px; padding: 20px; text-decoration: none; color: var(--oil-navy); transition: all 0.2s; }
.county-card:hover { border-color: var(--red-dirt); box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
.county-card-name { font-family: 'Merriweather', serif; font-weight: 700; font-size: 16px; margin-bottom: 8px; }
.county-card-stats { font-size: 13px; color: #596674; }
.county-card-stats strong { color: var(--red-dirt); }
`;

export function renderCountyIndex(counties: CountyIndexRow[]): string {
  let cardsHtml = '';
  for (const row of counties) {
    const slug = UPPER_TO_SLUG[row.county];
    if (!slug) continue;
    const info = COUNTIES[slug];
    if (!info) continue;
    cardsHtml += `
      <a href="/counties/${slug}" class="county-card">
          <div class="county-card-name">${esc(info.name)} County</div>
          <div class="county-card-stats"><strong>${num(row.active_wells)}</strong> active wells &middot; ${num(row.total_wells)} total</div>
      </a>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
    <title>Oklahoma County Mineral Rights Intelligence | Mineral Watch</title>
    <meta name="description" content="Browse all 77 Oklahoma counties. OCC alerts, production data, drilling permits, document extraction, and interactive mapping for mineral rights owners.">
    <link rel="canonical" href="https://mymineralwatch.com/counties/">
    <meta property="og:type" content="website">
    <meta property="og:url" content="https://mymineralwatch.com/counties/">
    <meta property="og:title" content="Oklahoma County Mineral Rights Intelligence | Mineral Watch">
    <meta property="og:description" content="Browse all 77 Oklahoma counties. OCC alerts, production data, drilling permits, and interactive mapping for mineral rights owners.">
    <meta property="og:image" content="https://mymineralwatch.com/assets/pooling-bonus-rates-by-township.png">
    <meta name="twitter:card" content="summary_large_image">
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"CollectionPage","name":"Oklahoma County Mineral Rights Intelligence","description":"Browse all 77 Oklahoma counties for mineral rights intelligence — OCC alerts, production data, and interactive mapping.","url":"https://mymineralwatch.com/counties/","publisher":{"@type":"Organization","name":"Mineral Watch","url":"https://mymineralwatch.com"}}
    </script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:wght@400;700;900&display=swap" media="print" onload="this.media='all'">
    <noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:wght@400;700;900&display=swap"></noscript>
    <style>${CSS}${INDEX_CSS}</style>
</head>
<body>
<a href="#main-content" class="skip-nav">Skip to main content</a>
${HEADER}

    <div class="breadcrumb">
        <div class="container">
            <a href="/">Home</a><span>&rsaquo;</span>Counties
        </div>
    </div>

    <section class="index-hero">
        <div class="container">
            <h1>Oklahoma County Mineral Rights</h1>
            <p>Browse mineral rights activity, drilling permits, OCC filings, and well data across all 77 Oklahoma counties.</p>
        </div>
    </section>

    <main id="main-content">
        <div class="container">
            <div class="county-grid">
                ${cardsHtml}
            </div>
        </div>
    </main>

    <section class="bottom-cta">
        <div class="container">
            <h2>Your Minerals Deserve Better</h2>
            <p>The complete mineral intelligence platform — OCC alerts, production data, document extraction, and portfolio management. Start with one property free.</p>
            <a href="https://portal.mymineralwatch.com/" class="hero-cta">Start Free &rarr;</a>
        </div>
    </section>

${FOOTER}
${MENU_SCRIPT}
</body>
</html>`;
}

// ─── 404 Page ───

export function render404(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
    <title>County Not Found | Mineral Watch</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:wght@400;700;900&display=swap" media="print" onload="this.media='all'">
    <noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:wght@400;700;900&display=swap"></noscript>
    <style>${CSS}</style>
</head>
<body>
<a href="#main-content" class="skip-nav">Skip to main content</a>
${HEADER}
    <main id="main-content" style="text-align:center;padding:80px 20px;">
        <h1 style="font-size:48px;margin-bottom:16px;">404</h1>
        <p style="font-size:18px;color:var(--slate-blue);margin-bottom:28px;">County not found. Browse all Oklahoma counties below.</p>
        <a href="/counties/" class="hero-cta">View All Counties &rarr;</a>
    </main>
${FOOTER}
${MENU_SCRIPT}
</body>
</html>`;
}
