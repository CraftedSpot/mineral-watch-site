export function renderCalculator(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
    <title>Oklahoma Mineral Calculator — NRI &amp; Royalties | Mineral Watch</title>
    <meta name="description" content="Free Oklahoma mineral calculator. Compute your NRI, estimate royalties, compare pooling elections, and verify division orders.">
    <link rel="canonical" href="https://mymineralwatch.com/tools/mineral-calculator">
    <meta property="og:type" content="website">
    <meta property="og:url" content="https://mymineralwatch.com/tools/mineral-calculator">
    <meta property="og:title" content="Oklahoma Mineral Calculator — NRI, Royalties, Pooling &amp; Valuation | Mineral Watch">
    <meta property="og:description" content="Free Oklahoma mineral calculator. Compute your NRI, estimate royalties, compare pooling elections, and verify division orders.">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="Oklahoma Mineral Calculator | Mineral Watch">
    <meta name="twitter:description" content="Free Oklahoma mineral calculator. Compute your NRI, estimate royalties, compare pooling elections, and verify division orders.">

    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      "name": "Oklahoma Mineral Calculator",
      "description": "Free mineral rights calculator for Oklahoma mineral owners. Calculate decimal interest, verify division orders, estimate royalties, compare pooling elections, and value minerals.",
      "url": "https://mymineralwatch.com/tools/mineral-calculator",
      "applicationCategory": "FinanceApplication",
      "operatingSystem": "Any",
      "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
      "publisher": { "@type": "Organization", "name": "Mineral Watch", "url": "https://mymineralwatch.com" }
    }
    </script>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://mymineralwatch.com/" },
        { "@type": "ListItem", "position": 2, "name": "Tools", "item": "https://mymineralwatch.com/tools" },
        { "@type": "ListItem", "position": 3, "name": "Mineral Calculator", "item": "https://mymineralwatch.com/tools/mineral-calculator" }
      ]
    }
    </script>

    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:wght@400;700;900&family=DM+Mono:wght@400;500&display=swap" media="print" onload="this.media='all'">
    <noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:wght@400;700;900&family=DM+Mono:wght@400;500&display=swap"></noscript>

    <style>
/* ── Shared site variables ── */
:root {
    --oil-navy: #1C2B36;
    --oil-navy-light: #243544;
    --slate-blue: #334E68;
    --slate-blue-mid: #486581;
    --red-dirt: #C05621;
    --red-dirt-dark: #9C4215;
    --red-dirt-light: #D4713B;
    --red-dirt-faded: rgba(192, 86, 33, 0.08);
    --paper: #F8F9FA;
    --border: #E2E8F0;
    --success: #2D6A4F;
    --success-bg: rgba(45, 106, 79, 0.08);
    --amber: #B45309;
    --amber-bg: rgba(180, 83, 9, 0.08);
    --danger: #C53030;
    --danger-bg: rgba(197, 48, 48, 0.06);
    --text-primary: #1C2B36;
    --text-secondary: #5A6C7A;
    --text-muted: #8B9DAB;
    --cream: #F5F3EF;
}

/* ── Base ── */
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Inter', sans-serif; line-height: 1.6; color: var(--oil-navy); background: #fff; }
h1, h2, h3, h4, .logo { font-family: 'Merriweather', serif; }
.container { max-width: 1100px; margin: 0 auto; padding: 0 20px; }
a { color: inherit; }
input::-webkit-outer-spin-button, input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
input[type=number] { -moz-appearance: textfield; }
::selection { background: rgba(192, 86, 33, 0.2); }

/* ── Header ── */
header { background: #fff; padding: 20px 0; border-bottom: 1px solid var(--border); }
.header-inner { display: flex; justify-content: space-between; align-items: center; }
.logo { font-size: 22px; font-weight: 900; color: var(--oil-navy); letter-spacing: -0.5px; text-decoration: none; display: inline-flex; align-items: center; gap: 8px; }
.logo svg { color: var(--red-dirt); }
.nav-links { display: flex; gap: 30px; align-items: center; }
.nav-links a { color: var(--slate-blue); text-decoration: none; font-weight: 500; font-size: 15px; transition: color 0.2s; }
.nav-links a:hover { color: var(--oil-navy); }
.nav-links a.active { color: var(--red-dirt); font-weight: 600; border-bottom: 2px solid var(--red-dirt); padding-bottom: 2px; }
.nav-links .btn-start { background: var(--red-dirt); color: white; padding: 10px 20px; border-radius: 4px; font-weight: 600; }
.nav-links .btn-start:hover { background: var(--red-dirt-dark); color: white; }
.nav-links .btn-login { color: var(--slate-blue); font-weight: 600; }
.nav-links .btn-login:hover { color: var(--oil-navy); }
.mobile-menu-btn { display: none; background: none; border: none; cursor: pointer; color: var(--oil-navy); }

/* ── Footer ── */
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

/* ── Hero ── */
.calc-hero {
    background: var(--oil-navy);
    padding: 40px 24px 0;
    text-align: center;
}
.calc-hero .eyebrow {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--red-dirt-light);
    margin-bottom: 10px;
}
.calc-hero h1 {
    font-size: clamp(26px, 4vw, 38px);
    font-weight: 700;
    color: #fff;
    line-height: 1.2;
    margin-bottom: 10px;
}
.calc-hero .subtitle {
    font-size: 15px;
    color: rgba(255,255,255,0.6);
    max-width: 520px;
    margin: 0 auto 28px;
    line-height: 1.5;
}

/* ── Tabs ── */
.calc-tabs {
    display: flex;
    gap: 2px;
    max-width: 900px;
    margin: 0 auto;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
}
.calc-tabs::-webkit-scrollbar { display: none; }
.calc-tab {
    flex: 1;
    min-width: 0;
    padding: 14px 10px 16px;
    background: rgba(255,255,255,0.06);
    border: none;
    border-radius: 8px 8px 0 0;
    color: rgba(255,255,255,0.55);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
    font-family: 'Inter', sans-serif;
}
.calc-tab:hover { background: rgba(255,255,255,0.10); }
.calc-tab.active {
    background: var(--paper);
    color: var(--red-dirt);
    font-weight: 700;
    border-radius: 10px 10px 0 0;
}
.calc-tab svg { transition: stroke 0.15s; }
.calc-tab .tab-label { font-size: 11px; line-height: 1.2; }

/* ── Calculator main ── */
.calc-main {
    max-width: 760px;
    margin: 0 auto;
    padding: 32px 24px 60px;
    background: var(--paper);
}
.calc-card {
    background: #fff;
    border-radius: 12px;
    border: 1px solid var(--border);
    padding: clamp(20px, 4vw, 36px);
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}
.calc-card h2 {
    font-size: 22px;
    font-weight: 700;
    color: var(--oil-navy);
    margin-bottom: 4px;
}
.accent-bar {
    height: 3px;
    width: 40px;
    background: var(--red-dirt);
    border-radius: 2px;
    margin-bottom: 20px;
}
.calc-panel { display: none; }
.calc-panel.active { display: block; }
.calc-intro {
    font-size: 14px;
    color: var(--text-secondary);
    line-height: 1.6;
    margin-bottom: 20px;
}

/* ── Inputs ── */
.field { margin-bottom: 16px; }
.field label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 6px;
    font-family: 'Merriweather', serif;
}
.field-wrap {
    position: relative;
    display: flex;
    align-items: center;
}
.field-wrap input {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 15px;
    font-family: 'DM Mono', 'SF Mono', monospace;
    color: var(--text-primary);
    background: #fff;
    outline: none;
    transition: border-color 0.2s;
}
.field-wrap input:focus { border-color: var(--red-dirt); }
.field-wrap .prefix {
    position: absolute;
    left: 12px;
    color: var(--text-muted);
    font-size: 14px;
    font-weight: 500;
    pointer-events: none;
}
.field-wrap .suffix {
    position: absolute;
    right: 12px;
    color: var(--text-muted);
    font-size: 13px;
    pointer-events: none;
}
.field-wrap input.has-prefix { padding-left: 28px; }
.field-wrap input.has-suffix { padding-right: 50px; }
.field .help {
    font-size: 12px;
    color: var(--text-muted);
    margin-top: 4px;
    line-height: 1.4;
}
.field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0 20px; }

/* ── Presets ── */
.presets { margin-bottom: 16px; }
.presets label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 6px;
    font-family: 'Merriweather', serif;
}
.preset-btns { display: flex; flex-wrap: wrap; gap: 6px; }
.preset-btn {
    padding: 7px 14px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: #fff;
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 400;
    cursor: pointer;
    transition: all 0.15s;
    font-family: 'DM Mono', 'SF Mono', monospace;
}
.preset-btn.active {
    border-color: var(--red-dirt);
    background: var(--red-dirt-faded);
    color: var(--red-dirt);
    font-weight: 600;
}
.presets .help { font-size: 12px; color: var(--text-muted); margin-top: 4px; line-height: 1.4; }

/* ── Formula box ── */
.formula-box {
    background: var(--cream);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 18px;
    margin-bottom: 20px;
    font-size: 13px;
    font-family: 'DM Mono', 'SF Mono', monospace;
    color: var(--text-secondary);
    line-height: 1.6;
}

/* ── Results ── */
.results { margin-top: 24px; }
.result-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
.result-box {
    padding: 20px 24px;
    border-radius: 10px;
    text-align: center;
    flex: 1;
    min-width: 140px;
}
.result-box .result-label {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 6px;
}
.result-box .result-value {
    font-size: 28px;
    font-weight: 700;
    font-family: 'DM Mono', 'SF Mono', monospace;
    letter-spacing: -0.02em;
}
.result-box .result-sub { font-size: 12px; margin-top: 4px; }

.result-box.primary { background: var(--oil-navy); }
.result-box.primary .result-label { color: rgba(255,255,255,0.7); }
.result-box.primary .result-value { color: #fff; }
.result-box.primary .result-sub { color: rgba(255,255,255,0.7); }

.result-box.success { background: var(--success-bg); }
.result-box.success .result-label { color: var(--text-secondary); }
.result-box.success .result-value { color: var(--success); }
.result-box.success .result-sub { color: var(--text-secondary); }

.result-box.warning { background: var(--amber-bg); }
.result-box.warning .result-label { color: var(--text-secondary); }
.result-box.warning .result-value { color: var(--amber); }
.result-box.warning .result-sub { color: var(--text-secondary); }

.result-box.danger { background: var(--danger-bg); }
.result-box.danger .result-label { color: var(--text-secondary); }
.result-box.danger .result-value { color: var(--danger); }
.result-box.danger .result-sub { color: var(--text-secondary); }

/* ── Note boxes ── */
.note {
    border-left: 3px solid var(--slate-blue);
    padding: 12px 16px;
    margin-bottom: 20px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-secondary);
    background: rgba(51,78,104,0.04);
    border-radius: 0 8px 8px 0;
}
.note.note-success { border-color: var(--success); background: var(--success-bg); }
.note.note-warning { border-color: var(--amber); background: var(--amber-bg); }

/* ── Pooling table ── */
.pooling-options { margin-top: 8px; margin-bottom: 16px; }
.pooling-row {
    display: grid;
    grid-template-columns: 80px 1fr 1fr 32px;
    gap: 10px;
    align-items: center;
    margin-bottom: 8px;
    padding: 10px 14px;
    background: #fff;
    border: 1px solid var(--border);
    border-radius: 8px;
}
.pooling-row .opt-label { font-size: 12px; font-weight: 600; color: var(--slate-blue); }
.pooling-row input {
    width: 100%;
    padding: 8px 8px 8px 22px;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 13px;
    font-family: 'DM Mono', monospace;
}
.pooling-row select {
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 13px;
    background: #fff;
    font-family: 'DM Mono', monospace;
}
.pooling-row .dollar-prefix {
    position: relative;
}
.pooling-row .dollar-prefix::before {
    content: '$';
    position: absolute;
    left: 8px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-muted);
    font-size: 13px;
    pointer-events: none;
}
.pooling-row .remove-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 16px;
    color: var(--text-muted);
    opacity: 0.5;
}
.pooling-row .remove-btn:hover { opacity: 1; }
.pooling-row .remove-btn:disabled { opacity: 0.15; cursor: default; }
.add-option-btn {
    padding: 8px 16px;
    border: 1px dashed var(--border);
    border-radius: 8px;
    background: none;
    color: var(--text-muted);
    font-size: 13px;
    cursor: pointer;
    width: 100%;
    margin-top: 4px;
    font-family: 'Inter', sans-serif;
}
.add-option-btn:hover { border-color: var(--text-muted); }
.comparison-table { width: 100%; border-collapse: collapse; font-size: 13px; overflow-x: auto; }
.comparison-table thead tr { background: var(--oil-navy); color: #fff; }
.comparison-table th { padding: 10px 14px; text-align: right; font-weight: 600; }
.comparison-table th:first-child { text-align: left; border-radius: 8px 0 0 0; }
.comparison-table th:last-child { border-radius: 0 8px 0 0; }
.comparison-table td { padding: 10px 14px; text-align: right; font-family: 'DM Mono', monospace; }
.comparison-table td:first-child { font-family: 'Inter', sans-serif; font-weight: 600; color: var(--slate-blue); }
.comparison-table td:first-child small { font-weight: 400; font-size: 12px; color: var(--text-muted); }
.comparison-table tr { border-bottom: 1px solid var(--border); }
.comparison-table tr:nth-child(even) { background: var(--cream); }

/* ── Value mode toggle ── */
.mode-toggle { display: flex; gap: 8px; margin-bottom: 24px; }
.mode-btn {
    flex: 1;
    padding: 12px 20px;
    border-radius: 8px;
    border: 2px solid var(--border);
    background: #fff;
    color: var(--text-secondary);
    font-weight: 400;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.15s;
    font-family: 'Inter', sans-serif;
}
.mode-btn.active {
    border-color: var(--red-dirt);
    background: var(--red-dirt-faded);
    color: var(--red-dirt);
    font-weight: 700;
}

/* ── Verify header ── */
.verify-do-box {
    padding: 16px 20px;
    background: var(--oil-navy);
    border-radius: 10px;
    margin-bottom: 24px;
}
.verify-do-box input {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 8px;
    font-size: 15px;
    font-family: 'DM Mono', monospace;
    color: #fff;
    background: rgba(255,255,255,0.08);
    outline: none;
}
.verify-do-box input:focus { border-color: var(--red-dirt); }
.verify-do-box input::placeholder { color: rgba(255,255,255,0.35); }
.verify-do-box .help { font-size: 12px; color: rgba(255,255,255,0.6); margin-top: 8px; text-align: center; }

/* ── Leased toggle ── */
.leased-toggle { display: flex; gap: 8px; }
.leased-btn {
    padding: 8px 24px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: #fff;
    color: var(--text-secondary);
    font-weight: 400;
    font-size: 14px;
    cursor: pointer;
    font-family: 'Inter', sans-serif;
}
.leased-btn.active {
    border-color: var(--red-dirt);
    background: var(--red-dirt-faded);
    color: var(--red-dirt);
    font-weight: 600;
}

/* ── CTA ── */
.calc-cta {
    margin-top: 32px;
    padding: 28px 32px;
    background: var(--oil-navy);
    border-radius: 12px;
    text-align: center;
}
.calc-cta h3 { font-size: 20px; color: #fff; font-weight: 700; margin-bottom: 8px; }
.calc-cta p { font-size: 14px; color: rgba(255,255,255,0.6); max-width: 480px; margin: 0 auto 20px; }
.calc-cta .cta-btn {
    display: inline-block;
    padding: 14px 36px;
    background: var(--red-dirt);
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s;
    text-decoration: none;
    font-family: 'Inter', sans-serif;
}
.calc-cta .cta-btn:hover { background: var(--red-dirt-light); }

.calc-disclaimer {
    font-size: 11px;
    color: var(--text-muted);
    text-align: center;
    margin-top: 24px;
    line-height: 1.5;
    max-width: 600px;
    margin-left: auto;
    margin-right: auto;
}

/* ── Live Price Indicator ── */
.live-price-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    font-weight: 500;
    color: var(--success);
    background: var(--success-bg);
    padding: 3px 10px;
    border-radius: 20px;
    margin-left: 4px;
    vertical-align: middle;
}
.live-price-badge .live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--success);
    animation: pulse-dot 2s infinite;
}
@keyframes pulse-dot {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
}
.live-price-badge.stale {
    color: var(--text-muted);
    background: rgba(0,0,0,0.04);
}
.live-price-badge.stale .live-dot {
    background: var(--text-muted);
    animation: none;
}
.price-source {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 2px;
}
.price-ticker {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 20px;
    margin-bottom: 24px;
    opacity: 0;
    transition: opacity 0.4s;
}
.price-ticker.loaded { opacity: 1; }
.price-ticker .ticker-item {
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(255,255,255,0.08);
    padding: 6px 16px;
    border-radius: 20px;
}
.price-ticker .ticker-label {
    font-size: 12px;
    color: rgba(255,255,255,0.5);
    font-weight: 500;
}
.price-ticker .ticker-value {
    font-size: 15px;
    color: #fff;
    font-weight: 700;
    font-family: 'DM Mono', monospace;
}
.price-ticker .ticker-date {
    font-size: 11px;
    color: rgba(255,255,255,0.4);
}
.price-ticker .live-dot-sm {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #48BB78;
    animation: pulse-dot 2s infinite;
}
.price-ticker .ticker-divider {
    width: 1px;
    height: 20px;
    background: rgba(255,255,255,0.15);
}

/* ── Responsive ── */
@media (max-width: 768px) {
    .mobile-menu-btn { display: block; }
    .nav-links {
        display: none; position: absolute; top: 100%; left: 0; right: 0;
        background: #fff; flex-direction: column; padding: 20px; gap: 16px;
        border-bottom: 1px solid var(--border); box-shadow: 0 8px 16px rgba(0,0,0,0.1); z-index: 100;
    }
    .nav-links.open { display: flex; }
    header { position: relative; }
    .footer-inner { flex-direction: column; }
    .footer-links { gap: 32px; }
    .field-row { grid-template-columns: 1fr; }
    .pooling-row { grid-template-columns: 60px 1fr 1fr 28px; gap: 6px; padding: 8px 10px; }
    .calc-tab { padding: 10px 6px 12px; min-width: 64px; }
    .calc-tab .tab-label { font-size: 10px; }
    .result-box .result-value { font-size: 22px; }
    .calc-main { padding: 24px 16px 48px; }
}
.skip-nav { position: absolute; top: -100%; left: 16px; z-index: 10000; padding: 8px 16px; background: #1C2B36; color: #fff; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 0 0 4px 4px; }
.skip-nav:focus { top: 0; }

/* ── Fraction Chain Steps ── */
.frac-step {
    display: grid; grid-template-columns: 32px 1fr 32px; gap: 10px; align-items: start;
    padding: 14px 16px; background: #fff; border: 1px solid var(--border);
    border-radius: 8px; margin-bottom: 8px; transition: border-color 0.15s;
}
.frac-step:hover { border-color: var(--slate-blue-mid); }
.frac-step-num {
    width: 28px; height: 28px; border-radius: 50%; background: var(--oil-navy); color: #fff;
    font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: center;
    font-family: 'DM Mono', monospace; flex-shrink: 0; margin-top: 2px;
}
.frac-step-body { min-width: 0; }
.frac-step-type {
    font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--text-muted); margin-bottom: 4px;
}
.frac-step-inputs { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.frac-step-inputs input, .frac-step-inputs select {
    padding: 7px 10px; border: 1px solid var(--border); border-radius: 6px;
    font-size: 13px; font-family: 'DM Mono', monospace; max-width: 140px; background: #fff;
}
.frac-step-inputs input:focus { border-color: var(--red-dirt); outline: none; }
.frac-step-inputs label { font-size: 12px; color: var(--text-secondary); font-weight: 500; }
.frac-step-result {
    margin-top: 8px; padding: 8px 12px; background: var(--cream); border-radius: 6px;
    font-size: 13px; font-family: 'DM Mono', monospace; color: var(--text-secondary);
    display: flex; gap: 16px; flex-wrap: wrap;
}
.frac-step-result .frac-val { color: var(--oil-navy); font-weight: 600; }
.frac-step .remove-btn {
    background: none; border: none; cursor: pointer; font-size: 16px;
    color: var(--text-muted); opacity: 0.4; margin-top: 2px;
}
.frac-step .remove-btn:hover { opacity: 1; color: var(--danger); }
.frac-arrow { text-align: center; color: var(--text-muted); font-size: 16px; margin: -2px 0; line-height: 1; }
.frac-add-wrap { position: relative; margin-top: 4px; }
.frac-step-menu {
    position: absolute; bottom: 100%; left: 0; right: 0; background: #fff;
    border: 1px solid var(--border); border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.12); z-index: 50; padding: 6px; margin-bottom: 6px;
}
.frac-menu-item {
    display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 14px;
    border: none; background: none; cursor: pointer; text-align: left; border-radius: 8px;
    font-family: 'Inter', sans-serif; font-size: 13px; color: var(--text-primary);
    transition: background 0.1s; line-height: 1.4;
}
.frac-menu-item:hover { background: var(--cream); }
.frac-menu-item small { color: var(--text-muted); font-size: 12px; }
.frac-menu-icon { width: 24px; text-align: center; display: flex; align-items: center; justify-content: center; }
.frac-menu-icon svg { width: 20px; height: 20px; stroke: var(--slate-blue-mid); fill: none; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
.frac-summary {
    margin-top: 24px; padding: 20px 24px; background: var(--oil-navy); border-radius: 12px; color: #fff;
}
.frac-summary-title {
    font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em;
    color: rgba(255,255,255,0.6); margin-bottom: 12px;
}
.frac-summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 16px; }
.frac-summary-item { text-align: center; }
.frac-summary-item .frac-sum-label { font-size: 11px; color: rgba(255,255,255,0.5); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; }
.frac-summary-item .frac-sum-value { font-size: 22px; font-weight: 700; font-family: 'DM Mono', monospace; }
.frac-summary-item .frac-sum-sub { font-size: 12px; color: rgba(255,255,255,0.5); margin-top: 2px; }
.frac-npri-line {
    margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.15);
    font-size: 13px; color: rgba(255,255,255,0.7);
}
.frac-npri-line strong { color: #fff; }
@media (max-width: 768px) {
    .frac-step { grid-template-columns: 28px 1fr 28px; gap: 8px; padding: 12px; }
    .frac-step-inputs { flex-direction: column; gap: 6px; }
    .frac-step-inputs input { max-width: 100%; }
    .frac-step-result { flex-direction: column; gap: 4px; }
    .frac-step-menu { position: fixed; bottom: 0; left: 0; right: 0; border-radius: 16px 16px 0 0; margin-bottom: 0; max-height: 60vh; overflow-y: auto; }
    .frac-summary-item .frac-sum-value { font-size: 18px; }
}
    </style>
</head>
<body>
    <a href="#main-content" class="skip-nav">Skip to main content</a>

<!-- ── Header ── -->
<header>
    <div class="container">
        <div class="header-inner">
            <a href="/" class="logo">Mineral Watch</a>
            <button class="mobile-menu-btn" onclick="document.querySelector('.nav-links').classList.toggle('open')" aria-label="Menu">
                <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
            </button>
            <nav class="nav-links">
                <a href="/features">Features</a>
                <a href="/pricing">Pricing</a>
                <a href="/insights">Insights</a>
                <a href="/counties">Counties</a>
                <a href="/tools" class="active">Tools</a>
                <a href="/about">About</a>
                <a href="/contact">Contact</a>
                <a href="/demo">Demo</a>
                <a href="https://portal.mymineralwatch.com/portal/login?new=1" class="btn-start">Start Free</a>
                <a href="https://portal.mymineralwatch.com" class="btn-login">Sign In</a>
            </nav>
        </div>
    </div>
</header>

<!-- ── Hero + Tabs ── -->
<div class="calc-hero" id="main-content">
    <div class="eyebrow">Mineral Watch Tools</div>
    <h1>Oklahoma Mineral Calculator</h1>
    <p class="subtitle">Six tools in one. Calculate your decimal, verify division orders, estimate royalties, compare pooling elections, value your minerals, and trace your interest chain.</p>

    <div class="price-ticker" id="hero-ticker">
        <div class="ticker-item">
            <span class="live-dot-sm"></span>
            <span class="ticker-label">WTI Crude</span>
            <span class="ticker-value" id="ticker-oil">--</span>
            <span class="ticker-date" id="ticker-oil-date"></span>
        </div>
        <div class="ticker-divider"></div>
        <div class="ticker-item">
            <span class="live-dot-sm"></span>
            <span class="ticker-label">Henry Hub</span>
            <span class="ticker-value" id="ticker-gas">--</span>
            <span class="ticker-date" id="ticker-gas-date"></span>
        </div>
    </div>

    <div class="calc-tabs">
        <button class="calc-tab active" data-tab="decimal" onclick="switchTab('decimal')">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="20" x2="20" y2="4"/><circle cx="7" cy="7" r="3"/><circle cx="17" cy="17" r="3"/></svg>
            <span class="tab-label">NRI Calculator</span>
        </button>
        <button class="calc-tab" data-tab="verify" onclick="switchTab('verify')">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
            <span class="tab-label">Verify D.O.</span>
        </button>
        <button class="calc-tab" data-tab="royalties" onclick="switchTab('royalties')">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
            <span class="tab-label">Royalties</span>
        </button>
        <button class="calc-tab" data-tab="pooling" onclick="switchTab('pooling')">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/></svg>
            <span class="tab-label">Pooling</span>
        </button>
        <button class="calc-tab" data-tab="value" onclick="switchTab('value')">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>
            <span class="tab-label">Valuation</span>
        </button>
        <button class="calc-tab" data-tab="fraction" onclick="switchTab('fraction')">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            <span class="tab-label">Interest Chain</span>
        </button>
    </div>
</div>

<!-- ── Calculator Body ── -->
<div class="calc-main">
    <div class="calc-card">

<!-- ═══════════════ NRI CALCULATOR ═══════════════ -->
<div class="calc-panel active" id="panel-decimal">
    <h2>What's My Decimal?</h2>
    <div class="accent-bar"></div>
    <p class="calc-intro">Calculate your expected decimal interest (NRI) for a division order. Enter your ownership details and we'll show you what your decimal should be.</p>
    <div class="formula-box">NRI = (Acres Owned &times; Mineral Interest &times; Royalty Rate) &divide; Unit Size &times; Section Allocation %</div>

    <div class="field-row">
        <div class="field">
            <label>Acres Owned (Gross)</label>
            <div class="field-wrap"><input type="number" id="d-acres" placeholder="e.g. 160" min="0" step="any" class="has-suffix" oninput="calcDecimal()"><span class="suffix">acres</span></div>
            <div class="help">Your total surface/gross acres in this section</div>
        </div>
        <div class="field">
            <label>Mineral Interest Fraction</label>
            <div class="field-wrap"><input type="number" id="d-mi" value="1.0" placeholder="1.0" min="0" step="0.01" oninput="calcDecimal()"></div>
            <div class="help">1.0 = full mineral interest, 0.5 = half, etc.</div>
        </div>
    </div>

    <div class="presets">
        <label>Unit Size</label>
        <div class="preset-btns" id="d-unit-presets">
            <button class="preset-btn active" onclick="setDUnit(640)">640 acres (Standard)</button>
            <button class="preset-btn" onclick="setDUnit(1280)">1,280 acres (Two-section)</button>
            <button class="preset-btn" onclick="setDUnit(null)">Custom</button>
        </div>
        <div class="help">From the OCC spacing or pooling order</div>
    </div>
    <div class="field" id="d-custom-unit-wrap" style="display:none;">
        <label>Custom Unit Size</label>
        <div class="field-wrap"><input type="number" id="d-custom-unit" placeholder="e.g. 960" min="0" step="any" class="has-suffix" oninput="calcDecimal()"><span class="suffix">acres</span></div>
    </div>

    <div class="presets">
        <label>Royalty Rate</label>
        <div class="preset-btns" id="d-royalty-presets">
            <button class="preset-btn" onclick="setDRoyalty(0.125)">1/8 (12.5%)</button>
            <button class="preset-btn active" onclick="setDRoyalty(0.1875)">3/16 (18.75%)</button>
            <button class="preset-btn" onclick="setDRoyalty(0.20)">1/5 (20%)</button>
            <button class="preset-btn" onclick="setDRoyalty(0.25)">1/4 (25%)</button>
        </div>
        <div class="help">From your lease agreement</div>
    </div>

    <div class="field">
        <label>Section Allocation % (optional)</label>
        <div class="field-wrap"><input type="number" id="d-allocation" placeholder="e.g. 52.3" min="0" max="100" step="any" class="has-suffix" oninput="calcDecimal()"><span class="suffix">%</span></div>
        <div class="help">For multi-section horizontal wells &mdash; the % of production allocated to your section. Leave blank for vertical wells or single-section units.</div>
    </div>

    <div id="d-results"></div>
</div>

<!-- ═══════════════ VERIFY D.O. ═══════════════ -->
<div class="calc-panel" id="panel-verify">
    <h2>Check My Division Order</h2>
    <div class="accent-bar"></div>
    <p class="calc-intro">Enter the decimal from your division order, then your ownership details. We'll verify whether the math checks out &mdash; or flag a discrepancy.</p>

    <div class="verify-do-box">
        <input type="number" id="v-do-decimal" placeholder="e.g. 0.00357891" step="0.00000001" min="0" oninput="calcVerify()">
        <div class="help">Enter the decimal interest from your division order or check stub</div>
    </div>

    <div class="field-row">
        <div class="field">
            <label>Acres Owned (Gross)</label>
            <div class="field-wrap"><input type="number" id="v-acres" placeholder="e.g. 160" min="0" step="any" class="has-suffix" oninput="calcVerify()"><span class="suffix">acres</span></div>
        </div>
        <div class="field">
            <label>Mineral Interest Fraction</label>
            <div class="field-wrap"><input type="number" id="v-mi" value="1.0" placeholder="1.0" min="0" step="0.01" oninput="calcVerify()"></div>
        </div>
    </div>

    <div class="presets">
        <label>Unit Size</label>
        <div class="preset-btns" id="v-unit-presets">
            <button class="preset-btn active" onclick="setVUnit(640)">640 acres (Standard)</button>
            <button class="preset-btn" onclick="setVUnit(1280)">1,280 acres (Two-section)</button>
            <button class="preset-btn" onclick="setVUnit(null)">Custom</button>
        </div>
    </div>
    <div class="field" id="v-custom-unit-wrap" style="display:none;">
        <label>Custom Unit Size</label>
        <div class="field-wrap"><input type="number" id="v-custom-unit" placeholder="e.g. 960" min="0" step="any" class="has-suffix" oninput="calcVerify()"><span class="suffix">acres</span></div>
    </div>

    <div class="presets">
        <label>Royalty Rate</label>
        <div class="preset-btns" id="v-royalty-presets">
            <button class="preset-btn" onclick="setVRoyalty(0.125)">1/8 (12.5%)</button>
            <button class="preset-btn active" onclick="setVRoyalty(0.1875)">3/16 (18.75%)</button>
            <button class="preset-btn" onclick="setVRoyalty(0.20)">1/5 (20%)</button>
            <button class="preset-btn" onclick="setVRoyalty(0.25)">1/4 (25%)</button>
        </div>
    </div>

    <div class="field">
        <label>Section Allocation % (optional)</label>
        <div class="field-wrap"><input type="number" id="v-allocation" placeholder="e.g. 52.3" min="0" max="100" step="any" class="has-suffix" oninput="calcVerify()"><span class="suffix">%</span></div>
    </div>

    <div id="v-results"></div>
</div>

<!-- ═══════════════ ROYALTIES ═══════════════ -->
<div class="calc-panel" id="panel-royalties">
    <h2>Estimate My Royalties</h2>
    <div class="accent-bar"></div>
    <p class="calc-intro">Estimate your monthly and annual royalty income from a producing well. Use your decimal interest from a division order and current or expected production volumes.</p>
    <div class="formula-box">Monthly Royalty = (Oil BBL &times; Oil Price + Gas MCF &times; Gas Price) &times; Your Decimal &times; (1 &minus; Deductions)</div>

    <div class="field">
        <label>Your Decimal Interest (NRI)</label>
        <div class="field-wrap"><input type="number" id="r-decimal" placeholder="e.g. 0.00357891" step="0.00000001" min="0" oninput="calcRoyalties()"></div>
        <div class="help">From your division order or use the NRI Calculator tab</div>
    </div>

    <div class="field-row">
        <div class="field">
            <label>Monthly Oil Production</label>
            <div class="field-wrap"><input type="number" id="r-oil-bbl" placeholder="e.g. 8500" min="0" step="any" class="has-suffix" oninput="calcRoyalties()"><span class="suffix">BBL</span></div>
            <div class="help">Barrels of oil per month</div>
        </div>
        <div class="field">
            <label>Monthly Gas Production</label>
            <div class="field-wrap"><input type="number" id="r-gas-mcf" placeholder="e.g. 25000" min="0" step="any" class="has-suffix" oninput="calcRoyalties()"><span class="suffix">MCF</span></div>
            <div class="help">Thousand cubic feet per month</div>
        </div>
    </div>
    <div class="field-row">
        <div class="field">
            <label>Oil Price</label>
            <div class="field-wrap"><span class="prefix">$</span><input type="number" id="r-oil-price" value="68" min="0" step="any" class="has-prefix has-suffix" oninput="calcRoyalties()"><span class="suffix">/BBL</span></div>
            <div class="help" id="r-oil-price-help">Current WTI spot price</div>
        </div>
        <div class="field">
            <label>Gas Price</label>
            <div class="field-wrap"><span class="prefix">$</span><input type="number" id="r-gas-price" value="3.25" min="0" step="any" class="has-prefix has-suffix" oninput="calcRoyalties()"><span class="suffix">/MCF</span></div>
            <div class="help" id="r-gas-price-help">Current Henry Hub spot price</div>
        </div>
    </div>

    <div class="field">
        <label>Post-Production Deductions (optional)</label>
        <div class="field-wrap"><input type="number" id="r-deductions" placeholder="e.g. 15" min="0" max="100" step="any" class="has-suffix" oninput="calcRoyalties()"><span class="suffix">%</span></div>
        <div class="help">Gathering, transportation, processing fees. Oklahoma lease language governs whether deductions apply.</div>
    </div>

    <div id="r-results"></div>
</div>

<!-- ═══════════════ POOLING ═══════════════ -->
<div class="calc-panel" id="panel-pooling">
    <h2>Compare Pooling Elections</h2>
    <div class="accent-bar"></div>
    <p class="calc-intro">Compare pooling election options side-by-side. Enter the options from your pooling order to see the break-even point between taking a higher bonus vs. a higher royalty rate.</p>

    <div class="field-row">
        <div class="field">
            <label>Your Net Mineral Acres</label>
            <div class="field-wrap"><input type="number" id="p-nma" placeholder="e.g. 10" min="0" step="any" class="has-suffix" oninput="calcPooling()"><span class="suffix">NMA</span></div>
        </div>
        <div class="presets">
            <label>Unit Size</label>
            <div class="preset-btns" id="p-unit-presets">
                <button class="preset-btn active" onclick="setPUnit(640)">640 acres (Standard)</button>
                <button class="preset-btn" onclick="setPUnit(1280)">1,280 acres (Two-section)</button>
                <button class="preset-btn" onclick="setPUnit(null)">Custom</button>
            </div>
        </div>
    </div>
    <div class="field" id="p-custom-unit-wrap" style="display:none;">
        <label>Custom Unit Size</label>
        <div class="field-wrap"><input type="number" id="p-custom-unit" placeholder="e.g. 960" min="0" step="any" class="has-suffix" oninput="calcPooling()"><span class="suffix">acres</span></div>
    </div>

    <div class="pooling-options">
        <label style="display:block;font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:10px;font-family:'Merriweather',serif;">Pooling Election Options</label>
        <div id="p-options-list"></div>
        <button class="add-option-btn" id="p-add-btn" onclick="addPoolingOption()">+ Add Option</button>
    </div>

    <div class="field-row">
        <div class="field">
            <label>Est. Monthly Oil Production (Well)</label>
            <div class="field-wrap"><input type="number" id="p-oil-prod" value="8000" min="0" step="any" class="has-suffix" oninput="calcPooling()"><span class="suffix">BBL</span></div>
            <div class="help">Total well oil production &mdash; your share is based on your decimal</div>
        </div>
        <div class="field">
            <label>Oil Price</label>
            <div class="field-wrap"><span class="prefix">$</span><input type="number" id="p-oil-price" value="68" min="0" step="any" class="has-prefix has-suffix" oninput="calcPooling()"><span class="suffix">/BBL</span></div>
            <div class="help" id="p-oil-price-help"></div>
        </div>
    </div>
    <div class="field-row">
        <div class="field">
            <label>Est. Monthly Gas Production (Well)</label>
            <div class="field-wrap"><input type="number" id="p-gas-prod" value="25000" min="0" step="any" class="has-suffix" oninput="calcPooling()"><span class="suffix">MCF</span></div>
            <div class="help">Total well gas production &mdash; your share is based on your decimal</div>
        </div>
        <div class="field">
            <label>Gas Price</label>
            <div class="field-wrap"><span class="prefix">$</span><input type="number" id="p-gas-price" value="3.25" min="0" step="any" class="has-prefix has-suffix" oninput="calcPooling()"><span class="suffix">/MCF</span></div>
            <div class="help" id="p-gas-price-help"></div>
        </div>
    </div>

    <div id="p-results"></div>
</div>

<!-- ═══════════════ VALUATION ═══════════════ -->
<div class="calc-panel" id="panel-value">
    <h2>What Are My Minerals Worth?</h2>
    <div class="accent-bar"></div>
    <p class="calc-intro">Estimate the market value of your mineral rights. Choose producing or non-producing for different valuation methods.</p>

    <div class="mode-toggle">
        <button class="mode-btn active" id="val-mode-prod" onclick="setValMode('producing')">Currently Producing</button>
        <button class="mode-btn" id="val-mode-nonprod" onclick="setValMode('nonproducing')">Non-Producing</button>
    </div>

    <div id="val-producing">
        <div class="field">
            <label>Average Monthly Royalty Income</label>
            <div class="field-wrap"><span class="prefix">$</span><input type="number" id="val-monthly" placeholder="e.g. 850" min="0" step="any" class="has-prefix" oninput="calcValue()"></div>
            <div class="help">Use the average of your last 3&ndash;6 royalty checks, not a single peak month. New wells decline sharply in year one (often 60&ndash;70%), so recent checks may overstate long-term income. A stabilized average gives a more accurate valuation basis.</div>
        </div>
        <div id="val-prod-results"></div>
    </div>

    <div id="val-nonproducing" style="display:none;">
        <div class="field">
            <label>Net Mineral Acres (NMA)</label>
            <div class="field-wrap"><input type="number" id="val-nma" placeholder="e.g. 40" min="0" step="any" class="has-suffix" oninput="calcValue()"><span class="suffix">NMA</span></div>
        </div>
        <div class="field">
            <label>Currently Leased?</label>
            <div class="leased-toggle">
                <button class="leased-btn" id="val-leased-yes" onclick="setLeased(true)">Yes</button>
                <button class="leased-btn" id="val-leased-no" onclick="setLeased(false)">No</button>
            </div>
        </div>
        <div class="field" id="val-bonus-wrap" style="display:none;">
            <label>Lease Bonus Received (Total)</label>
            <div class="field-wrap"><span class="prefix">$</span><input type="number" id="val-bonus" placeholder="e.g. 15000" min="0" step="any" class="has-prefix" oninput="calcValue()"></div>
            <div class="help">Total bonus payment from your lease</div>
        </div>
        <div id="val-nonprod-results"></div>
    </div>
</div>

<!-- ═══════════════ INTEREST CHAIN ═══════════════ -->
<div class="calc-panel" id="panel-fraction">
    <h2>Trace My Mineral Interest</h2>
    <div class="accent-bar"></div>
    <p class="calc-intro">Build a step-by-step chain from original ownership to your current interest. Add inheritance, conveyances, NPRI reservations, leases, and pooling to trace your decimal.</p>
    <div class="formula-box">Start with total tract acres and your initial mineral interest, then add each transaction in order.</div>

    <div class="field-row">
        <div class="field">
            <label>Total Tract Acres</label>
            <div class="field-wrap"><input type="number" id="fc-acres" placeholder="e.g. 640" min="0" step="any" class="has-suffix" oninput="calcFraction()"><span class="suffix">acres</span></div>
            <div class="help">The total acreage of the original tract (often a full section = 640)</div>
        </div>
        <div class="field">
            <label>Starting Mineral Interest</label>
            <div class="field-wrap"><input type="text" id="fc-start-mi" placeholder="e.g. 1/2 or 0.5" oninput="calcFraction()"></div>
            <div class="help">Accepts fractions (1/2, 3/16) or decimals (0.5, 0.1875)</div>
        </div>
    </div>

    <div id="fc-steps"></div>

    <div class="frac-add-wrap">
        <div class="frac-step-menu" id="fc-menu" style="display:none;">
            <button class="frac-menu-item" onclick="addFracStep('inheritance')"><span class="frac-menu-icon"><svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg></span><div>Inheritance / Probate<br><small>Divide among heirs</small></div></button>
            <button class="frac-menu-item" onclick="addFracStep('conveyance')"><span class="frac-menu-icon"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15l3 3 3-3"/></svg></span><div>Conveyance / Deed<br><small>Multiply by fraction conveyed</small></div></button>
            <button class="frac-menu-item" onclick="addFracStep('royalty')"><span class="frac-menu-icon"><svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span><div>Retained Royalty (NPRI)<br><small>Carve out burden on lease royalty</small></div></button>
            <button class="frac-menu-item" onclick="addFracStep('lease')"><span class="frac-menu-icon"><svg viewBox="0 0 24 24"><path d="M12 2l1 7h4l-3.5 5L15 21l-3-2.5L9 21l1.5-7L7 9h4z"/><line x1="12" y1="2" x2="12" y2="22"/><path d="M7 22h10"/></svg></span><div>Oil &amp; Gas Lease<br><small>Apply royalty rate</small></div></button>
            <button class="frac-menu-item" onclick="addFracStep('pooling')"><span class="frac-menu-icon"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></span><div>Pooling / Allocation<br><small>Multiply by allocation %</small></div></button>
        </div>
        <button class="add-option-btn" id="fc-add-btn" onclick="toggleFracMenu()" style="width:100%;margin-top:4px;">+ Add Step</button>
    </div>

    <div style="margin-top:12px;text-align:right;">
        <button onclick="resetFracChain()" style="background:none;border:none;cursor:pointer;font-size:13px;color:var(--text-muted);text-decoration:underline;">Reset All</button>
    </div>

    <div id="fc-summary"></div>

    <div class="note" style="margin-top:16px;">
        <strong>Cross-reference your work:</strong> Use the <a href="#" onclick="switchTab('decimal');return false;" style="color:var(--red-dirt);font-weight:600;">NRI Calculator</a> to verify your final decimal, or <a href="#" onclick="switchTab('verify');return false;" style="color:var(--red-dirt);font-weight:600;">Verify D.O.</a> to compare against your division order.
    </div>
</div>

    </div><!-- /.calc-card -->

    <!-- CTA -->
    <div class="calc-cta">
        <h3>Want This Automated for Your Entire Portfolio?</h3>
        <p>Mineral Watch automatically tracks your decimals, monitors production, and alerts you when activity affects your properties.</p>
        <a href="https://portal.mymineralwatch.com" class="cta-btn">Start Free &mdash; Track 1 Property</a>
    </div>

    <!-- Disclaimer -->
    <p class="calc-disclaimer">This calculator is provided for informational purposes only and does not constitute legal or financial advice. Results are estimates based on the inputs you provide. Always verify with official documents, your operator, or a qualified attorney before making decisions about your mineral interests.</p>
</div><!-- /.calc-main -->

<!-- ── Footer ── -->
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
      <div class="footer-col">
        <h4>Popular Counties</h4>
        <a href="/counties/canadian-county">Canadian</a>
        <a href="/counties/grady-county">Grady</a>
        <a href="/counties/blaine-county">Blaine</a>
        <a href="/counties/kingfisher-county">Kingfisher</a>
        <a href="/counties/caddo-county">Caddo</a>
        <a href="/counties/garfield-county">Garfield</a>
        <a href="/counties/stephens-county">Stephens</a>
        <a href="/counties/carter-county">Carter</a>
        <a href="/counties/custer-county">Custer</a>
        <a href="/counties/woodward-county">Woodward</a>
        <a href="/counties/mcclain-county">McClain</a>
        <a href="/counties/beckham-county">Beckham</a>
        <a href="/counties/dewey-county">Dewey</a>
        <a href="/counties/roger-mills-county">Roger Mills</a>
        <a href="/counties/major-county">Major</a>
      </div>
    </div>
  </div>
  <div class="footer-bottom">
    <div class="copyright">
      <span>&copy; ${new Date().getFullYear()} Mineral Watch. Built by owners, for owners.</span>
      <span>Oklahoma City, OK</span>
    </div>
    <div class="disclaimer">
      <p><strong>Disclaimer:</strong> Mineral Watch is an automated monitoring tool provided for informational purposes only. We rely on public data from the Oklahoma Corporation Commission (OCC) and cannot guarantee the accuracy, completeness, or timeliness of this data. Government databases frequently contain errors, delays, or omissions. This service does not constitute legal, financial, or investment advice. Mineral Watch is not responsible for any missed deadlines, lost revenue, financial losses, or actions taken based on these alerts. Users should always verify official records directly with the OCC or a qualified attorney before making decisions.</p>
    </div>
  </div>
</footer>

<!-- ── Mobile menu ── -->
<script>
document.addEventListener('click', function(e) {
    var nav = document.querySelector('.nav-links');
    var btn = document.querySelector('.mobile-menu-btn');
    if (nav && btn && !nav.contains(e.target) && !btn.contains(e.target)) {
        nav.classList.remove('open');
    }
});
</script>

<!-- ══════════════════════════════════════════════
     CALCULATOR LOGIC
     ══════════════════════════════════════════════ -->
<script>
(function() {
    'use strict';

    // ── Helpers ──
    function num(id) {
        var el = typeof id === 'string' ? document.getElementById(id) : id;
        if (!el) return 0;
        var v = parseFloat(el.value);
        return isNaN(v) ? 0 : v;
    }
    function fmt(n, decimals) { return n.toFixed(decimals); }
    function dollar(n) { return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function dollarInt(n) { return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 }); }
    function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    function resultBox(label, value, sub, variant) {
        return '<div class="result-box ' + (variant || 'primary') + '">' +
            '<div class="result-label">' + label + '</div>' +
            '<div class="result-value">' + value + '</div>' +
            (sub ? '<div class="result-sub">' + sub + '</div>' : '') +
            '</div>';
    }
    function note(text, variant) {
        return '<div class="note' + (variant ? ' note-' + variant : '') + '">' + text + '</div>';
    }

    // ══════════════════════════════
    //  TAB SWITCHING
    // ══════════════════════════════
    window.switchTab = function(tabId) {
        // Update tab buttons
        document.querySelectorAll('.calc-tab').forEach(function(btn) {
            btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
            // Update SVG stroke color
            var svg = btn.querySelector('svg');
            if (svg) svg.style.stroke = btn.classList.contains('active') ? 'var(--red-dirt)' : 'rgba(255,255,255,0.45)';
        });
        // Update panels
        document.querySelectorAll('.calc-panel').forEach(function(panel) {
            panel.classList.toggle('active', panel.id === 'panel-' + tabId);
        });
        // Update card title
        var titles = { decimal: "What's My Decimal?", verify: "Check My Division Order", royalties: "Estimate My Royalties", pooling: "Compare Pooling Elections", value: "What Are My Minerals Worth?", fraction: "Trace My Mineral Interest" };
        var h2 = document.querySelector('.calc-panel.active h2');
        if (h2) h2.textContent = titles[tabId] || '';
    };

    // ══════════════════════════════
    //  NRI CALCULATOR (decimal)
    // ══════════════════════════════
    var dUnit = 640, dRoyalty = 0.1875;

    window.setDUnit = function(val) {
        dUnit = val;
        setActivePreset('d-unit-presets', val === 640 ? 0 : val === 1280 ? 1 : 2);
        document.getElementById('d-custom-unit-wrap').style.display = val === null ? 'block' : 'none';
        if (val !== null) document.getElementById('d-custom-unit').value = '';
        calcDecimal();
    };
    window.setDRoyalty = function(val) {
        dRoyalty = val;
        var idx = [0.125, 0.1875, 0.20, 0.25].indexOf(val);
        setActivePreset('d-royalty-presets', idx);
        calcDecimal();
    };

    window.calcDecimal = function() {
        var acres = num('d-acres');
        var mi = num('d-mi');
        var effectiveUnit = dUnit || num('d-custom-unit');
        var allocation = num('d-allocation');
        if (acres <= 0 || effectiveUnit <= 0) { document.getElementById('d-results').innerHTML = ''; return; }

        var nma = acres * mi;
        var nra = nma * dRoyalty;
        var rawDecimal = nra / effectiveUnit;
        var allocPct = allocation > 0 ? allocation / 100 : 1;
        var decimal = rawDecimal * allocPct;

        var html = '<div class="results">' +
            '<div class="result-row">' +
                resultBox('Net Mineral Acres', fmt(nma, 4), 'NMA', 'success') +
                resultBox('Net Royalty Acres', fmt(nra, 4), 'NRA', 'success') +
            '</div>' +
            '<div class="result-row">' +
                resultBox('Your Decimal Interest', fmt(decimal, 8), allocation > 0 ? 'With ' + allocation + '% section allocation' : 'Full unit', 'primary') +
            '</div>';
        if (allocation > 0) {
            html += note('<strong>Without section allocation:</strong> ' + fmt(rawDecimal, 8) + ' &rarr; <strong>With ' + allocation + '% section allocation:</strong> ' + fmt(decimal, 8));
        }
        html += '</div>';
        document.getElementById('d-results').innerHTML = html;
    };

    // ══════════════════════════════
    //  VERIFY D.O.
    // ══════════════════════════════
    var vUnit = 640, vRoyalty = 0.1875;

    window.setVUnit = function(val) {
        vUnit = val;
        setActivePreset('v-unit-presets', val === 640 ? 0 : val === 1280 ? 1 : 2);
        document.getElementById('v-custom-unit-wrap').style.display = val === null ? 'block' : 'none';
        if (val !== null) document.getElementById('v-custom-unit').value = '';
        calcVerify();
    };
    window.setVRoyalty = function(val) {
        vRoyalty = val;
        var idx = [0.125, 0.1875, 0.20, 0.25].indexOf(val);
        setActivePreset('v-royalty-presets', idx);
        calcVerify();
    };

    window.calcVerify = function() {
        var doDecimal = num('v-do-decimal');
        var acres = num('v-acres');
        var mi = num('v-mi');
        var effectiveUnit = vUnit || num('v-custom-unit');
        var allocation = num('v-allocation');
        if (doDecimal <= 0 || acres <= 0 || effectiveUnit <= 0) { document.getElementById('v-results').innerHTML = ''; return; }

        var nma = acres * mi;
        var nra = nma * vRoyalty;
        var rawDecimal = nra / effectiveUnit;
        var allocPct = allocation > 0 ? allocation / 100 : 1;
        var expected = rawDecimal * allocPct;
        var diff = ((doDecimal - expected) / expected) * 100;
        var absDiff = Math.abs(diff);
        var match = absDiff < 0.5;
        var close = absDiff < 5;

        var doVariant = match ? 'success' : close ? 'warning' : 'danger';
        var html = '<div class="results">' +
            '<div class="result-row">' +
                resultBox('Division Order Says', fmt(doDecimal, 8), '', doVariant) +
                resultBox('Our Calculation', fmt(expected, 8), '', 'primary') +
            '</div>';
        if (match) {
            html += note('<strong>&#10003; Match.</strong> Your division order decimal is within 0.5% of the calculated value. The math checks out.', 'success');
        } else if (close) {
            html += note('<strong>&#9888; Close but off by ' + fmt(absDiff, 1) + '%.</strong> This could be a minor rounding difference, a slightly different unit acreage (survey vs. standard), or a small section allocation variance. Worth verifying the unit size on the OCC spacing order.', 'warning');
        } else {
            html += note('<strong>&#9888; Discrepancy of ' + fmt(absDiff, 1) + '%.</strong> Your division order decimal is ' + (diff > 0 ? 'higher' : 'lower') + ' than expected. Common causes: incorrect NMA in operator&#39;s title opinion, wrong unit size, missing mineral interest fraction, or section allocation error. Consider requesting the operator&#39;s title runsheet.', 'warning');
        }
        html += '</div>';
        document.getElementById('v-results').innerHTML = html;
    };

    // ══════════════════════════════
    //  ROYALTIES
    // ══════════════════════════════
    window.calcRoyalties = function() {
        var dec = num('r-decimal');
        var oilBbl = num('r-oil-bbl');
        var gasMcf = num('r-gas-mcf');
        var oilPrice = num('r-oil-price');
        var gasPrice = num('r-gas-price');
        var deductPct = num('r-deductions');
        if (dec <= 0 || (oilBbl <= 0 && gasMcf <= 0)) { document.getElementById('r-results').innerHTML = ''; return; }

        var deduction = deductPct > 0 ? deductPct / 100 : 0;
        var grossOil = oilBbl * oilPrice * dec;
        var grossGas = gasMcf * gasPrice * dec;
        var grossTotal = grossOil + grossGas;
        var netTotal = grossTotal * (1 - deduction);
        var annualNet = netTotal * 12;

        var html = '<div class="results">' +
            '<div class="result-row">' +
                resultBox('Gross Oil Revenue', dollar(grossOil), 'per month', 'success') +
                resultBox('Gross Gas Revenue', dollar(grossGas), 'per month', 'success') +
            '</div>' +
            '<div class="result-row">' +
                resultBox('Net Monthly', dollar(netTotal), deductPct > 0 ? 'After ' + deductPct + '% deductions' : 'No deductions applied', 'primary') +
                resultBox('Estimated Annual', dollar(annualNet), 'at current rates', 'primary') +
            '</div>';
        if (deduction > 0) {
            html += note('<strong>Deduction note:</strong> Oklahoma courts generally require deductions to be &ldquo;reasonable and actually incurred.&rdquo; If your lease has a &ldquo;no deductions&rdquo; or &ldquo;cost-free royalty&rdquo; clause, your gross and net should be the same. Review your lease language carefully.', 'warning');
        }
        html += '</div>';
        document.getElementById('r-results').innerHTML = html;
    };

    // ══════════════════════════════
    //  POOLING
    // ══════════════════════════════
    var pUnit = 640;
    var poolingOptions = [
        { bonus: 400, royalty: 0.125, label: 'Option 1' },
        { bonus: 300, royalty: 0.1875, label: 'Option 2' },
        { bonus: 200, royalty: 0.20, label: 'Option 3' }
    ];

    window.setPUnit = function(val) {
        pUnit = val;
        setActivePreset('p-unit-presets', val === 640 ? 0 : val === 1280 ? 1 : 2);
        document.getElementById('p-custom-unit-wrap').style.display = val === null ? 'block' : 'none';
        if (val !== null) document.getElementById('p-custom-unit').value = '';
        calcPooling();
    };

    function renderPoolingOptions() {
        var container = document.getElementById('p-options-list');
        var html = '';
        for (var i = 0; i < poolingOptions.length; i++) {
            var opt = poolingOptions[i];
            html += '<div class="pooling-row" data-idx="' + i + '">' +
                '<span class="opt-label">' + esc(opt.label) + '</span>' +
                '<div class="dollar-prefix"><input type="number" value="' + opt.bonus + '" placeholder="Bonus/acre" onchange="updatePoolOpt(' + i + ',\\'bonus\\',this.value)" oninput="updatePoolOpt(' + i + ',\\'bonus\\',this.value)"></div>' +
                '<select onchange="updatePoolOpt(' + i + ',\\'royalty\\',this.value)">' +
                    '<option value="0.125"' + (opt.royalty === 0.125 ? ' selected' : '') + '>1/8 (12.5%)</option>' +
                    '<option value="0.1875"' + (opt.royalty === 0.1875 ? ' selected' : '') + '>3/16 (18.75%)</option>' +
                    '<option value="0.20"' + (opt.royalty === 0.20 ? ' selected' : '') + '>1/5 (20%)</option>' +
                    '<option value="0.25"' + (opt.royalty === 0.25 ? ' selected' : '') + '>1/4 (25%)</option>' +
                '</select>' +
                '<button class="remove-btn" onclick="removePoolOpt(' + i + ')"' + (poolingOptions.length <= 2 ? ' disabled' : '') + '>&times;</button>' +
            '</div>';
        }
        container.innerHTML = html;
        document.getElementById('p-add-btn').style.display = poolingOptions.length >= 5 ? 'none' : 'block';
    }

    window.updatePoolOpt = function(idx, field, val) {
        if (field === 'bonus') poolingOptions[idx].bonus = parseFloat(val) || 0;
        if (field === 'royalty') poolingOptions[idx].royalty = parseFloat(val);
        calcPooling();
    };
    window.addPoolingOption = function() {
        if (poolingOptions.length < 5) {
            poolingOptions.push({ bonus: 0, royalty: 0.125, label: 'Option ' + (poolingOptions.length + 1) });
            renderPoolingOptions();
            calcPooling();
        }
    };
    window.removePoolOpt = function(idx) {
        if (poolingOptions.length > 2) {
            poolingOptions.splice(idx, 1);
            // Relabel
            for (var i = 0; i < poolingOptions.length; i++) poolingOptions[i].label = 'Option ' + (i + 1);
            renderPoolingOptions();
            calcPooling();
        }
    };

    window.calcPooling = function() {
        var nma = num('p-nma');
        var effectiveUnit = pUnit || num('p-custom-unit');
        var oilProd = num('p-oil-prod');
        var oilPrice = num('p-oil-price');
        var gasProd = num('p-gas-prod');
        var gasPrice = num('p-gas-price');
        if (!nma || !effectiveUnit || (!oilProd && !gasProd)) { document.getElementById('p-results').innerHTML = ''; return; }

        var analysis = poolingOptions.map(function(opt) {
            var bonusTotal = opt.bonus * nma;
            var decimal = (nma * opt.royalty) / effectiveUnit;
            var monthlyRevenue = (oilProd * oilPrice + gasProd * gasPrice) * decimal;
            var annualRevenue = monthlyRevenue * 12;
            return { label: opt.label, bonus: opt.bonus, royalty: opt.royalty, bonusTotal: bonusTotal, decimal: decimal, monthlyRevenue: monthlyRevenue, annualRevenue: annualRevenue };
        });

        // Break-even calc
        var sorted = analysis.slice().sort(function(a, b) { return b.bonusTotal - a.bonusTotal; });
        var highBonus = sorted[0];
        var highRoyalty = sorted[sorted.length - 1];
        var breakeven = null;
        if (highRoyalty.monthlyRevenue > highBonus.monthlyRevenue) {
            var monthlyDiff = highRoyalty.monthlyRevenue - highBonus.monthlyRevenue;
            var bonusDiff = highBonus.bonusTotal - highRoyalty.bonusTotal;
            if (bonusDiff > 0) breakeven = Math.ceil(bonusDiff / monthlyDiff);
        }

        var html = '<div class="results"><div style="overflow-x:auto;"><table class="comparison-table"><thead><tr>' +
            '<th style="text-align:left;">Election</th><th>Bonus Total</th><th>Decimal</th><th>Monthly Rev.</th><th>Year 1 Total</th></tr></thead><tbody>';
        for (var i = 0; i < analysis.length; i++) {
            var a = analysis[i];
            html += '<tr><td>' + esc(a.label) + '<br><small>$' + a.bonus + '/acre &middot; ' + (a.royalty * 100).toFixed(2) + '%</small></td>' +
                '<td>' + dollarInt(a.bonusTotal) + '</td>' +
                '<td>' + fmt(a.decimal, 8) + '</td>' +
                '<td>' + dollar(a.monthlyRevenue) + '</td>' +
                '<td style="font-weight:600;">' + dollarInt(a.bonusTotal + a.annualRevenue) + '</td></tr>';
        }
        html += '</tbody></table></div>';

        if (breakeven !== null && breakeven > 0) {
            html += note('<strong>Break-even:</strong> The higher-royalty option overtakes the higher-bonus option after approximately <strong>' + breakeven + ' months</strong> (' + (breakeven / 12).toFixed(1) + ' years) of production at current prices. Wells that produce longer than this favor the higher royalty rate.');
        }
        html += note('<strong>Important:</strong> This assumes flat production and pricing. Real wells decline over time (typically 60&ndash;70% in year one for Oklahoma horizontal wells). The actual break-even will be longer than shown. This tool helps illustrate the tradeoff &mdash; not predict exact returns.', 'warning');
        html += '</div>';
        document.getElementById('p-results').innerHTML = html;
    };

    // ══════════════════════════════
    //  VALUATION
    // ══════════════════════════════
    var valMode = 'producing';
    var valLeased = null;

    window.setValMode = function(mode) {
        valMode = mode;
        document.getElementById('val-mode-prod').classList.toggle('active', mode === 'producing');
        document.getElementById('val-mode-nonprod').classList.toggle('active', mode === 'nonproducing');
        document.getElementById('val-producing').style.display = mode === 'producing' ? 'block' : 'none';
        document.getElementById('val-nonproducing').style.display = mode === 'nonproducing' ? 'block' : 'none';
        document.getElementById('val-prod-results').innerHTML = '';
        document.getElementById('val-nonprod-results').innerHTML = '';
    };

    window.setLeased = function(val) {
        valLeased = val;
        document.getElementById('val-leased-yes').classList.toggle('active', val === true);
        document.getElementById('val-leased-no').classList.toggle('active', val === false);
        document.getElementById('val-bonus-wrap').style.display = val === true ? 'block' : 'none';
        calcValue();
    };

    window.calcValue = function() {
        if (valMode === 'producing') {
            var monthly = num('val-monthly');
            if (monthly <= 0) { document.getElementById('val-prod-results').innerHTML = ''; return; }
            var annual = monthly * 12;
            var low = annual * 3;
            var mid = annual * 4.5;
            var high = annual * 6;

            var html = '<div class="results">' +
                '<div class="result-row">' +
                    resultBox('Annual Royalty Income', dollarInt(annual), 'baseline for valuation', 'success') +
                '</div>' +
                '<label style="display:block;font-size:13px;font-weight:600;color:var(--text-primary);margin:16px 0 12px;font-family:Merriweather,serif;">Estimated Market Value Range</label>' +
                '<div class="result-row">' +
                    resultBox('Low (3&times; Annual)', dollarInt(low), 'Cash flow only', 'warning') +
                    resultBox('Mid (4.5&times; Annual)', dollarInt(mid), 'Typical', 'primary') +
                    resultBox('High (6&times; Annual)', dollarInt(high), 'With upside', 'success') +
                '</div>' +
                note('<strong>How to read this:</strong> Most producing Oklahoma mineral sales fall in the 3&times;&ndash;6&times; annual income range. The actual multiple depends on decline rate, remaining reserves, operator quality, and development potential. A professional appraisal is recommended before selling.') +
                note('<strong>Use stabilized income:</strong> If this well is less than 12 months old, its current production may be significantly higher than its long-term average. Consider using a 6&ndash;12 month average or applying a decline factor for a more conservative estimate.', 'warning') +
            '</div>';
            document.getElementById('val-prod-results').innerHTML = html;
        } else {
            var nma = num('val-nma');
            if (nma <= 0 || valLeased === null) { document.getElementById('val-nonprod-results').innerHTML = ''; return; }

            var html = '<div class="results">';
            if (valLeased && num('val-bonus') > 0) {
                var bonus = num('val-bonus');
                html += '<div class="result-row">' +
                    resultBox('Low (2&times; Lease Bonus)', dollarInt(bonus * 2), '', 'warning') +
                    resultBox('Mid (2.5&times; Lease Bonus)', dollarInt(bonus * 2.5), '', 'primary') +
                    resultBox('High (3&times; Lease Bonus)', dollarInt(bonus * 3), '', 'success') +
                '</div>' +
                note('<strong>Rule of thumb:</strong> Leased mineral rights in Oklahoma typically sell for 2&ndash;3&times; the lease bonus amount. This reflects the operator&#39;s assessment of the area&#39;s development potential.');
            } else if (valLeased === false) {
                html += '<div class="result-row">' +
                    resultBox('Low ($50/NMA)', dollarInt(nma * 50), 'Unproven area', 'warning') +
                    resultBox('Mid ($150/NMA)', dollarInt(nma * 150), 'Moderate activity', 'primary') +
                    resultBox('High ($500+/NMA)', dollarInt(nma * 500), 'Active SCOOP/STACK', 'success') +
                '</div>' +
                note('<strong>Wide range:</strong> Non-producing, non-leased mineral value depends heavily on location. Minerals in active SCOOP &amp; STACK counties (Canadian, Grady, Kingfisher) are worth significantly more than those in less active areas. Recent pooling activity and nearby permits are strong value indicators.');
            }
            html += note('<strong>Values as of February 2026.</strong> Non-producing mineral values shift with commodity prices, drilling activity, and lease demand. These ranges reflect current Oklahoma market conditions and may change.', 'warning');
            html += '</div>';
            document.getElementById('val-nonprod-results').innerHTML = html;
        }
    };

    // ══════════════════════════════
    //  INTEREST CHAIN (fraction)
    // ══════════════════════════════
    var fracSteps = [];

    // ── Fraction math (integer-exact) ──
    function fracGcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { var t = b; b = a % b; a = t; } return a; }
    function fracReduce(f) { if (f.n === 0) return { n: 0, d: 1 }; var g = fracGcd(f.n, f.d); var sign = f.d < 0 ? -1 : 1; return { n: sign * f.n / g, d: sign * f.d / g }; }
    function fracMul(a, b) { return fracReduce({ n: a.n * b.n, d: a.d * b.d }); }
    function fracDiv(a, b) { return fracReduce({ n: a.n * b.d, d: a.d * b.n }); }
    function fracToDec(f) { return f.d === 0 ? 0 : f.n / f.d; }
    function fracToStr(f) { if (f.d === 1) return String(f.n); return f.n + '/' + f.d; }
    function fracSub(a, b) { return fracReduce({ n: a.n * b.d - b.n * a.d, d: a.d * b.d }); }
    function fracAdd(a, b) { return fracReduce({ n: a.n * b.d + b.n * a.d, d: a.d * b.d }); }

    function parseFraction(str) {
        if (!str || !str.trim()) return null;
        str = str.trim();
        // Fraction form: "3/16"
        var slashIdx = str.indexOf('/');
        if (slashIdx > 0) {
            var num_part = parseInt(str.substring(0, slashIdx), 10);
            var den = parseInt(str.substring(slashIdx + 1), 10);
            if (isNaN(num_part) || isNaN(den) || den === 0) return null;
            return fracReduce({ n: num_part, d: den });
        }
        // Decimal form: "0.1875"
        var val = parseFloat(str);
        if (isNaN(val) || val < 0) return null;
        if (val === 0) return { n: 0, d: 1 };
        if (val >= 1 && val === Math.floor(val)) return { n: Math.round(val), d: 1 };
        // Try common mineral denominators for clean display
        var denoms = [2, 3, 4, 5, 6, 8, 10, 12, 16, 24, 32, 48, 64, 128, 256];
        for (var i = 0; i < denoms.length; i++) {
            var n = Math.round(val * denoms[i]);
            if (Math.abs(n / denoms[i] - val) < 0.00001) return fracReduce({ n: n, d: denoms[i] });
        }
        // Fallback: /10000
        return fracReduce({ n: Math.round(val * 10000), d: 10000 });
    }

    // ── Step management ──
    window.addFracStep = function(type) {
        var step = { type: type };
        if (type === 'inheritance') step.divisor = '';
        if (type === 'conveyance') { step.fracStr = ''; step.label = ''; }
        if (type === 'royalty') { step.fracStr = ''; step.label = ''; }
        if (type === 'lease') step.fracStr = '3/16';
        if (type === 'pooling') step.allocPct = '';
        fracSteps.push(step);
        document.getElementById('fc-menu').style.display = 'none';
        renderFracSteps();
        calcFraction();
    };

    window.removeFracStep = function(idx) {
        fracSteps.splice(idx, 1);
        renderFracSteps();
        calcFraction();
    };

    window.toggleFracMenu = function() {
        var menu = document.getElementById('fc-menu');
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    };

    window.resetFracChain = function() {
        fracSteps = [];
        document.getElementById('fc-start-mi').value = '';
        document.getElementById('fc-acres').value = '';
        renderFracSteps();
        document.getElementById('fc-summary').innerHTML = '';
    };

    window.updateFracStep = function(idx, field, value) {
        fracSteps[idx][field] = value;
        calcFraction();
    };

    function renderFracSteps() {
        var container = document.getElementById('fc-steps');
        if (fracSteps.length === 0) { container.innerHTML = ''; return; }
        var html = '';
        for (var i = 0; i < fracSteps.length; i++) {
            var s = fracSteps[i];
            if (i > 0) html += '<div class="frac-arrow">&#x2193;</div>';
            html += '<div class="frac-step">';
            html += '<div class="frac-step-num">' + (i + 1) + '</div>';
            html += '<div class="frac-step-body">';

            if (s.type === 'inheritance') {
                html += '<div class="frac-step-type">Inheritance / Probate</div>';
                html += '<div class="frac-step-inputs">';
                html += '<label>Heirs:</label> <input type="number" min="1" step="1" value="' + esc(String(s.divisor)) + '" placeholder="e.g. 3" oninput="updateFracStep(' + i + ',\\'divisor\\',this.value)">';
                html += '<label style="color:var(--text-muted);font-style:italic;">Your 1/' + (parseInt(s.divisor) > 0 ? s.divisor : 'N') + ' undivided share</label>';
                html += '</div>';
            } else if (s.type === 'conveyance') {
                html += '<div class="frac-step-type">Conveyance / Deed</div>';
                html += '<div class="frac-step-inputs">';
                html += '<label>Fraction:</label> <input type="text" value="' + esc(s.fracStr) + '" placeholder="e.g. 1/4" oninput="updateFracStep(' + i + ',\\'fracStr\\',this.value)">';
                html += '<label>To:</label> <input type="text" value="' + esc(s.label) + '" placeholder="Name (optional)" style="max-width:160px;" oninput="updateFracStep(' + i + ',\\'label\\',this.value)">';
                html += '</div>';
            } else if (s.type === 'royalty') {
                html += '<div class="frac-step-type">Retained Royalty (NPRI)</div>';
                html += '<div class="frac-step-inputs">';
                html += '<label>NPRI fraction:</label> <input type="text" value="' + esc(s.fracStr) + '" placeholder="e.g. 1/16" oninput="updateFracStep(' + i + ',\\'fracStr\\',this.value)">';
                html += '<label>Reserved by:</label> <input type="text" value="' + esc(s.label) + '" placeholder="Name (optional)" style="max-width:160px;" oninput="updateFracStep(' + i + ',\\'label\\',this.value)">';
                html += '</div>';
            } else if (s.type === 'lease') {
                html += '<div class="frac-step-type">Oil &amp; Gas Lease</div>';
                html += '<div class="frac-step-inputs">';
                html += '<label>Royalty rate:</label> <select onchange="updateFracStep(' + i + ',\\'fracStr\\',this.value)">';
                var leaseOpts = [['1/8','1/8 (12.5%)'],['3/16','3/16 (18.75%)'],['1/5','1/5 (20%)'],['1/4','1/4 (25%)']];
                for (var j = 0; j < leaseOpts.length; j++) {
                    html += '<option value="' + leaseOpts[j][0] + '"' + (s.fracStr === leaseOpts[j][0] ? ' selected' : '') + '>' + leaseOpts[j][1] + '</option>';
                }
                html += '</select>';
                html += '</div>';
            } else if (s.type === 'pooling') {
                html += '<div class="frac-step-type">Pooling / Allocation</div>';
                html += '<div class="frac-step-inputs">';
                html += '<label>Allocation:</label> <input type="number" min="0" max="100" step="any" value="' + esc(String(s.allocPct)) + '" placeholder="e.g. 52.3" oninput="updateFracStep(' + i + ',\\'allocPct\\',this.value)"> <label>%</label>';
                html += '</div>';
            }

            // Running result placeholder
            html += '<div class="frac-step-result" id="fc-step-result-' + i + '"></div>';
            html += '</div>'; // .frac-step-body
            html += '<button class="remove-btn" onclick="removeFracStep(' + i + ')" title="Remove step">&times;</button>';
            html += '</div>'; // .frac-step
        }
        container.innerHTML = html;
    }

    // ── Core calculation ──
    window.calcFraction = function() {
        var startFrac = parseFraction(document.getElementById('fc-start-mi').value);
        var acres = num('fc-acres');
        if (!startFrac || acres <= 0) {
            document.getElementById('fc-summary').innerHTML = '';
            // Clear step results
            for (var c = 0; c < fracSteps.length; c++) {
                var el = document.getElementById('fc-step-result-' + c);
                if (el) el.innerHTML = '';
            }
            return;
        }

        var mi = { n: startFrac.n, d: startFrac.d };
        var npriReservations = [];
        var leaseRoyalty = null;
        var allocation = null;

        for (var i = 0; i < fracSteps.length; i++) {
            var s = fracSteps[i];
            var stepEl = document.getElementById('fc-step-result-' + i);

            if (s.type === 'inheritance') {
                var divisor = parseInt(s.divisor, 10);
                if (divisor > 0) {
                    mi = fracDiv(mi, { n: divisor, d: 1 });
                }
            } else if (s.type === 'conveyance') {
                var cf = parseFraction(s.fracStr);
                if (cf) {
                    mi = fracMul(mi, cf);
                }
            } else if (s.type === 'royalty') {
                var rf = parseFraction(s.fracStr);
                if (rf) {
                    npriReservations.push({ frac: rf, label: s.label || 'NPRI #' + (npriReservations.length + 1) });
                }
                // NPRI does NOT reduce MI
            } else if (s.type === 'lease') {
                var lf = parseFraction(s.fracStr);
                if (lf) leaseRoyalty = lf;
            } else if (s.type === 'pooling') {
                var pct = parseFloat(s.allocPct);
                if (pct > 0) allocation = pct / 100;
            }

            // Show running MI after this step
            if (stepEl) {
                var nma = fracToDec(mi) * acres;
                stepEl.innerHTML = '<span>MI: <span class="frac-val">' + fracToStr(mi) + '</span></span>' +
                    '<span>Decimal: <span class="frac-val">' + fracToDec(mi).toFixed(8) + '</span></span>' +
                    '<span>NMA: <span class="frac-val">' + nma.toFixed(4) + '</span></span>';
            }
        }

        // ── Summary ──
        var nma = fracToDec(mi) * acres;
        var summaryHtml = '<div class="frac-summary">';
        summaryHtml += '<div class="frac-summary-title">Ownership Summary</div>';
        summaryHtml += '<div class="frac-summary-grid">';
        summaryHtml += '<div class="frac-summary-item"><div class="frac-sum-label">Mineral Interest</div><div class="frac-sum-value">' + fracToStr(mi) + '</div><div class="frac-sum-sub">' + fracToDec(mi).toFixed(8) + ' decimal</div></div>';
        summaryHtml += '<div class="frac-summary-item"><div class="frac-sum-label">Net Mineral Acres</div><div class="frac-sum-value">' + nma.toFixed(4) + '</div><div class="frac-sum-sub">of ' + acres + ' total acres</div></div>';

        if (leaseRoyalty) {
            // NRI = MI * leaseRoyalty - sum(NPRIs), then * allocation
            var nri = fracMul(mi, leaseRoyalty);
            for (var k = 0; k < npriReservations.length; k++) {
                nri = fracSub(nri, npriReservations[k].frac);
            }
            if (allocation) {
                nri = fracMul(nri, { n: Math.round(allocation * 10000), d: 10000 });
            }
            nri = fracReduce(nri);
            summaryHtml += '<div class="frac-summary-item"><div class="frac-sum-label">NRI Decimal</div><div class="frac-sum-value">' + fracToDec(nri).toFixed(8) + '</div><div class="frac-sum-sub">' + fracToStr(nri) + (allocation ? ' (after allocation)' : '') + '</div></div>';
        }

        summaryHtml += '</div>'; // .frac-summary-grid

        // NPRI line items
        for (var n = 0; n < npriReservations.length; n++) {
            var np = npriReservations[n];
            summaryHtml += '<div class="frac-npri-line">NPRI burden: <strong>' + fracToStr(np.frac) + '</strong> (' + fracToDec(np.frac).toFixed(8) + ') &mdash; ' + esc(np.label) + '</div>';
        }

        summaryHtml += '</div>'; // .frac-summary
        document.getElementById('fc-summary').innerHTML = summaryHtml;
    };

    // Close menu on outside click
    document.addEventListener('click', function(e) {
        var menu = document.getElementById('fc-menu');
        var addBtn = document.getElementById('fc-add-btn');
        if (menu && addBtn && !menu.contains(e.target) && !addBtn.contains(e.target)) {
            menu.style.display = 'none';
        }
    });

    // ══════════════════════════════
    //  UTILS
    // ══════════════════════════════
    function setActivePreset(containerId, activeIdx) {
        var btns = document.getElementById(containerId).querySelectorAll('.preset-btn');
        btns.forEach(function(btn, i) { btn.classList.toggle('active', i === activeIdx); });
    }

    // Init: render pooling options
    renderPoolingOptions();

    // Set initial SVG colors on tabs
    document.querySelectorAll('.calc-tab').forEach(function(btn) {
        var svg = btn.querySelector('svg');
        if (svg) svg.style.stroke = btn.classList.contains('active') ? 'var(--red-dirt)' : 'rgba(255,255,255,0.45)';
    });

    // ══════════════════════════════════════
    //  LIVE PRICE TICKER — EIA via /api/prices
    // ══════════════════════════════════════
    (function loadLivePrices() {
        var OIL_FIELDS = ['r-oil-price', 'p-oil-price'];
        var GAS_FIELDS = ['r-gas-price', 'p-gas-price'];
        var OIL_HELPS  = ['r-oil-price-help', 'p-oil-price-help'];
        var GAS_HELPS  = ['r-gas-price-help', 'p-gas-price-help'];

        function formatDate(dateStr) {
            try {
                var d = new Date(dateStr + 'T12:00:00Z');
                return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            } catch(e) { return dateStr; }
        }

        function liveBadge(dateStr) {
            var now = new Date();
            var priceDate = new Date(dateStr + 'T12:00:00Z');
            var daysOld = Math.floor((now - priceDate) / 86400000);
            if (daysOld > 2) {
                return '<span class="live-price-badge">as of ' + formatDate(dateStr) + '</span>';
            }
            return '<span class="live-price-badge"><span class="live-dot"></span>Live \\u00b7 ' + formatDate(dateStr) + '</span>';
        }

        function setPrice(fieldIds, helpIds, price, dateStr, label) {
            for (var i = 0; i < fieldIds.length; i++) {
                var field = document.getElementById(fieldIds[i]);
                if (field) {
                    var current = parseFloat(field.value);
                    var defaultOil = 68, defaultGas = 3.25;
                    var isDefault = (fieldIds[i].indexOf('oil') >= 0 && current === defaultOil) ||
                                    (fieldIds[i].indexOf('gas') >= 0 && current === defaultGas) ||
                                    isNaN(current);
                    if (isDefault) {
                        field.value = price;
                        field.dispatchEvent(new Event('input'));
                    }
                }
                var help = document.getElementById(helpIds[i]);
                if (help) {
                    help.innerHTML = label + ' ' + liveBadge(dateStr);
                }
            }
        }

        function updateTicker(data) {
            var ticker = document.getElementById('hero-ticker');
            if (!ticker) return;
            if (data.wti && data.wti.price) {
                var el = document.getElementById('ticker-oil');
                if (el) el.textContent = '$' + data.wti.price.toFixed(2);
                var dt = document.getElementById('ticker-oil-date');
                if (dt) dt.textContent = formatDate(data.wti.date);
            }
            if (data.henryHub && data.henryHub.price) {
                var el2 = document.getElementById('ticker-gas');
                if (el2) el2.textContent = '$' + data.henryHub.price.toFixed(2);
                var dt2 = document.getElementById('ticker-gas-date');
                if (dt2) dt2.textContent = formatDate(data.henryHub.date);
            }
            if ((data.wti && data.wti.price) || (data.henryHub && data.henryHub.price)) {
                ticker.classList.add('loaded');
            }
        }

        fetch('/api/prices')
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (data.wti && data.wti.price) {
                    setPrice(OIL_FIELDS, OIL_HELPS, data.wti.price, data.wti.date, 'WTI Spot');
                }
                if (data.henryHub && data.henryHub.price) {
                    setPrice(GAS_FIELDS, GAS_HELPS, data.henryHub.price, data.henryHub.date, 'Henry Hub');
                }
                updateTicker(data);
            })
            .catch(function(err) {
                console.log('Price fetch unavailable, using defaults');
            });
    })();
})();
</script>

</body>
</html>`;
}
