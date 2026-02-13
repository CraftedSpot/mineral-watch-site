import { icon, iconLg, iconMd } from './icons';

// ── Helpers ──
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Shared HTML fragments ──

const HEADER = `
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
                <a href="/insights" class="active">Insights</a>

                <a href="/about">About</a>
                <a href="/contact">Contact</a>
                <a href="https://portal.mymineralwatch.com" class="btn-login">Sign In</a>
            </nav>
        </div>
    </div>
</header>`;

const FOOTER = `
<footer>
    <div class="container" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px;">
        <p>&copy; 2026 <strong>Mineral Watch LLC</strong> &middot; Oklahoma City, OK</p>
        <div>
            <a href="/privacy">Privacy</a> &middot; <a href="/terms">Terms</a> &middot; <a href="/contact">Contact</a>
        </div>
    </div>
</footer>`;

const MENU_SCRIPT = `
<script>
document.addEventListener('click', function(e) {
    const nav = document.querySelector('.nav-links');
    const btn = document.querySelector('.mobile-menu-btn');
    if (nav && btn && !nav.contains(e.target) && !btn.contains(e.target)) {
        nav.classList.remove('open');
    }
});
</script>`;

// ── Shared CSS ──

const CSS_VARS = `
:root {
    --oil-navy: #1C2B36;
    --slate-blue: #334E68;
    --red-dirt: #C05621;
    --red-dirt-dark: #9C4215;
    --paper: #F8F9FA;
    --border: #E2E8F0;
    --success: #03543F;
    --success-bg: #DEF7EC;
}`;

const CSS_BASE = `
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Inter', sans-serif; line-height: 1.6; color: var(--oil-navy); background: #fff; }
h1, h2, h3, h4, .logo { font-family: 'Merriweather', serif; }
.container { max-width: 1100px; margin: 0 auto; padding: 0 20px; }
a { color: inherit; }

/* Header */
header { background: #fff; padding: 20px 0; border-bottom: 1px solid var(--border); }
.header-inner { display: flex; justify-content: space-between; align-items: center; }
.logo { font-size: 22px; font-weight: 900; color: var(--oil-navy); letter-spacing: -0.5px; text-decoration: none; display: inline-flex; align-items: center; gap: 8px; }
.logo svg { color: var(--red-dirt); }
.nav-links { display: flex; gap: 30px; align-items: center; }
.nav-links a { color: var(--slate-blue); text-decoration: none; font-weight: 500; font-size: 15px; transition: color 0.2s; }
.nav-links a:hover { color: var(--oil-navy); }
.nav-links a.active { color: var(--red-dirt); font-weight: 600; border-bottom: 2px solid var(--red-dirt); padding-bottom: 2px; }
.nav-links .btn-login { background: var(--oil-navy); color: white; padding: 10px 20px; border-radius: 4px; font-weight: 600; }
.nav-links .btn-login:hover { background: var(--slate-blue); color: white; }
.mobile-menu-btn { display: none; background: none; border: none; cursor: pointer; color: var(--oil-navy); }

/* Footer */
footer { background: var(--oil-navy); color: rgba(255,255,255,0.6); padding: 40px 0; font-size: 14px; }
footer strong { color: rgba(255,255,255,0.8); }
footer a { color: rgba(255,255,255,0.6); text-decoration: none; }
footer a:hover { color: white; }

/* Tag badges */
.tag { display: inline-block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; padding: 4px 10px; border-radius: 3px; }
.tag-guide { background: #EBF5FF; color: #1A56DB; }
.tag-analysis { background: #F3E8FF; color: #7C3AED; }
.tag-regulatory { background: #FFF3E0; color: var(--red-dirt); }
.tag-county { background: var(--success-bg); color: var(--success); }

/* Read link */
.read-link { display: inline-flex; align-items: center; gap: 6px; color: var(--red-dirt); font-weight: 600; font-size: 14px; text-decoration: none; }
.read-link:hover { text-decoration: underline; }

/* Mobile */
@media (max-width: 768px) {
    .mobile-menu-btn { display: block; }
    .nav-links { display: none; position: absolute; top: 100%; left: 0; right: 0; background: #fff; flex-direction: column; padding: 20px; gap: 16px; border-bottom: 1px solid var(--border); box-shadow: 0 8px 16px rgba(0,0,0,0.1); z-index: 100; }
    .nav-links.open { display: flex; }
    header { position: relative; }
}`;

const FONT_LINK = `
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:wght@400;700;900&display=swap" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:wght@400;700;900&display=swap"></noscript>`;

// ════════════════════════════════════════════
//  INSIGHTS HUB PAGE
// ════════════════════════════════════════════

export function renderInsightsHub(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mineral Rights Insights — Guides, Analysis & County Data | Mineral Watch</title>
    <meta name="description" content="Educational guides, OCC filing explainers, county drilling activity, and mineral rights resources for Oklahoma mineral owners. From pooling orders to production analysis.">
    <link rel="canonical" href="https://mymineralwatch.com/insights">
    <meta property="og:type" content="website">
    <meta property="og:url" content="https://mymineralwatch.com/insights">
    <meta property="og:title" content="Mineral Rights Insights — Guides, Analysis & County Data | Mineral Watch">
    <meta property="og:description" content="Educational guides, OCC filing explainers, county drilling activity, and mineral rights resources for Oklahoma mineral owners.">
    <meta property="og:image" content="https://mymineralwatch.com/assets/pooling-bonus-rates-by-township.png">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="Mineral Rights Insights | Mineral Watch">
    <meta name="twitter:description" content="Educational guides, OCC filing explainers, county drilling activity, and mineral rights resources for Oklahoma mineral owners.">
    <meta name="twitter:image" content="https://mymineralwatch.com/assets/pooling-bonus-rates-by-township.png">
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "name": "Mineral Rights Insights",
      "description": "Educational guides, OCC filing explainers, county drilling activity, and mineral rights resources for Oklahoma mineral owners.",
      "url": "https://mymineralwatch.com/insights",
      "publisher": { "@type": "Organization", "name": "Mineral Watch", "url": "https://mymineralwatch.com" }
    }
    </script>
    ${FONT_LINK}
    <style>
        ${CSS_VARS}
        ${CSS_BASE}

        /* Hero */
        .insights-hero { background: var(--oil-navy); padding: 60px 0 50px; color: white; }
        .hero-label { font-size: 12px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 600; color: var(--red-dirt); margin-bottom: 14px; }
        .insights-hero h1 { font-size: 42px; font-weight: 900; line-height: 1.2; margin-bottom: 16px; }
        .insights-hero p { font-size: 18px; color: rgba(255,255,255,0.75); max-width: 620px; line-height: 1.7; }

        /* Featured */
        .featured-section { padding: 50px 0; border-bottom: 1px solid var(--border); }
        .section-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700; color: #718096; margin-bottom: 20px; }
        .featured-card { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 0; align-items: stretch; background: var(--paper); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
        .featured-image { min-height: 320px; overflow: hidden; }
        .featured-image img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .featured-content { padding: 40px; display: flex; flex-direction: column; justify-content: center; }
        .featured-content h2 { font-size: 26px; font-weight: 900; line-height: 1.3; margin-bottom: 12px; }
        .featured-content h2 a { color: var(--oil-navy); text-decoration: none; }
        .featured-content h2 a:hover { color: var(--red-dirt); }
        .featured-excerpt { font-size: 15px; color: #4A5568; line-height: 1.7; margin-bottom: 16px; }
        .featured-meta { font-size: 13px; color: #718096; }
        .featured-content .read-link { margin-top: 16px; }

        /* Guides Grid */
        .guides-section { padding: 50px 0; border-bottom: 1px solid var(--border); }
        .guides-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 28px; }
        .guides-header h2 { font-size: 24px; font-weight: 900; }
        .guides-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
        .guide-card { border: 1px solid var(--border); border-radius: 6px; overflow: hidden; transition: box-shadow 0.2s, transform 0.15s; text-decoration: none; display: block; }
        .guide-card:hover { box-shadow: 0 8px 24px rgba(0,0,0,0.08); transform: translateY(-2px); }
        .guide-card-icon { background: var(--paper); padding: 28px; display: flex; align-items: center; justify-content: center; border-bottom: 1px solid var(--border); color: var(--slate-blue); }
        .guide-card-body { padding: 22px; }
        .guide-card-body .tag { margin-bottom: 10px; }
        .guide-card-body h3 { font-size: 17px; font-weight: 700; line-height: 1.35; margin-bottom: 8px; color: var(--oil-navy); }
        .guide-card-body p { font-size: 13px; color: #718096; line-height: 1.6; margin-bottom: 12px; }
        .guide-card-body .read-link { margin-top: 0; font-size: 13px; }

        /* County Grid */
        .county-section { padding: 50px 0; border-bottom: 1px solid var(--border); }
        .county-section-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
        .county-section-header h2 { font-size: 24px; font-weight: 900; }
        .county-section-intro { font-size: 15px; color: #4A5568; margin-bottom: 28px; max-width: 680px; line-height: 1.7; }
        .county-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 24px; }
        .county-tile { background: var(--paper); border: 1px solid var(--border); border-radius: 4px; padding: 18px 14px; text-decoration: none; transition: all 0.2s; text-align: center; }
        .county-tile:hover { border-color: var(--red-dirt); background: #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
        .county-tile-name { font-weight: 600; font-size: 14px; color: var(--oil-navy); margin-bottom: 4px; }
        .county-tile-stat { font-size: 12px; color: #718096; }
        .county-tile-stat strong { color: var(--red-dirt); font-weight: 700; }
        .county-tile.featured { border-color: var(--red-dirt); border-width: 2px; background: #fff; }
        .view-all-link { display: inline-flex; align-items: center; gap: 6px; color: var(--red-dirt); font-weight: 600; font-size: 14px; text-decoration: none; }
        .view-all-link:hover { text-decoration: underline; }
        .county-search { width: 100%; padding: 12px 16px 12px 40px; border: 1px solid var(--border); border-radius: 4px; font-size: 15px; font-family: 'Inter', sans-serif; color: var(--oil-navy); margin-bottom: 20px; background: var(--paper) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' fill='none' stroke='%23718096' stroke-width='1.5' viewBox='0 0 24 24'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='M21 21l-4.35-4.35'/%3E%3C/svg%3E") 12px center no-repeat; transition: border-color 0.2s; }
        .county-search:focus { outline: none; border-color: var(--red-dirt); background-color: #fff; }
        .county-tile.hidden { display: none; }
        .county-no-results { display: none; padding: 20px; text-align: center; color: #718096; font-size: 14px; grid-column: 1 / -1; }

        /* Topics */
        .topics-section { padding: 50px 0; border-bottom: 1px solid var(--border); }
        .topics-section h2 { font-size: 24px; font-weight: 900; margin-bottom: 24px; }
        .topics-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
        .topic-card { background: var(--paper); border: 1px solid var(--border); border-radius: 6px; padding: 24px; text-decoration: none; transition: all 0.2s; }
        .topic-card:hover { border-color: var(--red-dirt); background: #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
        .topic-icon { margin-bottom: 12px; color: var(--slate-blue); }
        .topic-card h3 { font-size: 15px; font-weight: 700; color: var(--oil-navy); margin-bottom: 6px; font-family: 'Inter', sans-serif; }
        .topic-card p { font-size: 12px; color: #718096; line-height: 1.5; }
        .topic-count { font-size: 11px; color: var(--red-dirt); font-weight: 600; margin-top: 10px; }

        /* Newsletter CTA */
        .newsletter-section { padding: 60px 0; background: linear-gradient(135deg, var(--oil-navy) 0%, #2D4A5E 100%); color: white; text-align: center; }
        .newsletter-section h2 { font-size: 28px; font-weight: 900; margin-bottom: 12px; }
        .newsletter-section p { font-size: 16px; color: rgba(255,255,255,0.75); margin-bottom: 28px; max-width: 500px; margin-left: auto; margin-right: auto; }
        .newsletter-cta { display: inline-block; padding: 14px 28px; background: var(--red-dirt); color: white; border-radius: 4px; font-size: 15px; font-weight: 600; text-decoration: none; transition: background 0.2s; }
        .newsletter-cta:hover { background: var(--red-dirt-dark); }

        @media (max-width: 768px) {
            .insights-hero h1 { font-size: 30px; }
            .featured-card { grid-template-columns: 1fr; }
            .featured-image { min-height: 180px; }
            .featured-content { padding: 28px; }
            .guides-grid { grid-template-columns: 1fr; }
            .county-grid { grid-template-columns: repeat(2, 1fr); }
            .topics-grid { grid-template-columns: repeat(2, 1fr); }
        }
    </style>
</head>
<body>

    ${HEADER}

    <section class="insights-hero">
        <div class="container">
            <div class="hero-label">Mineral Watch Insights</div>
            <h1>Knowledge That Protects<br>Your Mineral Interests</h1>
            <p>Guides, explainers, and live county data to help Oklahoma mineral owners understand OCC filings, protect their rights, and make informed decisions.</p>
        </div>
    </section>

    <main>

        <!-- Featured Article -->
        <section class="featured-section">
            <div class="container">
                <div class="section-label">Featured</div>
                <div class="featured-card">
                    <div class="featured-image">
                        <img src="/assets/insights/pooling-orders-guide.jpg" alt="Pooling order documents and production data on a desk — representing the complexity of OCC filings for Oklahoma mineral owners" width="896" height="597" loading="eager">
                    </div>
                    <div class="featured-content">
                        <span class="tag tag-guide">Guide</span>
                        <h2><a href="/insights/guides/understanding-pooling-orders">Understanding Pooling Orders: What Oklahoma Mineral Owners Need to Know</a></h2>
                        <p class="featured-excerpt">You just received a letter from the OCC about a pooling order on your section. You have 20 days to respond. Here&rsquo;s what it means, what your options are, and how to protect your interests.</p>
                        <div class="featured-meta">15 min read &middot; Updated Feb 2026</div>
                        <a href="/insights/guides/understanding-pooling-orders" class="read-link">Read the guide &rarr;</a>
                    </div>
                </div>
            </div>
        </section>

        <!-- Guides Grid -->
        <section class="guides-section">
            <div class="container">
                <div class="guides-header">
                    <h2>Essential Guides</h2>
                </div>
                <div class="guides-grid">

                    <a href="/insights/guides/occ-filing-types" class="guide-card">
                        <div class="guide-card-icon">${iconLg('scale')}</div>
                        <div class="guide-card-body">
                            <span class="tag tag-guide">Guide</span>
                            <h3>Every Type of OCC Filing, Explained</h3>
                            <p>Pooling, spacing, increased density, location exceptions, multi-unit horizontals &mdash; what each one means for your minerals.</p>
                            <span class="read-link">Read guide &rarr;</span>
                        </div>
                    </a>

                    <a href="/insights/guides/inherited-mineral-rights" class="guide-card">
                        <div class="guide-card-icon">${iconLg('home')}</div>
                        <div class="guide-card-body">
                            <span class="tag tag-guide">Guide</span>
                            <h3>Inherited Mineral Rights: A Complete Guide</h3>
                            <p>What to do when you inherit mineral rights in Oklahoma. From probate to division orders to monitoring production.</p>
                            <span class="read-link">Read guide &rarr;</span>
                        </div>
                    </a>

                    <a href="/insights/guides/division-orders-101" class="guide-card">
                        <div class="guide-card-icon">${iconLg('document')}</div>
                        <div class="guide-card-body">
                            <span class="tag tag-guide">Guide</span>
                            <h3>Division Orders 101: What to Sign and What to Question</h3>
                            <p>When a new well is completed, you&rsquo;ll receive a division order. Here&rsquo;s how to verify your interest and avoid common mistakes.</p>
                            <span class="read-link">Read guide &rarr;</span>
                        </div>
                    </a>

                    <a href="/insights/guides/navigating-occ-website" class="guide-card">
                        <div class="guide-card-icon">${iconLg('search')}</div>
                        <div class="guide-card-body">
                            <span class="tag tag-regulatory">Regulatory</span>
                            <h3>How to Navigate the OCC Website</h3>
                            <p>The Oklahoma Corporation Commission website is notoriously hard to use. Here&rsquo;s a step-by-step walkthrough for mineral owners.</p>
                            <span class="read-link">Read guide &rarr;</span>
                        </div>
                    </a>

                    <a href="/insights/guides/auditing-royalty-checks" class="guide-card">
                        <div class="guide-card-icon">${iconLg('banknotes')}</div>
                        <div class="guide-card-body">
                            <span class="tag tag-analysis">Analysis</span>
                            <h3>How to Audit Your Royalty Checks</h3>
                            <p>Are you being paid correctly? How to cross-reference your royalty statements against OTC production data and division orders.</p>
                            <span class="read-link">Read guide &rarr;</span>
                        </div>
                    </a>

                    <a href="/insights/guides/scoop-stack-overview" class="guide-card">
                        <div class="guide-card-icon">${iconLg('map')}</div>
                        <div class="guide-card-body">
                            <span class="tag tag-analysis">Analysis</span>
                            <h3>SCOOP &amp; STACK Play Overview for Mineral Owners</h3>
                            <p>What the SCOOP and STACK plays mean for your minerals, which counties are affected, and what kind of activity to expect.</p>
                            <span class="read-link">Read guide &rarr;</span>
                        </div>
                    </a>

                </div>
            </div>
        </section>

        <!-- County Exploration -->
        <section class="county-section">
            <div class="container">
                <div class="county-section-header">
                    <h2>Explore by County</h2>
                    <a href="/counties/" class="view-all-link">View all 77 counties &rarr;</a>
                </div>
                <p class="county-section-intro">Live drilling activity, OCC filings, and operator data for every Oklahoma county. Search or click any county to see recent permits, pooling orders, and top operators.</p>

                <input type="text" class="county-search" id="countySearch" placeholder="Search counties..." autocomplete="off">

                <div class="county-grid" id="countyGrid">
                    <a href="/counties/canadian-county" class="county-tile featured" data-county="canadian"><div class="county-tile-name">Canadian</div></a>
                    <a href="/counties/grady-county" class="county-tile featured" data-county="grady"><div class="county-tile-name">Grady</div></a>
                    <a href="/counties/kingfisher-county" class="county-tile featured" data-county="kingfisher"><div class="county-tile-name">Kingfisher</div></a>
                    <a href="/counties/blaine-county" class="county-tile featured" data-county="blaine"><div class="county-tile-name">Blaine</div></a>
                    <a href="/counties/stephens-county" class="county-tile featured" data-county="stephens"><div class="county-tile-name">Stephens</div></a>
                    <a href="/counties/carter-county" class="county-tile" data-county="carter"><div class="county-tile-name">Carter</div></a>
                    <a href="/counties/garfield-county" class="county-tile" data-county="garfield"><div class="county-tile-name">Garfield</div></a>
                    <a href="/counties/mcclain-county" class="county-tile" data-county="mcclain"><div class="county-tile-name">McClain</div></a>
                    <a href="/counties/caddo-county" class="county-tile" data-county="caddo"><div class="county-tile-name">Caddo</div></a>
                    <a href="/counties/custer-county" class="county-tile" data-county="custer"><div class="county-tile-name">Custer</div></a>
                    <a href="/counties/adair-county" class="county-tile hidden" data-county="adair"><div class="county-tile-name">Adair</div></a>
                    <a href="/counties/alfalfa-county" class="county-tile hidden" data-county="alfalfa"><div class="county-tile-name">Alfalfa</div></a>
                    <a href="/counties/atoka-county" class="county-tile hidden" data-county="atoka"><div class="county-tile-name">Atoka</div></a>
                    <a href="/counties/beaver-county" class="county-tile hidden" data-county="beaver"><div class="county-tile-name">Beaver</div></a>
                    <a href="/counties/beckham-county" class="county-tile hidden" data-county="beckham"><div class="county-tile-name">Beckham</div></a>
                    <a href="/counties/bryan-county" class="county-tile hidden" data-county="bryan"><div class="county-tile-name">Bryan</div></a>
                    <a href="/counties/cherokee-county" class="county-tile hidden" data-county="cherokee"><div class="county-tile-name">Cherokee</div></a>
                    <a href="/counties/choctaw-county" class="county-tile hidden" data-county="choctaw"><div class="county-tile-name">Choctaw</div></a>
                    <a href="/counties/cimarron-county" class="county-tile hidden" data-county="cimarron"><div class="county-tile-name">Cimarron</div></a>
                    <a href="/counties/cleveland-county" class="county-tile hidden" data-county="cleveland"><div class="county-tile-name">Cleveland</div></a>
                    <a href="/counties/coal-county" class="county-tile hidden" data-county="coal"><div class="county-tile-name">Coal</div></a>
                    <a href="/counties/comanche-county" class="county-tile hidden" data-county="comanche"><div class="county-tile-name">Comanche</div></a>
                    <a href="/counties/cotton-county" class="county-tile hidden" data-county="cotton"><div class="county-tile-name">Cotton</div></a>
                    <a href="/counties/craig-county" class="county-tile hidden" data-county="craig"><div class="county-tile-name">Craig</div></a>
                    <a href="/counties/creek-county" class="county-tile hidden" data-county="creek"><div class="county-tile-name">Creek</div></a>
                    <a href="/counties/delaware-county" class="county-tile hidden" data-county="delaware"><div class="county-tile-name">Delaware</div></a>
                    <a href="/counties/dewey-county" class="county-tile hidden" data-county="dewey"><div class="county-tile-name">Dewey</div></a>
                    <a href="/counties/ellis-county" class="county-tile hidden" data-county="ellis"><div class="county-tile-name">Ellis</div></a>
                    <a href="/counties/garvin-county" class="county-tile hidden" data-county="garvin"><div class="county-tile-name">Garvin</div></a>
                    <a href="/counties/grant-county" class="county-tile hidden" data-county="grant"><div class="county-tile-name">Grant</div></a>
                    <a href="/counties/greer-county" class="county-tile hidden" data-county="greer"><div class="county-tile-name">Greer</div></a>
                    <a href="/counties/harmon-county" class="county-tile hidden" data-county="harmon"><div class="county-tile-name">Harmon</div></a>
                    <a href="/counties/harper-county" class="county-tile hidden" data-county="harper"><div class="county-tile-name">Harper</div></a>
                    <a href="/counties/haskell-county" class="county-tile hidden" data-county="haskell"><div class="county-tile-name">Haskell</div></a>
                    <a href="/counties/hughes-county" class="county-tile hidden" data-county="hughes"><div class="county-tile-name">Hughes</div></a>
                    <a href="/counties/jackson-county" class="county-tile hidden" data-county="jackson"><div class="county-tile-name">Jackson</div></a>
                    <a href="/counties/jefferson-county" class="county-tile hidden" data-county="jefferson"><div class="county-tile-name">Jefferson</div></a>
                    <a href="/counties/johnston-county" class="county-tile hidden" data-county="johnston"><div class="county-tile-name">Johnston</div></a>
                    <a href="/counties/kay-county" class="county-tile hidden" data-county="kay"><div class="county-tile-name">Kay</div></a>
                    <a href="/counties/kiowa-county" class="county-tile hidden" data-county="kiowa"><div class="county-tile-name">Kiowa</div></a>
                    <a href="/counties/latimer-county" class="county-tile hidden" data-county="latimer"><div class="county-tile-name">Latimer</div></a>
                    <a href="/counties/le-flore-county" class="county-tile hidden" data-county="le flore"><div class="county-tile-name">Le Flore</div></a>
                    <a href="/counties/lincoln-county" class="county-tile hidden" data-county="lincoln"><div class="county-tile-name">Lincoln</div></a>
                    <a href="/counties/logan-county" class="county-tile hidden" data-county="logan"><div class="county-tile-name">Logan</div></a>
                    <a href="/counties/love-county" class="county-tile hidden" data-county="love"><div class="county-tile-name">Love</div></a>
                    <a href="/counties/major-county" class="county-tile hidden" data-county="major"><div class="county-tile-name">Major</div></a>
                    <a href="/counties/marshall-county" class="county-tile hidden" data-county="marshall"><div class="county-tile-name">Marshall</div></a>
                    <a href="/counties/mayes-county" class="county-tile hidden" data-county="mayes"><div class="county-tile-name">Mayes</div></a>
                    <a href="/counties/mccurtain-county" class="county-tile hidden" data-county="mccurtain"><div class="county-tile-name">McCurtain</div></a>
                    <a href="/counties/mcintosh-county" class="county-tile hidden" data-county="mcintosh"><div class="county-tile-name">McIntosh</div></a>
                    <a href="/counties/murray-county" class="county-tile hidden" data-county="murray"><div class="county-tile-name">Murray</div></a>
                    <a href="/counties/muskogee-county" class="county-tile hidden" data-county="muskogee"><div class="county-tile-name">Muskogee</div></a>
                    <a href="/counties/noble-county" class="county-tile hidden" data-county="noble"><div class="county-tile-name">Noble</div></a>
                    <a href="/counties/nowata-county" class="county-tile hidden" data-county="nowata"><div class="county-tile-name">Nowata</div></a>
                    <a href="/counties/okfuskee-county" class="county-tile hidden" data-county="okfuskee"><div class="county-tile-name">Okfuskee</div></a>
                    <a href="/counties/oklahoma-county" class="county-tile hidden" data-county="oklahoma"><div class="county-tile-name">Oklahoma</div></a>
                    <a href="/counties/okmulgee-county" class="county-tile hidden" data-county="okmulgee"><div class="county-tile-name">Okmulgee</div></a>
                    <a href="/counties/osage-county" class="county-tile hidden" data-county="osage"><div class="county-tile-name">Osage</div></a>
                    <a href="/counties/ottawa-county" class="county-tile hidden" data-county="ottawa"><div class="county-tile-name">Ottawa</div></a>
                    <a href="/counties/pawnee-county" class="county-tile hidden" data-county="pawnee"><div class="county-tile-name">Pawnee</div></a>
                    <a href="/counties/payne-county" class="county-tile hidden" data-county="payne"><div class="county-tile-name">Payne</div></a>
                    <a href="/counties/pittsburg-county" class="county-tile hidden" data-county="pittsburg"><div class="county-tile-name">Pittsburg</div></a>
                    <a href="/counties/pontotoc-county" class="county-tile hidden" data-county="pontotoc"><div class="county-tile-name">Pontotoc</div></a>
                    <a href="/counties/pottawatomie-county" class="county-tile hidden" data-county="pottawatomie"><div class="county-tile-name">Pottawatomie</div></a>
                    <a href="/counties/pushmataha-county" class="county-tile hidden" data-county="pushmataha"><div class="county-tile-name">Pushmataha</div></a>
                    <a href="/counties/roger-mills-county" class="county-tile hidden" data-county="roger mills"><div class="county-tile-name">Roger Mills</div></a>
                    <a href="/counties/rogers-county" class="county-tile hidden" data-county="rogers"><div class="county-tile-name">Rogers</div></a>
                    <a href="/counties/seminole-county" class="county-tile hidden" data-county="seminole"><div class="county-tile-name">Seminole</div></a>
                    <a href="/counties/sequoyah-county" class="county-tile hidden" data-county="sequoyah"><div class="county-tile-name">Sequoyah</div></a>
                    <a href="/counties/texas-county" class="county-tile hidden" data-county="texas"><div class="county-tile-name">Texas</div></a>
                    <a href="/counties/tillman-county" class="county-tile hidden" data-county="tillman"><div class="county-tile-name">Tillman</div></a>
                    <a href="/counties/tulsa-county" class="county-tile hidden" data-county="tulsa"><div class="county-tile-name">Tulsa</div></a>
                    <a href="/counties/wagoner-county" class="county-tile hidden" data-county="wagoner"><div class="county-tile-name">Wagoner</div></a>
                    <a href="/counties/washington-county" class="county-tile hidden" data-county="washington"><div class="county-tile-name">Washington</div></a>
                    <a href="/counties/washita-county" class="county-tile hidden" data-county="washita"><div class="county-tile-name">Washita</div></a>
                    <a href="/counties/woods-county" class="county-tile hidden" data-county="woods"><div class="county-tile-name">Woods</div></a>
                    <a href="/counties/woodward-county" class="county-tile hidden" data-county="woodward"><div class="county-tile-name">Woodward</div></a>
                    <div class="county-no-results" id="countyNoResults">No counties match your search.</div>
                </div>

                <a href="/counties/" class="view-all-link" id="viewAllLink">See all 77 Oklahoma counties &rarr;</a>
            </div>
        </section>

        <!-- Browse by Topic -->
        <section class="topics-section">
            <div class="container">
                <h2>Browse by Topic</h2>
                <div class="topics-grid">
                    <a href="/insights/guides/understanding-pooling-orders" class="topic-card">
                        <div class="topic-icon">${iconMd('scale')}</div>
                        <h3>Pooling Orders</h3>
                        <p>Forced pooling, bonus rates, election options, and response deadlines.</p>
                        <div class="topic-count">1 guide</div>
                    </a>
                    <a href="/insights/guides/auditing-royalty-checks" class="topic-card">
                        <div class="topic-icon">${iconMd('banknotes')}</div>
                        <h3>Production &amp; Royalties</h3>
                        <p>Royalty calculations, production reports, audit techniques, and operator payments.</p>
                        <div class="topic-count">Coming soon</div>
                    </a>
                    <a href="/insights/guides/occ-filing-types" class="topic-card">
                        <div class="topic-icon">${iconMd('building')}</div>
                        <h3>OCC &amp; Regulatory</h3>
                        <p>OCC filing types, docket navigation, spacing orders, and regulatory changes.</p>
                        <div class="topic-count">Coming soon</div>
                    </a>
                    <a href="/insights/guides/inherited-mineral-rights" class="topic-card">
                        <div class="topic-icon">${iconMd('bookOpen')}</div>
                        <h3>Getting Started</h3>
                        <p>Inherited minerals, first-time owners, division orders, and understanding your rights.</p>
                        <div class="topic-count">Coming soon</div>
                    </a>
                </div>
            </div>
        </section>

    </main>

    <!-- CTA -->
    <section class="newsletter-section">
        <div class="container">
            <h2>Your Minerals Deserve Better</h2>
            <p>Pooling order data, production tracking, OCC alerts, AI document extraction, reports &amp; analysis, and interactive mapping &mdash; all in one platform.</p>
            <a href="https://portal.mymineralwatch.com/" class="newsletter-cta">Start Free &rarr;</a>
        </div>
    </section>

    ${FOOTER}
    ${MENU_SCRIPT}
    <script>
    (function() {
        var input = document.getElementById('countySearch');
        var grid = document.getElementById('countyGrid');
        var tiles = grid.querySelectorAll('.county-tile');
        var noResults = document.getElementById('countyNoResults');
        var top10 = ['canadian','grady','kingfisher','blaine','stephens','carter','garfield','mcclain','caddo','custer'];
        input.addEventListener('input', function() {
            var q = this.value.toLowerCase().trim();
            var matches = 0;
            for (var i = 0; i < tiles.length; i++) {
                var name = tiles[i].getAttribute('data-county');
                if (!q) {
                    tiles[i].classList.toggle('hidden', top10.indexOf(name) === -1);
                    if (top10.indexOf(name) !== -1) matches++;
                } else if (name.indexOf(q) !== -1) {
                    tiles[i].classList.remove('hidden');
                    matches++;
                } else {
                    tiles[i].classList.add('hidden');
                }
            }
            noResults.style.display = matches === 0 ? 'block' : 'none';
        });
    })();
    </script>

</body>
</html>`;
}

// ════════════════════════════════════════════
//  ARTICLE RENDERER
// ════════════════════════════════════════════

interface Article {
  slug: string;
  title: string;
  description: string;
  canonical: string;
  ogImage: string;
  tag: string;
  tagClass: string;
  author: string;
  authorTitle: string;
  readTime: string;
  updated: string;
  breadcrumb: string;
  body: string;
  toc: { id: string; label: string }[];
  related: { href: string; label: string }[];
  ctaTitle: string;
  ctaText: string;
  featuredImage?: { src: string; alt: string; width: number; height: number; objectPosition?: string };
  jsonLdExtra?: string;
}

const ARTICLES: Record<string, Article> = {
  'understanding-pooling-orders': {
    slug: 'understanding-pooling-orders',
    title: 'Understanding Pooling Orders: What Oklahoma Mineral Owners Need to Know',
    description: 'A complete guide to Oklahoma pooling orders for mineral owners. Learn what a pooling order means, your election options, how to evaluate bonus rates, common mistakes, and when to hire an attorney.',
    canonical: 'https://mymineralwatch.com/insights/guides/understanding-pooling-orders',
    ogImage: 'https://mymineralwatch.com/assets/insights/pooling-orders-guide.jpg',
    tag: 'Essential Guide',
    tagClass: 'tag-guide',
    author: 'James Price',
    authorTitle: 'Founder of Mineral Watch',
    readTime: '15 min read',
    updated: 'Updated February 2026',
    breadcrumb: 'Understanding Pooling Orders',
    featuredImage: {
      src: '/assets/insights/pooling-orders-guide.jpg',
      alt: 'Pooling order documents on a desk with Oklahoma map and production data, representing the complexity of OCC filings for mineral rights owners.',
      width: 896,
      height: 597,
    },
    toc: [
      { id: 'what-is-pooling', label: 'What Is a Pooling Order?' },
      { id: 'why-you-received', label: 'Why You Received One' },
      { id: 'the-deadline', label: 'The 20-Day Deadline' },
      { id: 'election-options', label: 'Your Election Options' },
      { id: 'how-to-evaluate', label: 'How to Evaluate Your Options' },
      { id: 'voluntary-lease', label: 'Negotiating a Voluntary Lease' },
      { id: 'common-mistakes', label: 'Common Mistakes' },
      { id: 'when-to-hire-attorney', label: 'When to Hire an Attorney' },
      { id: 'after-election', label: 'After You Make Your Election' },
      { id: 'faq', label: 'FAQ' },
    ],
    related: [
      { href: '/insights/guides/occ-filing-types', label: 'Every Type of OCC Filing, Explained' },
      { href: '/insights/guides/division-orders-101', label: 'Division Orders 101' },
      { href: '/insights/guides/inherited-mineral-rights', label: 'Inherited Mineral Rights Guide' },
      { href: '/insights/guides/auditing-royalty-checks', label: 'How to Audit Your Royalty Checks' },
    ],
    ctaTitle: "Don't Let a Deadline Catch You Off Guard",
    ctaText: 'Pooling order data, production tracking, OCC alerts, and AI document extraction — know what\u2019s happening on your sections before the letter arrives.',
    jsonLdExtra: `
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": [
        { "@type": "Question", "name": "What is a pooling order in Oklahoma?", "acceptedAnswer": { "@type": "Answer", "text": "A pooling order is a legal mechanism used by the Oklahoma Corporation Commission to combine all mineral interests within a designated drilling unit so that an operator can drill a well. If a mineral owner has not voluntarily signed a lease, the OCC can pool their interest and give them a set of election options to participate in or be compensated for the well." } },
        { "@type": "Question", "name": "How long do I have to respond to a pooling order?", "acceptedAnswer": { "@type": "Answer", "text": "You typically have 20 days from the date the pooling order is issued to make your election. If you do not respond within this window, you will be assigned the default election option specified in the order, which is often the least favorable option for the mineral owner." } },
        { "@type": "Question", "name": "What happens if I don't respond to a pooling order?", "acceptedAnswer": { "@type": "Answer", "text": "If you fail to respond within the deadline, you are automatically assigned the default election option. In most cases, this is a cash bonus option at a rate set by the operator, which may be significantly below market value. You lose the ability to choose a more favorable participation option." } },
        { "@type": "Question", "name": "Should I hire an attorney for a pooling order?", "acceptedAnswer": { "@type": "Answer", "text": "It depends on the value of your mineral interest. If you own a significant net mineral acres position in the pooled section, the financial impact of your election can be substantial, and an oil and gas attorney can help you evaluate your options, negotiate better terms, or protest the order if appropriate." } },
        { "@type": "Question", "name": "Can I negotiate the bonus rate on a pooling order?", "acceptedAnswer": { "@type": "Answer", "text": "Not directly through the pooling order itself — the bonus rates are set in the order. However, you can negotiate a voluntary lease with the operator before or even during the pooling process, which often results in better terms than the pooling order options." } },
        { "@type": "Question", "name": "What is the difference between forced pooling and voluntary leasing?", "acceptedAnswer": { "@type": "Answer", "text": "Voluntary leasing is a private agreement between you and an operator where you negotiate the bonus, royalty rate, and lease terms. Forced pooling through a pooling order is a legal process where the OCC compels your participation in a drilling unit because you and the operator could not reach a voluntary agreement. Pooling order terms are typically less favorable than a well-negotiated lease." } }
      ]
    }
    </script>`,
    get body() { return POOLING_ORDERS_BODY; },
  },
  'inherited-mineral-rights': {
    slug: 'inherited-mineral-rights',
    title: 'Inherited Mineral Rights in Oklahoma: A Complete Guide',
    description: 'Just inherited mineral rights in Oklahoma? This complete guide walks you through what you own, how to confirm your interest, what to do with royalty checks, and how to protect your inheritance.',
    canonical: 'https://mymineralwatch.com/insights/guides/inherited-mineral-rights',
    ogImage: 'https://mymineralwatch.com/assets/insights/inherited-mineral-rights-guide.jpg',
    tag: 'Essential Guide',
    tagClass: 'tag-guide',
    author: 'James Price',
    authorTitle: 'Founder of Mineral Watch',
    readTime: '18 min read',
    updated: 'Updated February 2026',
    breadcrumb: 'Inherited Mineral Rights',
    featuredImage: {
      src: '/assets/insights/inherited-mineral-rights-guide.jpg',
      alt: 'Kitchen table with vintage family photograph, mineral deed documents, reading glasses, and a laptop showing a county map — representing the process of inheriting mineral rights.',
      width: 1100,
      height: 620,
    },
    toc: [
      { id: 'what-are-mineral-rights', label: 'What Are Mineral Rights?' },
      { id: 'first-steps', label: 'First Steps After Inheriting' },
      { id: 'establishing-ownership', label: 'Establishing Your Ownership' },
      { id: 'figuring-out-what-you-own', label: 'Figuring Out What You Own' },
      { id: 'royalty-checks', label: 'Understanding Royalty Checks' },
      { id: 'taxes', label: 'Tax Implications' },
      { id: 'protecting-your-inheritance', label: 'Protecting Your Inheritance' },
      { id: 'common-mistakes', label: 'Common Mistakes' },
      { id: 'when-to-get-help', label: 'When to Get Professional Help' },
      { id: 'faq', label: 'FAQ' },
    ],
    related: [
      { href: '/insights/guides/understanding-pooling-orders', label: 'Understanding Pooling Orders' },
      { href: '/insights/guides/division-orders-101', label: 'Division Orders 101' },
      { href: '/insights/guides/occ-filing-types', label: 'Every Type of OCC Filing, Explained' },
      { href: '/insights/guides/auditing-royalty-checks', label: 'How to Audit Your Royalty Checks' },
    ],
    ctaTitle: 'Protect What Your Family Built',
    ctaText: 'Monitor your inherited Oklahoma mineral rights for new drilling activity, pooling orders, and production changes \u2014 know what\u2019s happening on your sections before deadlines pass.',
    jsonLdExtra: `
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": [
        { "@type": "Question", "name": "How do I find out if I inherited mineral rights in Oklahoma?", "acceptedAnswer": { "@type": "Answer", "text": "Start by reviewing the deceased person's estate documents, including their will, trust, and any prior deeds. Check for royalty check stubs, lease agreements, or division orders in their records. You can also search the county clerk's records in the county where the minerals are located by looking up deeds and mineral conveyances under their name." } },
        { "@type": "Question", "name": "Do I need to go through probate to inherit mineral rights in Oklahoma?", "acceptedAnswer": { "@type": "Answer", "text": "In most cases, yes. If the mineral rights were held in the deceased person's individual name and not in a trust or joint tenancy, probate is typically required to legally transfer ownership. Oklahoma allows both formal probate and a simplified summary probate process for smaller estates." } },
        { "@type": "Question", "name": "How do I transfer mineral rights after someone dies in Oklahoma?", "acceptedAnswer": { "@type": "Answer", "text": "The most common methods are probate, an affidavit of heirship, or a trust distribution. Once you have the legal document transferring ownership, it should be recorded with the county clerk in every county where the minerals are located." } },
        { "@type": "Question", "name": "Do I have to pay taxes on inherited mineral rights in Oklahoma?", "acceptedAnswer": { "@type": "Answer", "text": "Inheriting mineral rights is generally not a taxable event — you receive a stepped-up cost basis. However, any royalty income you receive is taxable as ordinary income. Oklahoma also has a gross production tax that is typically withheld by the operator." } },
        { "@type": "Question", "name": "What is a division order and should I sign it?", "acceptedAnswer": { "@type": "Answer", "text": "A division order states your decimal ownership interest in a well and authorizes the operator to pay you royalties. Verify that the decimal interest is correct before signing. Signing a division order does not change your actual ownership." } },
        { "@type": "Question", "name": "Can I sell inherited mineral rights?", "acceptedAnswer": { "@type": "Answer", "text": "Yes, but most professionals recommend caution. Mineral rights are an appreciating, income-producing asset that can generate royalties for decades. Buyers typically offer a fraction of the long-term value. If you consider selling, get multiple offers and have an attorney review any purchase agreement." } },
        { "@type": "Question", "name": "What happens to my mineral rights if there is no will?", "acceptedAnswer": { "@type": "Answer", "text": "Oklahoma's intestate succession laws determine who inherits. Generally, the surviving spouse and children inherit in specific proportions defined by state law. An intestate probate proceeding or determination of heirship is typically required." } }
      ]
    }
    </script>`,
    get body() { return INHERITED_MINERAL_RIGHTS_BODY; },
  },
  'occ-filing-types': {
    slug: 'occ-filing-types',
    title: 'Every Type of OCC Filing, Explained: A Guide for Oklahoma Mineral Owners',
    description: 'A complete reference guide to Oklahoma Corporation Commission filing types. Learn what permits, pooling orders, spacing applications, increased density orders, and other OCC filings mean for your mineral rights.',
    canonical: 'https://mymineralwatch.com/insights/guides/occ-filing-types',
    ogImage: 'https://mymineralwatch.com/assets/insights/occ-filing-types-guide.jpg',
    tag: 'Reference Guide',
    tagClass: 'tag-regulatory',
    author: 'James Price',
    authorTitle: 'Founder of Mineral Watch',
    readTime: '14 min read',
    updated: 'Updated February 2026',
    breadcrumb: 'OCC Filing Types',
    featuredImage: {
      src: '/assets/insights/occ-filing-types-guide.jpg',
      alt: 'Official government documents with filing stamps arranged on a desk, representing the various types of Oklahoma Corporation Commission filings that affect mineral rights owners.',
      width: 1100,
      height: 620,
      objectPosition: 'center 30%',
    },
    toc: [
      { id: 'quick-reference', label: 'Quick Reference Table' },
      { id: 'lifecycle', label: 'The Lifecycle of a Well' },
      { id: 'spacing', label: 'Spacing Applications & Orders' },
      { id: 'pooling', label: 'Pooling Applications & Orders' },
      { id: 'permits', label: 'Intent to Drill (Form 1000)' },
      { id: 'increased-density', label: 'Increased Density' },
      { id: 'location-exception', label: 'Location Exceptions' },
      { id: 'completion', label: 'Completion Reports' },
      { id: 'multi-unit', label: 'Multi-Unit Horizontal Wells' },
      { id: 'transfers', label: 'Operator Transfers' },
      { id: 'plug-abandon', label: 'Plugging & Abandonment' },
      { id: 'other-filings', label: 'Other Filing Types' },
      { id: 'faq', label: 'FAQ' },
    ],
    related: [
      { href: '/insights/guides/understanding-pooling-orders', label: 'Understanding Pooling Orders' },
      { href: '/insights/guides/inherited-mineral-rights', label: 'Inherited Mineral Rights Guide' },
      { href: '/insights/guides/division-orders-101', label: 'Division Orders 101' },
      { href: '/insights/guides/auditing-royalty-checks', label: 'How to Audit Your Royalty Checks' },
    ],
    ctaTitle: "The Filing That Matters Most Is the One You Don\u2019t Know About",
    ctaText: 'Monitor your Oklahoma sections for every OCC filing type \u2014 permits, pooling orders, completions, and more.',
    jsonLdExtra: `
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": [
        { "@type": "Question", "name": "What is the Oklahoma Corporation Commission?", "acceptedAnswer": { "@type": "Answer", "text": "The Oklahoma Corporation Commission (OCC) is a state agency that regulates the oil and gas industry in Oklahoma. For mineral owners, the OCC is the body that issues drilling permits, establishes spacing and drilling units, approves pooling orders, and oversees well operations." } },
        { "@type": "Question", "name": "How do I find OCC filings on my property?", "acceptedAnswer": { "@type": "Answer", "text": "You can search OCC filings through the Commission's online docket system and well records database. Search by section, township, and range to find filings related to your property. Mineral Watch provides automated monitoring that alerts you when new filings appear on your sections." } },
        { "@type": "Question", "name": "What is the difference between a spacing order and a pooling order?", "acceptedAnswer": { "@type": "Answer", "text": "A spacing order establishes the drilling unit — it defines the geographic boundaries. A pooling order comes after spacing and combines all the mineral interests within that unit so the operator can proceed with drilling. Spacing sets the boundaries; pooling addresses the ownership within those boundaries." } },
        { "@type": "Question", "name": "What does an Intent to Drill (Form 1000) mean for mineral owners?", "acceptedAnswer": { "@type": "Answer", "text": "An Intent to Drill means an operator has received approval to drill a specific well. Drilling is imminent — typically within weeks to months. If you haven't been contacted about leasing, expect a pooling application to follow." } },
        { "@type": "Question", "name": "What is an increased density order in Oklahoma?", "acceptedAnswer": { "@type": "Answer", "text": "An increased density order allows an operator to drill additional wells in a section beyond what the original spacing order permitted. This is common in active plays where operators drill multiple horizontal wells targeting different formations." } },
        { "@type": "Question", "name": "Do I need to respond to every OCC filing on my section?", "acceptedAnswer": { "@type": "Answer", "text": "No. The filing that requires action is a pooling order, which gives you a 20-day deadline. Spacing and increased density applications have optional hearings. Other filings like permits and completions are informational." } }
      ]
    }
    </script>`,
    get body() { return OCC_FILING_TYPES_BODY; },
  },
  'division-orders-101': {
    slug: 'division-orders-101',
    title: 'Division Orders 101: What Oklahoma Mineral Owners Need to Know',
    description: 'A complete guide to division orders for Oklahoma mineral owners. Learn what a division order is, how to verify your decimal interest, whether to sign it, and what to do if the numbers look wrong.',
    canonical: 'https://mymineralwatch.com/insights/guides/division-orders-101',
    ogImage: 'https://mymineralwatch.com/assets/insights/division-orders-guide.jpg',
    tag: 'Essential Guide',
    tagClass: 'tag-guide',
    author: 'James Price',
    authorTitle: 'Founder of Mineral Watch',
    readTime: '12 min read',
    updated: 'Updated February 2026',
    breadcrumb: 'Division Orders 101',
    featuredImage: {
      src: '/assets/insights/division-orders-guide.jpg',
      alt: 'A desk with a division order document, calculator, pen, and laptop showing production data — representing the process of verifying and signing a division order.',
      width: 1100,
      height: 620,
    },
    toc: [
      { id: 'what-is-division-order', label: 'What Is a Division Order?' },
      { id: 'anatomy', label: 'Anatomy of a Division Order' },
      { id: 'decimal-interest', label: 'Understanding Your Decimal' },
      { id: 'should-you-sign', label: 'Should You Sign It?' },
      { id: 'verification-checklist', label: 'Verification Checklist' },
      { id: 'common-issues', label: 'Common Issues' },
      { id: 'division-orders-vs-leases', label: 'DOs vs. Leases vs. Pooling' },
      { id: 'suspense', label: 'Payments in Suspense' },
      { id: 'keeping-records', label: 'Keeping Good Records' },
      { id: 'faq', label: 'FAQ' },
    ],
    related: [
      { href: '/insights/guides/understanding-pooling-orders', label: 'Understanding Pooling Orders' },
      { href: '/insights/guides/inherited-mineral-rights', label: 'Inherited Mineral Rights Guide' },
      { href: '/insights/guides/occ-filing-types', label: 'Every Type of OCC Filing, Explained' },
      { href: '/insights/guides/auditing-royalty-checks', label: 'How to Audit Your Royalty Checks' },
    ],
    ctaTitle: 'Know When New Wells Come Online',
    ctaText: 'Monitor your Oklahoma sections for drilling permits, completions, and production changes. Division orders follow completions \u2014 stay ahead of the paperwork.',
    jsonLdExtra: `
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": [
        { "@type": "Question", "name": "What is a division order?", "acceptedAnswer": { "@type": "Answer", "text": "A division order is a document sent by an oil and gas operator that states your decimal ownership interest in a specific well and authorizes the operator to distribute royalty payments to you. It is primarily an administrative document." } },
        { "@type": "Question", "name": "Should I sign a division order?", "acceptedAnswer": { "@type": "Answer", "text": "Generally yes, but only after verifying that the decimal interest is correct. Under Oklahoma law, signing a division order does not change your actual ownership. However, if the decimal is wrong, contact the operator to dispute it before signing." } },
        { "@type": "Question", "name": "How is my decimal interest calculated on a division order?", "acceptedAnswer": { "@type": "Answer", "text": "Your decimal interest is calculated by dividing your net mineral acres by the total acres in the drilling unit, then multiplying by your royalty rate. For multi-section horizontal wells, the calculation also factors in the percentage of the lateral that crosses each section." } },
        { "@type": "Question", "name": "What happens if I don't sign a division order?", "acceptedAnswer": { "@type": "Answer", "text": "The operator may hold your royalty payments in suspense until the issue is resolved. Under Oklahoma law, operators are required to pay royalties within certain timeframes regardless, but unsigned division orders often result in delayed payments." } },
        { "@type": "Question", "name": "Can a division order change my ownership?", "acceptedAnswer": { "@type": "Answer", "text": "No. Under Oklahoma's Division Order Act, a division order is not a transfer of ownership. Your actual ownership is determined by your deeds, probate decrees, and other title documents recorded at the county clerk's office." } },
        { "@type": "Question", "name": "Why did my decimal interest change on a new division order?", "acceptedAnswer": { "@type": "Answer", "text": "Common reasons include a title correction, a new well with different unit size or lateral allocation, a change in royalty rate, or the addition of new owners that reduced your proportional share. Always ask the operator to explain any changes." } }
      ]
    }
    </script>`,
    get body() { return DIVISION_ORDERS_BODY; },
  },
  'navigating-occ-website': {
    slug: 'navigating-occ-website',
    title: 'How to Navigate the OCC Website: A Mineral Owner\u2019s Guide to Oklahoma Corporation Commission Online Tools',
    description: 'Step-by-step guide to using the Oklahoma Corporation Commission website. Learn how to search well records, find spacing and pooling orders, look up drilling permits, and monitor filings on your mineral sections.',
    canonical: 'https://mymineralwatch.com/insights/guides/navigating-occ-website',
    ogImage: 'https://mymineralwatch.com/assets/insights/navigating-occ-website-guide.jpg',
    tag: 'Guide',
    tagClass: 'tag-guide',
    author: 'James Price',
    authorTitle: 'Founder of Mineral Watch',
    readTime: '20 min read',
    updated: 'Updated February 2026',
    breadcrumb: 'Navigating the OCC Website',
    featuredImage: {
      src: '/assets/insights/navigating-occ-website-guide.jpg',
      alt: 'Screenshot collage of the Oklahoma Corporation Commission website tools including Well Browse, Well Data Finder, and Electronic Case Filing system.',
      width: 1344,
      height: 768,
    },
    toc: [
      { id: 'quick-reference', label: 'Quick Reference Table' },
      { id: 'well-browse', label: 'Well Browse Database' },
      { id: 'well-data-finder', label: 'Well Data Finder (GIS)' },
      { id: 'ecf', label: 'Electronic Case Filing' },
      { id: 'case-processing', label: 'Case Processing (Pre-2022)' },
      { id: 'imaging', label: 'OCC Imaging System' },
      { id: 'data-explorer', label: 'RBDMS Data Explorer' },
      { id: 'dockets', label: 'Weekly & Daily Dockets' },
      { id: 'common-tasks', label: 'Common Tasks' },
      { id: 'forms-reference', label: 'Key OCC Forms' },
      { id: 'okies', label: 'What\u2019s Changing: OKIES' },
      { id: 'limitations', label: 'Limitations' },
      { id: 'faq', label: 'FAQ' },
    ],
    related: [
      { href: '/insights/guides/occ-filing-types', label: 'Every Type of OCC Filing, Explained' },
      { href: '/insights/guides/understanding-pooling-orders', label: 'Understanding Pooling Orders' },
      { href: '/insights/guides/division-orders-101', label: 'Division Orders 101' },
      { href: '/insights/guides/inherited-mineral-rights', label: 'Inherited Mineral Rights Guide' },
    ],
    ctaTitle: 'Let the OCC Come to You',
    ctaText: 'Instead of manually searching multiple OCC databases, Mineral Watch monitors your sections automatically and sends you alerts when new filings appear. Free for up to 5 sections.',
    jsonLdExtra: `
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": [
        { "@type": "Question", "name": "How do I search for wells on my section at the OCC?", "acceptedAnswer": { "@type": "Answer", "text": "The fastest way is to use the OCC Well Browse Database at wellbrowse.occ.ok.gov. Enter your section, township, and range in the legal description fields at the bottom of the search form, then click Search. The results will show every well on record for that section, including active, plugged, and permitted wells. You can also use the Well Data Finder, a GIS-based map tool, to visually locate wells on your section." } },
        { "@type": "Question", "name": "Where do I find spacing and pooling orders for my section?", "acceptedAnswer": { "@type": "Answer", "text": "Spacing and pooling applications are filed as Conservation Docket (CD) cases. For cases filed after March 21, 2022, search the Electronic Case Filing (ECF) system at ecf.public.occ.ok.gov. Select 'Oil & Gas' as the Program Area and 'Conservation Docket' as the Docket Type. For older cases filed before March 2022, use the Case Processing system at case.occ.ok.gov." } },
        { "@type": "Question", "name": "How do I look up a drilling permit on the OCC website?", "acceptedAnswer": { "@type": "Answer", "text": "Drilling permits are Form 1000 filings. You can find them in the Well Browse Database by searching for your section. To view the actual Form 1000 document, use the OCC Imaging system at imaging.occ.ok.gov, select 'Oil and Gas Well Records Forms,' choose Form 1000, and search by API number or legal description." } },
        { "@type": "Question", "name": "What is the difference between Well Browse and Well Data Finder?", "acceptedAnswer": { "@type": "Answer", "text": "Well Browse is a traditional database search that returns detailed tabular results. Well Data Finder is a GIS-based map application that shows wells as points on a map. Both access the same underlying OCC well data." } },
        { "@type": "Question", "name": "How do I find completion reports for wells on my section?", "acceptedAnswer": { "@type": "Answer", "text": "Completion reports (Form 1002A) can be found in the Well Browse Database by clicking the 'Completions' button on a well record. To view the scanned document, use the OCC Imaging system, select 'Oil and Gas Well Records Forms,' choose Form 1002A, and search by API number." } },
        { "@type": "Question", "name": "What is the OCC Electronic Case Filing system?", "acceptedAnswer": { "@type": "Answer", "text": "The Electronic Case Filing (ECF) system is the OCC's current case management platform, launched on March 21, 2022. It replaced the older Case Processing system for all new filings. ECF allows the public to search for and view case documents including spacing applications, pooling orders, and other Conservation Docket cases." } },
        { "@type": "Question", "name": "How do I check production data for a well in Oklahoma?", "acceptedAnswer": { "@type": "Answer", "text": "The OCC Well Browse Database includes production data for gas wells under the 'Production' tab. For oil production and gross production tax data, the Oklahoma Tax Commission is the primary source. The RBDMS Data Explorer on the OCC website also provides production reports." } }
      ]
    }
    </script>`,
    get body() { return NAVIGATING_OCC_WEBSITE_BODY; },
  },
};

export function renderArticle(slug: string): string | null {
  const article = ARTICLES[slug];
  if (!article) return null;

  const tocHtml = article.toc.map(t =>
    `<a href="#${t.id}" class="toc-link">${esc(t.label)}</a>`
  ).join('\n');

  const relatedHtml = article.related.map(r =>
    `<a href="${r.href}" class="related-link">${esc(r.label)} &rarr;</a>`
  ).join('\n');

  const imageHtml = article.featuredImage
    ? `<div class="article-image"><img src="${article.featuredImage.src}" alt="${esc(article.featuredImage.alt)}" width="${article.featuredImage.width}" height="${article.featuredImage.height}" loading="eager"${article.featuredImage.objectPosition ? ` style="object-position:${article.featuredImage.objectPosition}"` : ''}></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(article.title)} | Mineral Watch</title>
    <meta name="description" content="${esc(article.description)}">
    <link rel="canonical" href="${article.canonical}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${article.canonical}">
    <meta property="og:title" content="${esc(article.title)}">
    <meta property="og:description" content="${esc(article.description)}">
    <meta property="og:image" content="${article.ogImage}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${esc(article.title)}">
    <meta name="twitter:description" content="${esc(article.description)}">
    <meta name="twitter:image" content="${article.ogImage}">
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Article",
      "headline": "${esc(article.title)}",
      "description": "${esc(article.description)}",
      "url": "${article.canonical}",
      "datePublished": "2026-02-13",
      "dateModified": "2026-02-13",
      "author": { "@type": "Person", "name": "${esc(article.author)}", "jobTitle": "Founder", "worksFor": { "@type": "Organization", "name": "Mineral Watch" } },
      "publisher": { "@type": "Organization", "name": "Mineral Watch", "url": "https://mymineralwatch.com" },
      "mainEntityOfPage": { "@type": "WebPage", "@id": "${article.canonical}" }
    }
    </script>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://mymineralwatch.com/" },
        { "@type": "ListItem", "position": 2, "name": "Insights", "item": "https://mymineralwatch.com/insights" },
        { "@type": "ListItem", "position": 3, "name": "Guides", "item": "https://mymineralwatch.com/insights/guides" },
        { "@type": "ListItem", "position": 4, "name": "${esc(article.breadcrumb)}", "item": "${article.canonical}" }
      ]
    }
    </script>
    ${article.jsonLdExtra || ''}
    ${FONT_LINK}
    <style>
        ${CSS_VARS}
        ${CSS_BASE}

        /* Breadcrumb */
        .breadcrumb { padding: 16px 0; font-size: 13px; color: #718096; border-bottom: 1px solid var(--border); }
        .breadcrumb a { color: var(--slate-blue); text-decoration: none; }
        .breadcrumb a:hover { color: var(--oil-navy); text-decoration: underline; }
        .breadcrumb span { margin: 0 8px; color: #CBD5E0; }

        /* Article Header */
        .article-hero { padding: 50px 0 0; }
        .article-hero-inner { max-width: 760px; }
        .article-hero h1 { font-size: 38px; font-weight: 900; line-height: 1.25; margin-bottom: 18px; color: var(--oil-navy); }
        .article-lede { font-size: 19px; color: #4A5568; line-height: 1.7; margin-bottom: 24px; }
        .article-meta { display: flex; align-items: center; gap: 20px; font-size: 14px; color: #718096; padding-bottom: 30px; border-bottom: 1px solid var(--border); }
        .author-name { font-weight: 600; color: var(--oil-navy); }

        /* Featured Image */
        .article-image { margin: 0 0 32px; border-radius: 6px; overflow: hidden; border: 1px solid var(--border); max-height: 380px; }
        .article-image img { width: 100%; height: 100%; object-fit: cover; display: block; }

        /* Article Layout */
        .article-layout { display: grid; grid-template-columns: 760px 1fr; gap: 60px; padding: 40px 0 60px; }

        /* Article Body */
        .article-body h2 { font-size: 24px; font-weight: 900; margin-top: 44px; margin-bottom: 16px; color: var(--oil-navy); }
        .article-body h3 { font-size: 19px; font-weight: 700; margin-top: 32px; margin-bottom: 12px; color: var(--oil-navy); }
        .article-body p { font-size: 16px; color: #2D3748; line-height: 1.85; margin-bottom: 18px; }
        .article-body strong { color: var(--oil-navy); font-weight: 600; }

        /* Callouts */
        .callout { background: var(--paper); border-left: 4px solid var(--red-dirt); padding: 20px 24px; margin: 28px 0; border-radius: 0 6px 6px 0; }
        .callout p { font-size: 15px; margin-bottom: 0; }
        .callout p + p { margin-top: 10px; }
        .callout-title { font-weight: 700; color: var(--red-dirt); font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
        .callout-warning { border-left-color: #E53E3E; background: #FFF5F5; }
        .callout-warning .callout-title { color: #E53E3E; }
        .callout-tip { border-left-color: var(--success); background: var(--success-bg); }
        .callout-tip .callout-title { color: var(--success); }

        /* Table */
        .options-table-wrapper { margin: 28px 0; overflow-x: auto; }
        .options-table { width: 100%; border-collapse: collapse; font-size: 14px; }
        .options-table th { text-align: left; padding: 12px 16px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #718096; background: var(--paper); border-bottom: 2px solid var(--border); font-weight: 600; }
        .options-table td { padding: 14px 16px; border-bottom: 1px solid var(--border); color: #2D3748; line-height: 1.5; vertical-align: top; }
        .options-table tr:hover { background: var(--paper); }
        .option-name { font-weight: 700; color: var(--oil-navy); white-space: nowrap; }
        .risk-low { color: var(--success); font-weight: 600; }
        .risk-medium { color: var(--red-dirt); font-weight: 600; }
        .risk-high { color: #E53E3E; font-weight: 600; }

        /* Steps */
        .step-list { margin: 24px 0; }
        .step-item { display: grid; grid-template-columns: 44px 1fr; gap: 16px; margin-bottom: 24px; align-items: start; }
        .step-number { width: 44px; height: 44px; border-radius: 50%; background: var(--oil-navy); color: white; display: flex; align-items: center; justify-content: center; font-family: 'Merriweather', serif; font-weight: 900; font-size: 18px; flex-shrink: 0; }
        .step-content h3 { margin-top: 0; font-size: 17px; }
        .step-content p { margin-bottom: 10px; }

        /* Filing type cards (OCC guide) */
        .filing-card { background: #fff; border: 1px solid var(--border); border-radius: 6px; margin: 28px 0; overflow: hidden; }
        .filing-card-header { display: flex; align-items: center; gap: 14px; padding: 18px 24px; background: var(--paper); border-bottom: 1px solid var(--border); }
        .filing-icon { width: 40px; height: 40px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: white; }
        .filing-icon-permit { background: #2B6CB0; }
        .filing-icon-spacing { background: #6B46C1; }
        .filing-icon-pooling { background: #C05621; }
        .filing-icon-density { background: #2F855A; }
        .filing-icon-location { background: #B7791F; }
        .filing-icon-completion { background: #00796B; }
        .filing-icon-transfer { background: #718096; }
        .filing-icon-plug { background: #9B2C2C; }
        .filing-card-title { font-family: 'Merriweather', serif; font-size: 17px; font-weight: 700; color: var(--oil-navy); }
        .filing-card-subtitle { font-size: 13px; color: #718096; margin-top: 2px; }
        .filing-card-body { padding: 20px 24px; }
        .filing-card-body p { font-size: 15px; margin-bottom: 14px; }
        .filing-card-body p:last-child { margin-bottom: 0; }
        .filing-detail { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border); }
        .filing-detail-item h4 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #718096; font-family: 'Inter', sans-serif; font-weight: 600; margin-bottom: 4px; }
        .filing-detail-item p { font-size: 14px; margin-bottom: 0; color: #2D3748; }
        .action-required { display: inline-block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; padding: 3px 10px; border-radius: 3px; margin-top: 6px; }
        .action-yes { background: #FFF5F5; color: #E53E3E; }
        .action-optional { background: #FFFAF0; color: #C05621; }
        .action-no { background: var(--success-bg); color: var(--success); }

        /* Quick ref table (OCC guide) */
        .quick-ref { width: 100%; border-collapse: collapse; font-size: 14px; margin: 24px 0; }
        .quick-ref th { text-align: left; padding: 10px 14px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #718096; background: var(--paper); border-bottom: 2px solid var(--border); font-weight: 600; }
        .quick-ref td { padding: 12px 14px; border-bottom: 1px solid var(--border); color: #2D3748; vertical-align: top; line-height: 1.5; }
        .quick-ref tr:hover { background: var(--paper); }

        /* Timeline (OCC guide) */
        .timeline { position: relative; margin: 32px 0; padding-left: 32px; }
        .timeline::before { content: ''; position: absolute; left: 11px; top: 8px; bottom: 8px; width: 2px; background: var(--border); }
        .timeline-item { position: relative; margin-bottom: 24px; }
        .timeline-item:last-child { margin-bottom: 0; }
        .timeline-dot { position: absolute; left: -27px; top: 6px; width: 12px; height: 12px; border-radius: 50%; background: var(--oil-navy); border: 2px solid white; box-shadow: 0 0 0 2px var(--border); }
        .timeline-dot-active { background: var(--red-dirt); box-shadow: 0 0 0 2px var(--red-dirt); }
        .timeline-title { font-weight: 700; font-size: 15px; color: var(--oil-navy); margin-bottom: 4px; }
        .timeline-desc { font-size: 14px; color: #4A5568; line-height: 1.6; }

        /* Math examples (Division orders guide) */
        .math-example { background: var(--paper); border: 1px solid var(--border); border-radius: 6px; padding: 24px; margin: 28px 0; }
        .math-example-title { font-family: 'Merriweather', serif; font-size: 15px; font-weight: 700; color: var(--oil-navy); margin-bottom: 16px; padding-bottom: 10px; border-bottom: 2px solid var(--red-dirt); }
        .math-row { display: grid; grid-template-columns: 200px 1fr; gap: 12px; padding: 8px 0; font-size: 14px; align-items: baseline; }
        .math-label { color: #718096; font-weight: 500; }
        .math-value { color: var(--oil-navy); font-weight: 600; }
        .math-divider { border-top: 1px solid var(--border); margin: 8px 0; }
        .math-result { background: white; border: 1px solid var(--border); border-radius: 4px; padding: 12px 16px; margin-top: 12px; display: grid; grid-template-columns: 200px 1fr; gap: 12px; }
        .math-result .math-label { color: var(--oil-navy); font-weight: 700; }
        .math-result .math-value { color: var(--red-dirt); font-weight: 700; font-size: 16px; }

        /* Division order anatomy (Division orders guide) */
        .do-anatomy { border: 1px solid var(--border); border-radius: 6px; overflow: hidden; margin: 28px 0; }
        .do-anatomy-header { background: var(--oil-navy); color: white; padding: 14px 20px; font-family: 'Merriweather', serif; font-weight: 700; font-size: 15px; }
        .do-field { display: grid; grid-template-columns: 180px 1fr; border-bottom: 1px solid var(--border); }
        .do-field:last-child { border-bottom: none; }
        .do-field-label { padding: 14px 20px; background: var(--paper); font-weight: 600; font-size: 14px; color: var(--oil-navy); border-right: 1px solid var(--border); }
        .do-field-value { padding: 14px 20px; font-size: 14px; color: #4A5568; line-height: 1.6; }
        .do-highlight { background: #FFFFF0; }
        .do-highlight .do-field-value { color: var(--oil-navy); font-weight: 600; }

        /* Checklist (Division orders guide) */
        .checklist { margin: 24px 0; }
        .check-item { display: flex; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border); align-items: flex-start; }
        .check-item:last-child { border-bottom: none; }
        .check-icon { width: 22px; height: 22px; border-radius: 50%; background: var(--success-bg); color: var(--success); display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 2px; }
        .check-icon svg { width: 12px; height: 12px; }
        .check-text { font-size: 15px; color: #2D3748; line-height: 1.6; }

        /* FAQ */
        .faq-section { margin-top: 44px; }
        .faq-item { border-bottom: 1px solid var(--border); padding: 20px 0; }
        .faq-item:first-of-type { border-top: 1px solid var(--border); }
        .faq-question { font-family: 'Merriweather', serif; font-size: 16px; font-weight: 700; color: var(--oil-navy); margin-bottom: 8px; }
        .faq-answer { font-size: 15px; color: #4A5568; line-height: 1.75; }

        /* Sidebar */
        .article-sidebar { position: sticky; top: 30px; align-self: start; }
        .sidebar-card { background: var(--paper); border: 1px solid var(--border); border-radius: 4px; padding: 24px; margin-bottom: 20px; }
        .sidebar-card h3 { font-size: 15px; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 2px solid var(--red-dirt); }
        .toc-link { display: block; padding: 6px 0; font-size: 13px; color: var(--slate-blue); text-decoration: none; line-height: 1.5; border-left: 2px solid transparent; padding-left: 12px; transition: all 0.15s; }
        .toc-link:hover { color: var(--red-dirt); border-left-color: var(--red-dirt); }
        .sidebar-cta { background: var(--oil-navy); color: white; border: none; border-top: 4px solid var(--red-dirt); }
        .sidebar-cta h3 { color: white; border-bottom-color: rgba(255,255,255,0.15); }
        .sidebar-cta p { color: rgba(255,255,255,0.8); font-size: 14px; line-height: 1.6; margin-bottom: 16px; }
        .sidebar-btn { display: block; width: 100%; text-align: center; padding: 12px; background: var(--red-dirt); color: white; border-radius: 4px; font-size: 14px; font-weight: 600; text-decoration: none; transition: background 0.2s; }
        .sidebar-btn:hover { background: var(--red-dirt-dark); }
        .related-link { display: block; padding: 8px 0; font-size: 14px; color: var(--slate-blue); text-decoration: none; line-height: 1.5; border-bottom: 1px solid var(--border); }
        .related-link:last-child { border-bottom: none; }
        .related-link:hover { color: var(--red-dirt); }

        /* Bottom CTA */
        /* Tool cards (OCC website guide) */
        .tool-card { background: #fff; border: 1px solid var(--border); border-radius: 6px; margin: 28px 0; overflow: hidden; }
        .tool-card-header { display: flex; align-items: center; gap: 14px; padding: 18px 24px; background: var(--paper); border-bottom: 1px solid var(--border); }
        .tool-icon { width: 40px; height: 40px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: white; font-size: 18px; }
        .tool-icon-well { background: #2B6CB0; }
        .tool-icon-gis { background: #2F855A; }
        .tool-icon-ecf { background: #6B46C1; }
        .tool-icon-imaging { background: #B7791F; }
        .tool-icon-case { background: #00796B; }
        .tool-icon-data { background: #C05621; }
        .tool-icon-docket { background: #9B2C2C; }
        .tool-card-title { font-family: 'Merriweather', serif; font-size: 17px; font-weight: 700; color: var(--oil-navy); }
        .tool-card-subtitle { font-size: 13px; color: #718096; margin-top: 2px; }
        .tool-card-body { padding: 20px 24px; }
        .tool-card-body p { font-size: 15px; margin-bottom: 14px; }
        .tool-card-body p:last-child { margin-bottom: 0; }
        .tool-url { display: inline-block; font-size: 13px; font-family: 'Courier New', monospace; background: #EDF2F7; color: #2B6CB0; padding: 3px 10px; border-radius: 3px; text-decoration: none; word-break: break-all; }
        .tool-url:hover { background: #E2E8F0; }
        .tool-detail { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border); }
        .tool-detail-item h4 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #718096; font-family: 'Inter', sans-serif; font-weight: 600; margin-bottom: 4px; }
        .tool-detail-item p { font-size: 14px; margin-bottom: 0; color: #2D3748; }

        /* Step boxes (OCC website guide) */
        .step-box { background: var(--paper); border: 1px solid var(--border); border-radius: 6px; padding: 20px 24px; margin: 20px 0; }
        .step-box ol { list-style: none; counter-reset: steps; padding: 0; }
        .step-box ol li { counter-increment: steps; position: relative; padding-left: 36px; margin-bottom: 12px; font-size: 15px; line-height: 1.6; color: #2D3748; }
        .step-box ol li:last-child { margin-bottom: 0; }
        .step-box ol li::before { content: counter(steps); position: absolute; left: 0; top: 1px; width: 24px; height: 24px; background: var(--oil-navy); color: white; border-radius: 50%; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; }

        /* Share & Print */
        .article-actions { display: flex; gap: 8px; margin-top: 18px; }
        .share-wrap { position: relative; display: inline-block; }
        .share-trigger, .print-trigger { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border: 1px solid var(--border); border-radius: 4px; background: #fff; color: var(--slate-blue); font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
        .share-trigger:hover, .print-trigger:hover { border-color: var(--red-dirt); color: var(--red-dirt); }
        .share-trigger svg, .print-trigger svg { width: 15px; height: 15px; }
        .print-header { display: none; }
        .share-modal { display: none; position: absolute; top: calc(100% + 8px); left: 0; width: 340px; background: #fff; border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.12); z-index: 200; padding: 20px; }
        .share-modal.open { display: block; }
        .share-modal-title { font-size: 14px; font-weight: 700; color: var(--oil-navy); margin-bottom: 12px; }
        .share-link-box { display: flex; gap: 8px; margin-bottom: 16px; }
        .share-link-input { flex: 1; padding: 8px 12px; border: 1px solid var(--border); border-radius: 4px; font-size: 12px; font-family: 'Courier New', monospace; color: var(--slate-blue); background: var(--paper); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .share-copy-btn { padding: 8px 14px; border: 1px solid var(--border); border-radius: 4px; background: #fff; color: var(--slate-blue); font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s; white-space: nowrap; }
        .share-copy-btn:hover { border-color: var(--oil-navy); color: var(--oil-navy); }
        .share-copy-btn.copied { border-color: var(--success); color: var(--success); background: var(--success-bg); }
        .share-options { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .share-opt { display: flex; align-items: center; gap: 8px; flex: 1; padding: 10px 12px; border: 1px solid var(--border); border-radius: 4px; background: #fff; color: var(--slate-blue); font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.2s; text-decoration: none; justify-content: center; }
        .share-opt:hover { border-color: var(--red-dirt); color: var(--red-dirt); background: #FFF8F5; }
        .share-opt svg { width: 14px; height: 14px; flex-shrink: 0; }

        .bottom-cta { background: linear-gradient(135deg, var(--oil-navy) 0%, #2D4A5E 100%); padding: 60px 0; text-align: center; color: white; }
        .bottom-cta h2 { font-size: 28px; margin-bottom: 12px; font-weight: 900; }
        .bottom-cta p { font-size: 16px; color: rgba(255,255,255,0.8); margin-bottom: 28px; max-width: 520px; margin-left: auto; margin-right: auto; line-height: 1.6; }
        .bottom-cta .sidebar-btn { display: inline-block; width: auto; padding: 14px 28px; }

        @media (max-width: 1000px) {
            .article-layout { grid-template-columns: 1fr; gap: 40px; }
            .article-sidebar { position: static; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        }
        @media (max-width: 768px) {
            .article-hero h1 { font-size: 28px; }
            .article-lede { font-size: 16px; }
            .article-meta { flex-direction: column; align-items: flex-start; gap: 6px; }
            .article-sidebar { grid-template-columns: 1fr; }
            .filing-detail { grid-template-columns: 1fr; }
            .tool-detail { grid-template-columns: 1fr; }
            .math-row { grid-template-columns: 1fr; gap: 2px; }
            .math-result { grid-template-columns: 1fr; gap: 2px; }
            .do-field { grid-template-columns: 1fr; }
            .do-field-label { border-right: none; border-bottom: 1px solid var(--border); }
        }
    </style>
</head>
<body>

    ${HEADER}

    <div class="breadcrumb">
        <div class="container">
            <a href="/">Home</a>
            <span>&rsaquo;</span>
            <a href="/insights">Insights</a>
            <span>&rsaquo;</span>
            <a href="/insights">Guides</a>
            <span>&rsaquo;</span>
            ${esc(article.breadcrumb)}
        </div>
    </div>

    <main>
        <div class="container">
            <div class="article-hero">
                <div class="article-hero-inner">
                    <span class="tag ${article.tagClass}">${esc(article.tag)}</span>
                    <h1>${esc(article.title)}</h1>
                    <p class="article-lede">${esc(article.description).replace(/Here's/g, 'Here&rsquo;s')}</p>
                    <div class="article-meta">
                        <span>By <span class="author-name">${esc(article.author)}</span>, Founder of <a href="/" style="color:inherit;text-decoration:underline;text-underline-offset:2px;">Mineral Watch</a></span>
                        <span>${esc(article.readTime)}</span>
                        <span>${esc(article.updated)}</span>
                    </div>
                    <div class="share-wrap">
                        <button class="share-trigger" onclick="this.nextElementSibling.classList.toggle('open')">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                            Share
                        </button>
                        <div class="share-modal">
                            <div class="share-modal-title">Share this article</div>
                            <div class="share-link-box">
                                <input class="share-link-input" type="text" value="${article.canonical}" readonly onclick="this.select()">
                                <button class="share-copy-btn" onclick="navigator.clipboard.writeText(this.previousElementSibling.value);this.textContent='Copied!';this.classList.add('copied');setTimeout(()=>{this.textContent='Copy';this.classList.remove('copied')},2000)">Copy</button>
                            </div>
                            <div class="share-options">
                                <a class="share-opt" onclick="window.open('https://x.com/intent/tweet?url='+encodeURIComponent('${article.canonical}')+'&text='+encodeURIComponent('${esc(article.title).replace(/'/g, "\\'")}'),'share','width=550,height=420,left='+((screen.width-550)/2)+',top='+((screen.height-420)/2));return false;" href="#">
                                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                                    X
                                </a>
                                <a class="share-opt" onclick="window.open('https://www.facebook.com/sharer/sharer.php?u='+encodeURIComponent('${article.canonical}'),'share','width=550,height=420,left='+((screen.width-550)/2)+',top='+((screen.height-420)/2));return false;" href="#">
                                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                                    Facebook
                                </a>
                                <a class="share-opt" onclick="window.open('https://www.linkedin.com/sharing/share-offsite/?url='+encodeURIComponent('${article.canonical}'),'share','width=550,height=420,left='+((screen.width-550)/2)+',top='+((screen.height-420)/2));return false;" href="#">
                                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                                    LinkedIn
                                </a>
                                <a class="share-opt" onclick="window.location.href='mailto:?subject='+encodeURIComponent('${esc(article.title).replace(/'/g, "\\'")}')+'&body='+encodeURIComponent('I thought you might find this useful:\\n\\n${article.canonical}');return false;" href="#">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/></svg>
                                    Email
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="article-layout">
                <article class="article-body">
                    ${imageHtml}
                    ${article.body}
                </article>

                <aside class="article-sidebar">
                    <div class="sidebar-card">
                        <h3>In This Guide</h3>
                        ${tocHtml}
                    </div>
                    <div class="sidebar-card sidebar-cta">
                        <h3>Know Before the Letter Arrives</h3>
                        <p>Mineral Watch alerts you when OCC filings affect your sections &mdash; including pooling applications, permits, and completions.</p>
                        <a href="https://portal.mymineralwatch.com/" class="sidebar-btn">Start Free &rarr;</a>
                    </div>
                    <div class="sidebar-card">
                        <h3>Related Guides</h3>
                        ${relatedHtml}
                    </div>
                </aside>
            </div>
        </div>
    </main>

    <section class="bottom-cta">
        <div class="container">
            <h2>${esc(article.ctaTitle)}</h2>
            <p>${article.ctaText}</p>
            <a href="https://portal.mymineralwatch.com/" class="sidebar-btn">Start Free &rarr;</a>
        </div>
    </section>

    ${FOOTER}
    ${MENU_SCRIPT}
    <script>document.addEventListener('click',function(e){var m=document.querySelector('.share-modal.open');if(m&&!m.parentElement.contains(e.target))m.classList.remove('open')})</script>

</body>
</html>`;
}

// ════════════════════════════════════════════
//  404 PAGE
// ════════════════════════════════════════════

export function render404(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Page Not Found | Mineral Watch</title>
    ${FONT_LINK}
    <style>
        ${CSS_VARS}
        ${CSS_BASE}
        .not-found { text-align: center; padding: 100px 20px; }
        .not-found h1 { font-size: 48px; margin-bottom: 16px; color: var(--oil-navy); }
        .not-found p { font-size: 18px; color: #596674; margin-bottom: 28px; }
        .not-found a { color: var(--red-dirt); font-weight: 600; text-decoration: none; }
        .not-found a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    ${HEADER}
    <main class="not-found">
        <h1>404</h1>
        <p>This page doesn&rsquo;t exist yet.</p>
        <a href="/insights">&larr; Back to Insights</a>
    </main>
    ${FOOTER}
    ${MENU_SCRIPT}
</body>
</html>`;
}

// ════════════════════════════════════════════
//  ARTICLE BODY CONTENT
// ════════════════════════════════════════════

const POOLING_ORDERS_BODY = `
<p>If you own mineral rights in Oklahoma, there&rsquo;s a good chance you&rsquo;ll encounter a pooling order at some point &mdash; especially if your minerals are in an active drilling area like the STACK, SCOOP, or Merge plays. For many mineral owners, particularly those who inherited their interests, a pooling order is the first official document they&rsquo;ve ever received about their minerals. It can be confusing, intimidating, and time-sensitive.</p>

<p>This guide will walk you through what a pooling order is, why you received one, what your options are, and how to evaluate them. We&rsquo;ll also cover the mistakes that cost mineral owners the most money, and when it makes sense to bring in professional help.</p>

<h2 id="what-is-pooling">What Is a Pooling Order?</h2>

<p>A pooling order is a legal mechanism the Oklahoma Corporation Commission (OCC) uses to combine all mineral interests within a designated drilling unit so an operator can drill a well. Think of it as the state&rsquo;s way of preventing one holdout mineral owner from blocking a well that would benefit everyone in the unit.</p>

<p>Here&rsquo;s the situation that leads to a pooling order: An operator wants to drill a well. To do that, they need the rights to all the minerals in the drilling unit &mdash; typically a 640-acre section for a horizontal well, sometimes spanning multiple sections. The operator will try to lease those minerals voluntarily by approaching each mineral owner with a lease offer. But if some owners can&rsquo;t be found, don&rsquo;t respond, or can&rsquo;t agree on lease terms, the operator goes to the OCC and asks them to &ldquo;pool&rdquo; the unit.</p>

<p>The OCC holds a hearing, and if they approve the pooling application, they issue a pooling order. That order gives every unleased mineral owner in the unit a set of options for how they want to participate (or not participate) in the well.</p>

<div class="callout">
    <div class="callout-title">Key Point</div>
    <p>A pooling order doesn&rsquo;t mean you did anything wrong or that your rights are being taken away. It&rsquo;s a standard part of how oil and gas development works in Oklahoma. Thousands of pooling orders are issued every year.</p>
</div>

<h2 id="why-you-received">Why You Received a Pooling Order</h2>

<p>You&rsquo;re receiving a pooling order because you own mineral rights in a section where an operator wants to drill, and you haven&rsquo;t signed a voluntary lease with that operator. There are several common reasons this happens:</p>

<p><strong>You weren&rsquo;t contacted.</strong> The operator may not have had your current address. This is especially common with inherited minerals where the ownership has passed through multiple generations without being formally updated in county records.</p>

<p><strong>You didn&rsquo;t respond to a lease offer.</strong> The operator may have sent a lease offer that you didn&rsquo;t see, didn&rsquo;t understand, or set aside to deal with later. Once they&rsquo;ve made a good-faith effort to lease your interest voluntarily, they can proceed with pooling.</p>

<p><strong>You and the operator couldn&rsquo;t agree on terms.</strong> Maybe you wanted a higher bonus or a better royalty rate than the operator was offering. If negotiations stalled, the operator moved to pooling to keep their drilling schedule on track.</p>

<p><strong>Your ownership is unclear.</strong> If there are title issues &mdash; unclear heirship, missing probate, gaps in the chain of title &mdash; the operator may not be able to lease your interest directly and will pool it instead.</p>

<h2 id="the-deadline">The 20-Day Deadline</h2>

<div class="callout callout-warning">
    <div class="callout-title">Critical Deadline</div>
    <p>Most pooling orders give you <strong>20 days from the date the order is issued</strong> to make your election. If you miss this deadline, you&rsquo;re automatically assigned the default option specified in the order &mdash; which is almost always the least favorable option for the mineral owner. Mark your calendar the moment you receive a pooling order.</p>
</div>

<p>The 20-day clock is not flexible. It doesn&rsquo;t start when you receive the letter &mdash; it starts when the order is issued. If the letter sat in your mailbox for a week, you&rsquo;ve already lost a week of your response window. This is one of the reasons mineral owners in active drilling areas need some kind of awareness system. By the time you receive a pooling order in the mail, the clock is already ticking. Awareness of a pooling application before the order is issued gives you more time to prepare.</p>

<h2 id="election-options">Your Election Options, Explained</h2>

<p>A pooling order will present you with several options &mdash; typically between three and six, depending on the order. Each one has different financial implications, risk profiles, and long-term effects on your minerals. Here&rsquo;s what you&rsquo;ll typically see:</p>

<h3 id="option-lease-bonus">Option 1: Cash Bonus Plus Royalty (Lease-Like Terms)</h3>

<p>This is the option that most closely resembles a voluntary lease. You receive an upfront cash bonus payment per net mineral acre (NMA), and you receive a royalty on production &mdash; typically 3/16ths (18.75%) or 1/5th (20%), as specified in the order. You bear no risk of drilling costs.</p>

<p>The bonus amount is set in the pooling order. It might be $500/NMA, $1,000/NMA, $2,000/NMA, or more depending on the area, formation, and current market conditions. This is where knowing what other operators are offering in nearby sections becomes critical. A $750/NMA bonus might sound good in isolation, but if operators are offering $1,500/NMA in the next township over for the same formation, you&rsquo;d want to know that before accepting.</p>

<div class="callout callout-tip">
    <div class="callout-title">How to evaluate the bonus rate</div>
    <p>Compare the bonus rate in your pooling order against recent pooling orders and voluntary leases in your area. Mineral Watch tracks all pooling order election options and bonus rates across Oklahoma &mdash; you can view every option offered in your area over the past year to see whether the rate you&rsquo;re being offered is competitive, below average, or above market.</p>
</div>

<h3 id="option-participate">Option 2: Participate in the Well (Working Interest)</h3>

<p>This option lets you participate as a working interest owner. Instead of receiving a bonus and a royalty, you pay your proportionate share of drilling and completion costs and receive your proportionate share of revenue. This means higher potential returns &mdash; but also real financial risk.</p>

<p>Drilling a horizontal well in Oklahoma can cost $5 million to $15 million or more. Your share depends on your net mineral acres relative to the total unit size. If you own 10 NMA in a 640-acre unit, your share is about 1.56%. On a $10 million well, that&rsquo;s approximately $156,000 in costs you&rsquo;d need to cover &mdash; with no guarantee the well will produce enough to recover that investment.</p>

<p>This option is generally only viable for mineral owners with significant acreage positions and the financial resources to absorb the risk. For most individual mineral owners, particularly those who inherited a small interest, this is rarely the right choice.</p>

<h3 id="option-nonconsent">Option 3: Non-Consent (Go &ldquo;Nonconsent&rdquo;)</h3>

<p>If you choose not to participate and not to accept the lease-like terms, you can go nonconsent. You receive no upfront bonus payment. Instead, the operator drills the well at their own cost and risk. If the well is productive, the operator recovers a penalty &mdash; typically 150% to 200% of your proportionate share of drilling costs &mdash; from your share of production before you start receiving any revenue.</p>

<p>This is sometimes called the &ldquo;risk penalty.&rdquo; The logic is that the operator took all the financial risk of drilling, so they get to recover an elevated share of costs before you participate in the upside. Depending on the well&rsquo;s production, this penalty period can last months, years, or in the case of a marginal well, essentially forever.</p>

<p>However, if the well turns out to be a strong producer, the nonconsent option can eventually pay more than the bonus option because you retain a full working interest share after the penalty is recouped, rather than being limited to a royalty interest.</p>

<h3 id="option-default">The Default Option</h3>

<p>If you don&rsquo;t respond within the 20-day window, you&rsquo;re assigned the default option. This is specified in the pooling order, and it&rsquo;s almost always the cash bonus option at the lowest offered rate. You don&rsquo;t get to choose &mdash; it&rsquo;s assigned automatically. This is the scenario you want to avoid.</p>

<h3>Comparison of Typical Election Options</h3>

<div class="options-table-wrapper">
    <table class="options-table">
        <thead>
            <tr>
                <th>Option</th>
                <th>Upfront Payment</th>
                <th>Ongoing Revenue</th>
                <th>Cost Exposure</th>
                <th>Risk Level</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td class="option-name">Cash Bonus + Royalty</td>
                <td>Yes (bonus/NMA)</td>
                <td>Royalty (3/16&ndash;1/5)</td>
                <td>None</td>
                <td class="risk-low">Low</td>
            </tr>
            <tr>
                <td class="option-name">Participate (WI)</td>
                <td>No</td>
                <td>Full working interest share</td>
                <td>Proportionate drilling costs</td>
                <td class="risk-high">High</td>
            </tr>
            <tr>
                <td class="option-name">Nonconsent</td>
                <td>No</td>
                <td>After 150&ndash;200% penalty recovered</td>
                <td>None (penalty from production)</td>
                <td class="risk-medium">Medium</td>
            </tr>
            <tr>
                <td class="option-name">Default (missed deadline)</td>
                <td>Yes (lowest bonus)</td>
                <td>Royalty (typically 3/16)</td>
                <td>None</td>
                <td class="risk-low">Low &mdash; but worst terms</td>
            </tr>
        </tbody>
    </table>
</div>

<h2 id="how-to-evaluate">How to Evaluate Your Options</h2>

<p>The right choice depends on several factors: how much you own, how active the area is, the geology of the target formation, the operator&rsquo;s track record, and your own financial situation and risk tolerance. Here&rsquo;s a practical framework:</p>

<p><strong>How large is your interest?</strong> If you own 2 net mineral acres in a 640-acre unit, the financial difference between options may be modest. If you own 40 NMA, the stakes are much higher and the decision deserves more analysis.</p>

<p><strong>How proven is the area?</strong> If there are 50 producing horizontal wells in the same formation in neighboring sections, the drilling risk is relatively low. If this is a frontier area with little offset production data, the risk is higher.</p>

<p><strong>Who is the operator?</strong> A major operator like Devon, Continental, or Marathon has the resources and expertise to drill and complete wells efficiently. A smaller or less established operator may present more risk.</p>

<p><strong>What are the bonus rates in the area?</strong> Looking at what other operators are offering in nearby sections helps you understand whether your pooling order&rsquo;s bonus rate is fair. If the offered rate is well below the area average, you might consider negotiating a voluntary lease before the election deadline, or choosing the nonconsent option as leverage.</p>

<p><strong>What&rsquo;s your financial situation?</strong> If you need cash now, the bonus option provides immediate payment. If you can afford to wait and want to maximize long-term returns on a proven well, nonconsent might pay off &mdash; but it&rsquo;s a gamble.</p>

<h2 id="voluntary-lease">Can You Still Negotiate a Voluntary Lease?</h2>

<p>Yes &mdash; and this is something many mineral owners don&rsquo;t realize. Even after a pooling order is issued, you can still negotiate a voluntary lease directly with the operator. A negotiated lease almost always provides better terms than the pooling order options because both sides have flexibility that the OCC&rsquo;s standardized options don&rsquo;t allow.</p>

<p>In a voluntary lease, you can negotiate a higher bonus, a better royalty rate (1/4th or even 1/5th instead of 3/16ths), a depth clause to protect deeper formations, post-production cost deductions, a Pugh clause to free up unleased acreage, and other protective provisions that don&rsquo;t exist in a pooling order.</p>

<p>The catch: your negotiating leverage decreases once the pooling order is issued because the operator knows they can pool you at the order&rsquo;s terms if you don&rsquo;t agree. This is why early awareness of drilling activity matters &mdash; if you know an operator is filing permits and spacing applications on your section, you can proactively reach out and negotiate a lease before pooling is even filed.</p>

<h2 id="common-mistakes">Mistakes That Cost Mineral Owners Money</h2>

<p><strong>Missing the deadline.</strong> This is the most common and most expensive mistake. The default option is almost never the best option. If you own minerals in an active area, you need a way to know about pooling orders as soon as they&rsquo;re filed &mdash; not when the letter eventually arrives in your mailbox.</p>

<p><strong>Not comparing bonus rates.</strong> A bonus rate of $1,000/NMA might seem generous if you have no frame of reference. But if the going rate in your area is $2,000/NMA, you&rsquo;re leaving money on the table. Always compare against recent pooling orders and lease bonuses in your area before making your election.</p>

<p><strong>Choosing nonconsent without understanding the penalty.</strong> The 150&ndash;200% cost recovery penalty is substantial. On a well with moderate production, it could take years before you see any revenue. Run the numbers or have someone run them for you before choosing this option.</p>

<p><strong>Ignoring the formation details.</strong> A pooling order specifies which geological formations are being pooled. If the order only covers the Woodford formation and you sign off, your other formations (Meramec, Mississippian, etc.) may still be available for future leasing. Understand exactly what you&rsquo;re agreeing to.</p>

<p><strong>Not checking the operator&rsquo;s track record.</strong> Look at the operator&rsquo;s existing wells in the area. What&rsquo;s their average initial production rate? How many wells have they drilled in this formation? A strong operator with a proven track record in the area reduces your risk regardless of which option you choose.</p>

<p><strong>Forgetting about multi-section horizontal wells.</strong> Modern horizontal wells often span two or more sections. A pooling order on your section might be for a well that also crosses into adjacent sections. Understanding the full scope of the well helps you evaluate its potential production and the value of your participation.</p>

<h2 id="when-to-hire-attorney">When to Hire an Attorney</h2>

<p>Not every pooling order requires an attorney, but there are situations where professional help is worth the cost:</p>

<p><strong>You own significant acreage.</strong> If you own more than 10&ndash;20 net mineral acres in the pooled unit, the financial impact of your decision is large enough to justify legal fees. An oil and gas attorney can review the order, advise on your best option, and potentially negotiate a voluntary lease with better terms.</p>

<p><strong>You want to protest the order.</strong> If you believe the pooling order terms are unfair &mdash; for example, if the bonus rate is well below market &mdash; you can protest the order at the OCC. An attorney can represent you at the hearing and argue for better terms.</p>

<p><strong>There are title issues.</strong> If there&rsquo;s uncertainty about your ownership &mdash; missing probate, unclear heirship, conflicting deeds &mdash; an attorney can help resolve these issues so you can properly participate.</p>

<p><strong>This is your first pooling order.</strong> If you&rsquo;ve never dealt with a pooling order before and you inherited minerals that represent meaningful value, a one-time consultation with an oil and gas attorney is money well spent. Many attorneys in Oklahoma City, Tulsa, and other oil patch towns offer initial consultations specifically for mineral owners facing their first pooling situation.</p>

<p>For small interests &mdash; a few net mineral acres or less &mdash; the cost of an attorney may exceed the financial difference between your options. In that case, educating yourself through guides like this one and comparing your bonus rate against area averages is often sufficient.</p>

<h2 id="after-election">What Happens After You Make Your Election</h2>

<p>Once you submit your election to the OCC within the deadline, the process moves forward:</p>

<p><strong>If you chose the bonus option,</strong> the operator will send you a bonus check and a division order once the well is drilled and ready for production. The division order confirms your royalty interest in the well. Review it carefully &mdash; make sure your decimal interest is correct before signing.</p>

<p><strong>If you chose to participate,</strong> you&rsquo;ll receive an Authorization for Expenditure (AFE) detailing the estimated well costs. You&rsquo;ll need to pay your proportionate share as costs are incurred. Once the well is producing, you&rsquo;ll receive your working interest share of revenue, less operating expenses.</p>

<p><strong>If you went nonconsent,</strong> you won&rsquo;t hear much until the well is producing and the operator has recovered the penalty amount from your share. After that, you&rsquo;ll start receiving revenue. The operator is required to provide an accounting of the costs and recovery.</p>

<p>Regardless of which option you chose, monitoring the well&rsquo;s production helps you verify that you&rsquo;re being paid correctly. Oklahoma Tax Commission production data is public, and you can compare reported production against your royalty or revenue statements.</p>

<h2 id="faq">Frequently Asked Questions</h2>

<div class="faq-section">
    <div class="faq-item">
        <div class="faq-question">What is a pooling order in Oklahoma?</div>
        <p class="faq-answer">A pooling order is a legal mechanism used by the Oklahoma Corporation Commission to combine all mineral interests within a designated drilling unit so that an operator can drill a well. If a mineral owner has not voluntarily signed a lease, the OCC can pool their interest and give them a set of election options to participate in or be compensated for the well.</p>
    </div>
    <div class="faq-item">
        <div class="faq-question">How long do I have to respond to a pooling order?</div>
        <p class="faq-answer">You typically have 20 days from the date the pooling order is issued to make your election. If you do not respond within this window, you will be assigned the default election option specified in the order, which is often the least favorable option for the mineral owner.</p>
    </div>
    <div class="faq-item">
        <div class="faq-question">What happens if I don&rsquo;t respond to a pooling order?</div>
        <p class="faq-answer">If you fail to respond within the deadline, you are automatically assigned the default election option. In most cases, this is a cash bonus option at a rate set by the operator, which may be significantly below market value. You lose the ability to choose a more favorable participation option.</p>
    </div>
    <div class="faq-item">
        <div class="faq-question">Should I hire an attorney for a pooling order?</div>
        <p class="faq-answer">It depends on the value of your mineral interest. If you own a significant net mineral acres position, an oil and gas attorney can help you evaluate your options, negotiate better terms, or protest the order. For smaller interests, the cost of an attorney may outweigh the benefit, but a consultation is still worthwhile for first-time mineral owners.</p>
    </div>
    <div class="faq-item">
        <div class="faq-question">Can I negotiate the bonus rate on a pooling order?</div>
        <p class="faq-answer">Not directly through the pooling order itself &mdash; the rates are set in the order. However, you can negotiate a voluntary lease with the operator before or during the pooling process, which often results in better terms. Once the order is issued, your leverage decreases, which is why early awareness of drilling activity on your sections is important.</p>
    </div>
    <div class="faq-item">
        <div class="faq-question">What is the difference between forced pooling and voluntary leasing?</div>
        <p class="faq-answer">Voluntary leasing is a private agreement where you negotiate the bonus, royalty rate, and lease terms. Forced pooling through a pooling order is a legal process where the OCC compels your participation because you and the operator could not reach a voluntary agreement. Pooling order terms are typically less favorable than a well-negotiated lease.</p>
    </div>
</div>

<h2 id="bottom-line">The Bottom Line</h2>

<p>A pooling order isn&rsquo;t something to panic about, but it is something to take seriously and act on quickly. The 20-day deadline is real, the default option is almost never the best option, and the financial differences between elections can be significant &mdash; especially if you own more than a few net mineral acres.</p>

<p>The single most important thing you can do as an Oklahoma mineral owner is stay aware of what&rsquo;s happening on your sections. Pooling orders don&rsquo;t come out of nowhere &mdash; they&rsquo;re preceded by permits, spacing applications, and OCC docket filings that signal drilling activity months in advance. If you&rsquo;re monitoring your sections, a pooling order should never be a surprise.</p>
`;

const INHERITED_MINERAL_RIGHTS_BODY = `
<p>Mineral rights are one of the most commonly inherited &mdash; and least understood &mdash; assets in Oklahoma. The state has over a century of oil and gas history, and mineral interests have been passed down through families for generations. It&rsquo;s not unusual for someone to discover they own minerals they never knew about, in counties they&rsquo;ve never visited, producing oil from wells they&rsquo;ve never seen.</p>

<p>If this is you, don&rsquo;t worry. You don&rsquo;t need to become an oil and gas expert overnight. But there are some important steps to take, some pitfalls to avoid, and some basic concepts to understand. This guide covers all of it.</p>

<h2 id="what-are-mineral-rights">What Are Mineral Rights, Exactly?</h2>

<p>In Oklahoma, the ownership of land can be split into two separate estates: the surface rights (the right to use the land on top) and the mineral rights (the right to everything underneath &mdash; oil, gas, coal, and other subsurface resources). These two estates can be owned by completely different people, and they often are.</p>

<p>When your family member acquired mineral rights &mdash; whether through a purchase, a reservation in a deed, or their own inheritance &mdash; they acquired the right to the oil and gas beneath a specific piece of land. That right exists independently of whoever owns the surface. The surface could have been sold, developed, or subdivided many times over, and the mineral rights still belong to whoever holds the mineral deed.</p>

<p>Mineral rights in Oklahoma are described using the Public Land Survey System (PLSS): section, township, and range. For example, &ldquo;the NW/4 of Section 15, Township 12 North, Range 8 West, Indian Meridian, Canadian County, Oklahoma&rdquo; describes a specific 160-acre quarter section. Your inherited minerals will be described using this system, and understanding the legal description is the first step to figuring out what you own.</p>

<div class="callout">
    <div class="callout-title">Key Concept &mdash; Net Mineral Acres</div>
    <p>Your ownership is measured in <strong>net mineral acres (NMA)</strong>. If your family member owned 100% of the minerals under a 160-acre quarter section, that&rsquo;s 160 NMA. If they owned a 1/4 interest in the minerals under a 640-acre section, that&rsquo;s also 160 NMA. If that interest has been split among four heirs, each heir owns 40 NMA. Understanding your net mineral acres is essential for evaluating lease offers, pooling orders, and royalty payments.</p>
</div>

<h2 id="first-steps">First Steps After Inheriting</h2>

<p>The process of sorting out inherited mineral rights can feel overwhelming, but it breaks down into a series of manageable steps. Here&rsquo;s where to start:</p>

<div class="step-list">
    <div class="step-item">
        <div class="step-number">1</div>
        <div class="step-content">
            <h3>Gather the paperwork</h3>
            <p>Look through the deceased person&rsquo;s files for anything related to oil and gas: lease agreements, division orders, royalty check stubs, correspondence from operators or the Oklahoma Corporation Commission, tax records mentioning royalty income, and deeds or title opinions referencing mineral interests. Even a single royalty check stub can tell you which operator is paying, which well is producing, and give you a starting point for tracing the ownership.</p>
        </div>
    </div>

    <div class="step-item">
        <div class="step-number">2</div>
        <div class="step-content">
            <h3>Identify the properties</h3>
            <p>From the paperwork, identify the specific properties &mdash; section, township, range, and county. If you have a lease or a deed, the legal description will be there. If you only have royalty check stubs, the well name or API number on the stub can be used to look up the well&rsquo;s location through the Oklahoma Corporation Commission&rsquo;s well records.</p>
        </div>
    </div>

    <div class="step-item">
        <div class="step-number">3</div>
        <div class="step-content">
            <h3>Don&rsquo;t sign anything yet</h3>
            <p>After a death, mineral buyers and lease brokers sometimes contact heirs with unsolicited offers. Do not sign anything &mdash; whether it&rsquo;s a purchase offer, a new lease, or even a seemingly routine document &mdash; until you understand what you own and what it&rsquo;s worth. There&rsquo;s no urgency that requires you to act before you&rsquo;re ready, despite what a persistent buyer might tell you.</p>
        </div>
    </div>

    <div class="step-item">
        <div class="step-number">4</div>
        <div class="step-content">
            <h3>Understand the estate situation</h3>
            <p>How the minerals transfer to you depends on how the deceased person held them and whether they had a will. If there&rsquo;s a will, the minerals pass according to its terms. If there&rsquo;s no will, Oklahoma&rsquo;s intestate succession laws determine the heirs. Either way, you&rsquo;ll likely need to take a legal step &mdash; probate, an affidavit of heirship, or a trust distribution &mdash; to establish your ownership in the public record.</p>
        </div>
    </div>
</div>

<h2 id="establishing-ownership">Establishing Your Ownership</h2>

<p>Having a legal right to the minerals and having that right documented in the public record are two different things. Until your ownership is properly recorded at the county clerk&rsquo;s office, operators may not know to pay you, title companies may not recognize your claim, and you may have difficulty leasing or managing the minerals. There are several ways to establish your ownership:</p>

<h3 id="probate">Probate</h3>

<p>Probate is the most common and most legally robust way to transfer mineral rights from a deceased person to their heirs. In Oklahoma, the probate court reviews the will (or applies intestate succession law if there&rsquo;s no will), identifies the heirs, and issues a decree or order that formally transfers the property. That decree gets recorded at the county clerk&rsquo;s office in every county where the minerals are located.</p>

<p>Oklahoma offers two types of probate: regular probate and summary administration. Summary administration is a simplified, faster process available for smaller estates or estates where all heirs agree on the distribution. For many mineral rights situations, summary administration is sufficient and can be completed in a matter of months rather than a year or more.</p>

<p>If minerals have passed through multiple generations without being probated &mdash; which is more common than you&rsquo;d think &mdash; you may need to probate more than one estate to clear the chain of title. This is called &ldquo;stacking&rdquo; probates, and while it&rsquo;s more work, it&rsquo;s the cleanest way to resolve a multi-generational title issue.</p>

<h3 id="affidavit-of-heirship">Affidavit of Heirship</h3>

<p>An affidavit of heirship is a sworn statement, typically signed by someone familiar with the deceased person&rsquo;s family, identifying the legal heirs. It&rsquo;s quicker and cheaper than probate, and it gets recorded at the county clerk&rsquo;s office just like a probate decree.</p>

<p>However, an affidavit of heirship has limitations. It doesn&rsquo;t carry the legal authority of a court order. Some operators, title companies, and mineral buyers may not fully accept it, particularly for larger interests or where there&rsquo;s any dispute among heirs. It works well as a practical tool for smaller interests or as a temporary measure while a full probate is pending.</p>

<h3 id="trust-distribution">Trust Distribution</h3>

<p>If the deceased person held their minerals in a revocable living trust, the transfer to beneficiaries can happen outside of probate entirely. The successor trustee distributes the assets according to the trust terms and records a trustee&rsquo;s deed or distribution deed at the county clerk&rsquo;s office. This is one of the advantages of holding minerals in a trust &mdash; it simplifies the transfer for the next generation.</p>

<div class="callout callout-tip">
    <div class="callout-title">Recording is essential</div>
    <p>Whichever method you use, the resulting document &mdash; probate decree, affidavit of heirship, or trust distribution deed &mdash; must be <strong>recorded at the county clerk&rsquo;s office in every county where you own minerals</strong>. This is how the world knows you&rsquo;re the owner. It&rsquo;s how operators know to put your name on division orders. It&rsquo;s how title examiners will find your ownership when a new well is drilled. Don&rsquo;t skip this step.</p>
</div>

<h2 id="figuring-out-what-you-own">Figuring Out What You Actually Own</h2>

<p>Once you&rsquo;ve established your ownership, the next step is understanding exactly what you have. This means answering several questions:</p>

<p><strong>Where are the minerals?</strong> Identify every county, section, township, and range where you hold an interest. If your family member owned minerals in multiple counties &mdash; which is common in Oklahoma families that have held minerals for generations &mdash; you need to track each property separately.</p>

<p><strong>How much do you own?</strong> Determine your net mineral acres in each property. This requires tracing the chain of title from the original acquisition through each subsequent transfer, inheritance, and division among heirs. If your grandfather owned 160 NMA, your father inherited 1/4 of that (40 NMA), and you&rsquo;re one of three children, you may own approximately 13.3 NMA in that property. The actual calculation depends on the specific terms of each will or probate decree.</p>

<p><strong>Are the minerals currently leased?</strong> If there&rsquo;s an active lease on your minerals, an operator holds the right to drill and produce. You&rsquo;d be receiving royalties on any production. If the minerals are unleased, they&rsquo;re available for leasing &mdash; or could be subject to pooling if an operator wants to drill in the area.</p>

<p><strong>Are there producing wells?</strong> Check whether there are active wells on your sections. Oklahoma Tax Commission production data is public, and operators are required to report monthly production figures. If there are producing wells and you&rsquo;re not receiving royalty checks, that&rsquo;s a problem worth investigating &mdash; it may mean the operator doesn&rsquo;t have your current information, or the ownership records haven&rsquo;t been updated.</p>

<div class="callout">
    <div class="callout-title">Where to look</div>
    <p>The <strong>county clerk&rsquo;s records</strong> in the county where the minerals are located contain the deeds, leases, and other recorded documents that establish the chain of title. Many Oklahoma counties now have online search portals. The <strong>Oklahoma Corporation Commission</strong> maintains well records, permits, and production data. The <strong>Oklahoma Tax Commission</strong> publishes gross production data by operator and well. Mineral Watch aggregates OCC filing data, production reports, and well information across all 77 Oklahoma counties, which can help you see the full picture of activity on your properties without searching each source individually.</p>
</div>

<h2 id="royalty-checks">Understanding Royalty Checks</h2>

<p>If the minerals you inherited have producing wells, you should be receiving royalty checks. Here&rsquo;s how they work:</p>

<p>When an operator produces oil or gas from a well on your section, they sell the production and distribute a share of the revenue to each mineral owner based on their decimal interest. Your decimal interest is your net mineral acres divided by the total acres in the drilling unit, multiplied by your royalty rate. For example, if you own 10 NMA in a 640-acre unit with a 3/16 royalty, your decimal interest would be 10/640 &times; 3/16 = 0.00292969 &mdash; meaning you receive about 0.29% of the well&rsquo;s gross revenue.</p>

<p>Royalty checks typically arrive monthly, though some operators pay quarterly or hold payment until a minimum threshold is reached. The check will include a detail statement showing the well name, production volumes, prices, and any deductions. Review these statements carefully &mdash; errors happen, and they tend to favor the operator, not you.</p>

<p><strong>If the checks were going to the deceased person,</strong> you&rsquo;ll need to notify the operator of the ownership change. The operator will send you a new division order reflecting your inherited interest. Once you sign and return it, they&rsquo;ll begin issuing checks in your name. If there&rsquo;s unclaimed revenue that accumulated during the transition, it should be paid to you once the ownership update is processed.</p>

<p><strong>If no one has been cashing the checks,</strong> the funds may have been turned over to the Oklahoma State Treasurer&rsquo;s Unclaimed Property Division. You can search their database online using the deceased person&rsquo;s name. Tens of millions of dollars in mineral royalties sit in Oklahoma&rsquo;s unclaimed property fund.</p>

<h2 id="taxes">Tax Implications</h2>

<p>There are several tax considerations when you inherit mineral rights. This is not tax advice &mdash; consult a professional for your specific situation &mdash; but here are the concepts you should be aware of:</p>

<p><strong>The inheritance itself is generally not taxable.</strong> When you inherit mineral rights, you receive what&rsquo;s called a &ldquo;stepped-up basis&rdquo; &mdash; your cost basis for the minerals is the fair market value at the date of death, not what the original owner paid. This can significantly reduce capital gains taxes if you ever sell.</p>

<p><strong>Royalty income is taxable.</strong> Any royalty payments you receive are taxed as ordinary income on both your federal and Oklahoma state tax returns. The operator will send you a 1099-MISC each year reporting the gross royalties paid.</p>

<p><strong>Oklahoma gross production tax is withheld.</strong> Oklahoma levies a gross production tax on oil and gas production. This tax is typically withheld by the operator before your royalty check is calculated, so the amount you receive is already net of this tax. You may be able to claim a credit for this on your state tax return.</p>

<p><strong>Depletion deduction.</strong> As a mineral owner receiving royalty income, you&rsquo;re entitled to a depletion deduction on your federal tax return. For most individual mineral owners, the percentage depletion method allows you to deduct 15% of your gross royalty income (subject to certain limitations). This is one of the more valuable tax benefits of mineral ownership, and many mineral owners &mdash; especially new ones &mdash; miss it.</p>

<p><strong>Estate tax considerations.</strong> For large mineral portfolios, the value of the minerals may affect estate tax calculations. Federal estate tax only applies to estates exceeding the exemption threshold (which changes periodically), but this is worth discussing with an estate attorney if the mineral interests are substantial.</p>

<h2 id="protecting-your-inheritance">Protecting Your Inheritance</h2>

<p>Mineral rights are a long-term asset. The wells producing today may decline, but new wells can be drilled, new formations can be developed, and the value of your minerals can grow over decades. Here&rsquo;s how to protect what you&rsquo;ve inherited:</p>

<p><strong>Monitor your sections.</strong> The most important thing you can do is know what&rsquo;s happening on your properties. New drilling permits, pooling orders, spacing applications, and completion reports all directly affect your minerals. A pooling order gives you just 20 days to respond, and missing that deadline means you&rsquo;re assigned the worst option by default. Monitoring doesn&rsquo;t have to be complicated &mdash; but it does have to be consistent.</p>

<p><strong>Be skeptical of unsolicited offers to buy.</strong> Mineral buyers actively seek out heirs of deceased mineral owners. Their business model depends on buying minerals for less than they&rsquo;re worth. A typical offer might be 3&ndash;5 years&rsquo; worth of current royalty income for an asset that could produce for 30 years or more. Some offers are fair; many are not. If you&rsquo;re considering selling, get multiple offers, understand the production trajectory of the wells on your properties, and have an oil and gas attorney review any purchase agreement before signing.</p>

<p><strong>Keep your contact information current.</strong> Make sure operators have your current mailing address so royalty checks and division orders reach you. If you move, notify every operator that pays you royalties. Undeliverable royalty checks eventually get turned over to the state&rsquo;s unclaimed property fund.</p>

<p><strong>Understand what you&rsquo;re signing.</strong> If you receive a lease offer, a pooling order, a division order, or any other document related to your minerals, read it carefully before signing. Division orders are generally straightforward and safe to sign, but lease agreements and other contracts can have long-term consequences. When in doubt, consult an oil and gas attorney &mdash; a one-time consultation fee is a small price to pay for protecting a generational asset.</p>

<p><strong>Plan for the next generation.</strong> Your family member left these minerals to you. At some point, you&rsquo;ll pass them to someone else. Having your ownership properly documented, your properties organized, and a plan in place &mdash; whether through a will, a trust, or a family entity &mdash; makes the transition easier for whoever comes next. Families that manage their minerals proactively tend to preserve them; families that don&rsquo;t tend to lose track of them.</p>

<div class="callout callout-warning">
    <div class="callout-title">Watch out for scams</div>
    <p>After a death, mineral owners may receive official-looking letters offering to &ldquo;update your mineral records&rdquo; or &ldquo;process your inheritance claim&rdquo; for a fee. Legitimate title work and probate should be done through a licensed attorney, not through unsolicited mail services. Similarly, be cautious of lease offers or purchase offers that arrive with high-pressure deadlines. Legitimate operators and buyers understand that estate situations take time.</p>
</div>

<h2 id="common-mistakes">Common Mistakes New Mineral Owners Make</h2>

<p><strong>Not recording the ownership transfer.</strong> Inheriting the minerals is step one. Recording the probate decree or affidavit of heirship at the county clerk&rsquo;s office is step two. Without recording, the public record doesn&rsquo;t reflect your ownership, and you&rsquo;ll have problems down the line with operators, title companies, and future transactions.</p>

<p><strong>Selling too quickly.</strong> The emotional weight of dealing with an estate, combined with persuasive mineral buyers, leads many heirs to sell their minerals within the first year of inheriting them. In most cases, they sell for significantly less than the long-term value. Unless you have an urgent financial need, take your time before making any decisions about selling.</p>

<p><strong>Ignoring the minerals entirely.</strong> Some heirs, especially those who live out of state or have no oil and gas background, simply ignore their inherited minerals. They don&rsquo;t respond to lease offers, miss pooling deadlines, don&rsquo;t cash royalty checks, and eventually lose track of the properties altogether. The minerals don&rsquo;t go away &mdash; but the value can erode through inaction.</p>

<p><strong>Not claiming unclaimed royalties.</strong> If the previous owner wasn&rsquo;t cashing their royalty checks, those funds were turned over to the state. Search Oklahoma&rsquo;s unclaimed property database. You might be surprised at what&rsquo;s there.</p>

<p><strong>Failing to account for all properties.</strong> Many Oklahoma mineral owners held interests in multiple sections across multiple counties. It&rsquo;s easy to focus on the properties where you find paperwork and miss others that weren&rsquo;t well documented. A thorough search of county clerk records and OCC well data can reveal properties you didn&rsquo;t know existed.</p>

<p><strong>Not understanding the difference between mineral rights and royalty interests.</strong> A mineral interest gives you the right to lease, the right to receive bonus payments, the right to receive royalties, and the right to develop the minerals yourself. A royalty interest only entitles you to a share of production revenue &mdash; you can&rsquo;t lease, you can&rsquo;t receive a bonus, and you have no say in development decisions. Make sure you understand which type of interest you&rsquo;ve inherited, as it affects your rights and options.</p>

<h2 id="when-to-get-help">When to Get Professional Help</h2>

<p><strong>An oil and gas attorney</strong> is worth consulting if the estate involves significant mineral acreage, multiple properties, disputed heirship, title problems, or if you&rsquo;ve received a pooling order or lease offer you&rsquo;re not sure about. Many Oklahoma attorneys specialize in mineral rights and offer initial consultations. Look for someone in Oklahoma City, Tulsa, or one of the oil patch towns who works regularly with individual mineral owners.</p>

<p><strong>A CPA or tax advisor</strong> with oil and gas experience can help you handle the depletion deduction, understand your royalty income reporting, and plan for the tax implications of owning (or potentially selling) mineral rights.</p>

<p><strong>A title company or landman</strong> can help you research your chain of title and identify all the properties you&rsquo;ve inherited. This is particularly useful if the mineral interests span multiple counties or have a complicated ownership history.</p>

<p>For smaller interests &mdash; a few net mineral acres producing modest royalties &mdash; you may be able to handle everything yourself with the guidance from this article and related resources. For larger interests, professional help pays for itself many times over.</p>

<h2 id="faq">Frequently Asked Questions</h2>

<div class="faq-section">
    <div class="faq-item">
        <div class="faq-question">How do I find out if I inherited mineral rights in Oklahoma?</div>
        <p class="faq-answer">Start by reviewing the deceased person&rsquo;s estate documents, including their will, trust, and any prior deeds. Check for royalty check stubs, lease agreements, or division orders in their records. You can also search the county clerk&rsquo;s records in the county where the minerals are located by looking up deeds and mineral conveyances under their name.</p>
    </div>
    <div class="faq-item">
        <div class="faq-question">Do I need to go through probate to inherit mineral rights in Oklahoma?</div>
        <p class="faq-answer">In most cases, yes. If the mineral rights were held in the deceased person&rsquo;s individual name and not in a trust or joint tenancy, probate is typically required to legally transfer ownership. Oklahoma allows both formal probate and a simplified summary probate process for smaller estates.</p>
    </div>
    <div class="faq-item">
        <div class="faq-question">How do I transfer mineral rights after someone dies in Oklahoma?</div>
        <p class="faq-answer">The most common methods are probate, an affidavit of heirship, or a trust distribution. Once you have the legal document transferring ownership, it should be recorded with the county clerk in every county where the minerals are located. You should also notify any operators currently paying royalties so they can update their division orders.</p>
    </div>
    <div class="faq-item">
        <div class="faq-question">Do I have to pay taxes on inherited mineral rights in Oklahoma?</div>
        <p class="faq-answer">Inheriting mineral rights is generally not a taxable event &mdash; you receive a stepped-up cost basis. However, any royalty income you receive is taxable as ordinary income. Oklahoma also has a gross production tax that is typically withheld by the operator. Consult a tax professional for your specific situation.</p>
    </div>
    <div class="faq-item">
        <div class="faq-question">What is a division order and should I sign it?</div>
        <p class="faq-answer">A division order states your decimal ownership interest in a well and authorizes the operator to pay you royalties. Verify that the decimal interest is correct before signing. Signing a division order does not change your actual ownership &mdash; it&rsquo;s primarily an administrative document that tells the operator where to send your check.</p>
    </div>
    <div class="faq-item">
        <div class="faq-question">Can I sell inherited mineral rights?</div>
        <p class="faq-answer">Yes, but most professionals recommend caution. Mineral rights are an appreciating, income-producing asset that can generate royalties for decades. Buyers typically offer a fraction of the long-term value. If you consider selling, get multiple offers, have an attorney review any purchase agreement, and understand the tax implications.</p>
    </div>
    <div class="faq-item">
        <div class="faq-question">What happens to my mineral rights if there is no will?</div>
        <p class="faq-answer">Oklahoma&rsquo;s intestate succession laws determine who inherits. Generally, the surviving spouse and children inherit in specific proportions defined by state law. An intestate probate proceeding or determination of heirship is typically required to establish the legal heirs and transfer title.</p>
    </div>
</div>

<h2 id="bottom-line">The Bottom Line</h2>

<p>Inherited mineral rights are a meaningful asset &mdash; one that families have built wealth on across generations in Oklahoma. The key is treating them with the same attention you&rsquo;d give any other valuable inheritance. Get the ownership documented and recorded. Understand what you have. Don&rsquo;t rush into selling. Monitor what&rsquo;s happening on your sections. And when the situation warrants it, get professional help.</p>

<p>The mineral rights your family member left you are the product of decades of ownership. With some attention and informed decision-making, they can continue producing value for decades more.</p>
`;

const OCC_FILING_TYPES_BODY = `
<p>The OCC is the regulatory body that oversees oil and gas operations in Oklahoma. For mineral owners, the OCC is where the action happens &mdash; it&rsquo;s where operators apply for permits, where drilling units are established, where pooling orders are issued, and where wells are officially recorded. Understanding the filings that flow through the OCC is essential to knowing what&rsquo;s happening on your minerals.</p>

<p>This guide covers every major filing type you&rsquo;re likely to encounter as a mineral owner. For each one, we&rsquo;ll explain what it is, what it signals, and whether you need to take action. Bookmark this page &mdash; it&rsquo;s the kind of reference you&rsquo;ll come back to.</p>

<h2 id="quick-reference">Quick Reference</h2>

<p>Before diving into the details, here&rsquo;s a summary of the major filing types and whether they require action from you:</p>

<div style="overflow-x: auto;">
    <table class="quick-ref">
        <thead>
            <tr>
                <th>Filing Type</th>
                <th>What It Signals</th>
                <th>Action Required?</th>
            </tr>
        </thead>
        <tbody>
            <tr><td><strong>Spacing Application</strong></td><td>Operator wants to establish a drilling unit</td><td><span class="action-required action-optional">Optional &mdash; can attend hearing</span></td></tr>
            <tr><td><strong>Pooling Application</strong></td><td>Operator wants to combine unleased interests</td><td><span class="action-required action-optional">Optional &mdash; can attend hearing</span></td></tr>
            <tr><td><strong>Pooling Order</strong></td><td>OCC has approved pooling; election required</td><td><span class="action-required action-yes">Yes &mdash; 20-day deadline</span></td></tr>
            <tr><td><strong>Intent to Drill (Form 1000)</strong></td><td>Drilling is imminent</td><td><span class="action-required action-no">No &mdash; informational</span></td></tr>
            <tr><td><strong>Increased Density</strong></td><td>Operator wants to drill more wells in an existing unit</td><td><span class="action-required action-optional">Optional &mdash; can attend hearing</span></td></tr>
            <tr><td><strong>Location Exception</strong></td><td>Well location deviates from standard spacing</td><td><span class="action-required action-optional">Optional &mdash; can attend hearing</span></td></tr>
            <tr><td><strong>Completion Report (Form 1002A)</strong></td><td>Well has been drilled and is ready for production</td><td><span class="action-required action-no">No &mdash; informational</span></td></tr>
            <tr><td><strong>Multi-Unit Horizontal Well</strong></td><td>Well spans multiple sections</td><td><span class="action-required action-optional">Varies &mdash; may trigger pooling</span></td></tr>
            <tr><td><strong>Operator Transfer</strong></td><td>Well operation changing hands</td><td><span class="action-required action-no">No &mdash; but verify royalties continue</span></td></tr>
            <tr><td><strong>Plug &amp; Abandon</strong></td><td>Well being permanently closed</td><td><span class="action-required action-no">No &mdash; informational</span></td></tr>
        </tbody>
    </table>
</div>

<h2 id="lifecycle">The Lifecycle of a Well: How Filings Connect</h2>

<p>Before looking at each filing type individually, it helps to understand how they fit together. OCC filings aren&rsquo;t random &mdash; they follow a predictable sequence that mirrors the lifecycle of a well. Knowing where you are in this sequence tells you what&rsquo;s coming next.</p>

<div class="timeline">
    <div class="timeline-item">
        <div class="timeline-dot"></div>
        <div class="timeline-title">1. Spacing Application</div>
        <div class="timeline-desc">Operator asks OCC to establish the drilling unit boundaries</div>
    </div>
    <div class="timeline-item">
        <div class="timeline-dot"></div>
        <div class="timeline-title">2. Spacing Order</div>
        <div class="timeline-desc">OCC approves the unit &mdash; typically 640 acres for horizontal wells</div>
    </div>
    <div class="timeline-item">
        <div class="timeline-dot"></div>
        <div class="timeline-title">3. Pooling Application</div>
        <div class="timeline-desc">Operator asks to pool unleased mineral owners in the unit</div>
    </div>
    <div class="timeline-item">
        <div class="timeline-dot timeline-dot-active"></div>
        <div class="timeline-title">4. Pooling Order</div>
        <div class="timeline-desc">OCC issues the order &mdash; your 20-day election deadline starts</div>
    </div>
    <div class="timeline-item">
        <div class="timeline-dot"></div>
        <div class="timeline-title">5. Intent to Drill (Form 1000)</div>
        <div class="timeline-desc">Operator files the drilling permit &mdash; rig arrives within weeks</div>
    </div>
    <div class="timeline-item">
        <div class="timeline-dot"></div>
        <div class="timeline-title">6. Drilling &amp; Completion</div>
        <div class="timeline-desc">Well is drilled, completed, and tested</div>
    </div>
    <div class="timeline-item">
        <div class="timeline-dot"></div>
        <div class="timeline-title">7. Completion Report (Form 1002A)</div>
        <div class="timeline-desc">Well details and initial production officially recorded</div>
    </div>
    <div class="timeline-item">
        <div class="timeline-dot"></div>
        <div class="timeline-title">8. Production &amp; Royalties</div>
        <div class="timeline-desc">Monthly production reported, royalty checks issued</div>
    </div>
</div>

<div class="callout callout-tip">
    <div class="callout-title">Why the sequence matters</div>
    <p>If you&rsquo;re monitoring your sections, a spacing application is your earliest warning that drilling is coming. It gives you time to research the operator, understand the area&rsquo;s economics, and potentially negotiate a voluntary lease &mdash; all before a pooling order arrives with its 20-day deadline. The earlier in the sequence you become aware, the more options you have.</p>
</div>

<h2 id="spacing">Spacing Applications and Orders</h2>

<div class="filing-card">
    <div class="filing-card-header">
        <div class="filing-icon filing-icon-spacing">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
        </div>
        <div>
            <div class="filing-card-title">Spacing Application / Spacing Order</div>
            <div class="filing-card-subtitle">Cause CD &mdash; Oil &amp; Gas Conservation Division</div>
        </div>
    </div>
    <div class="filing-card-body">
        <p>A spacing application is the operator&rsquo;s request to the OCC to establish (or modify) a drilling unit &mdash; the geographic area within which a well or wells will be drilled. For horizontal wells, the standard unit is a 640-acre section. For older vertical wells, units are often smaller &mdash; 160 acres or even 40 acres.</p>

        <p>The spacing order establishes the legal boundaries of the drilling unit and specifies which formations are included. This is important because it determines which mineral owners are part of the unit and how their interests will be calculated.</p>

        <p>For mineral owners, a new spacing application on your section is the first major signal that an operator is preparing to drill. It&rsquo;s filed before the pooling application and before the drilling permit. If you haven&rsquo;t been approached about leasing, seeing a spacing application is your cue to start paying attention.</p>

        <div class="filing-detail">
            <div class="filing-detail-item">
                <h4>Action Required</h4>
                <p>Optional. You can attend the OCC hearing to support or protest the spacing application. Most mineral owners don&rsquo;t attend spacing hearings, but if you believe the proposed unit configuration is unfavorable to your interests, appearing (or having an attorney appear) is your opportunity to object.</p>
            </div>
            <div class="filing-detail-item">
                <h4>What It Signals</h4>
                <p>Drilling is in the planning stages. Expect a pooling application and/or lease offers within the coming months. This is the ideal time to research the operator and the area&rsquo;s economics.</p>
            </div>
        </div>
    </div>
</div>

<h2 id="pooling">Pooling Applications and Orders</h2>

<div class="filing-card">
    <div class="filing-card-header">
        <div class="filing-icon filing-icon-pooling">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>
        </div>
        <div>
            <div class="filing-card-title">Pooling Application / Pooling Order</div>
            <div class="filing-card-subtitle">Cause CD &mdash; Oil &amp; Gas Conservation Division</div>
        </div>
    </div>
    <div class="filing-card-body">
        <p>A pooling application is filed when an operator wants to combine all mineral interests in a drilling unit so they can proceed with a well. This happens when some mineral owners haven&rsquo;t signed voluntary leases &mdash; either because they couldn&rsquo;t be located, didn&rsquo;t respond, or couldn&rsquo;t agree on terms with the operator.</p>

        <p>After the OCC holds a hearing, they may issue a pooling order. This is the filing that directly affects unleased mineral owners: it gives you a set of election options and a 20-day deadline to choose. The pooling order specifies the bonus rates, royalty rates, and participation options available to you.</p>

        <p>This is the single most important filing type for mineral owners. Missing the deadline means you&rsquo;re assigned the default option &mdash; which is almost always the least favorable. For a comprehensive walkthrough of your election options, see our <a href="/insights/guides/understanding-pooling-orders" style="color: var(--red-dirt); font-weight: 600;">Understanding Pooling Orders</a> guide.</p>

        <div class="filing-detail">
            <div class="filing-detail-item">
                <h4>Action Required</h4>
                <p><strong>Yes &mdash; critical.</strong> If a pooling order is issued on your section and you&rsquo;re an unleased mineral owner, you must make your election within 20 days of the order date. You can also attend the hearing on the pooling application to protest or negotiate.</p>
            </div>
            <div class="filing-detail-item">
                <h4>What It Signals</h4>
                <p>An operator has committed to drilling this unit. Lease negotiations have already occurred (or been attempted). A drilling permit typically follows shortly after the pooling order.</p>
            </div>
        </div>
    </div>
</div>

<div class="callout callout-warning">
    <div class="callout-title">The timing gap</div>
    <p>There&rsquo;s often a gap between when a pooling <em>application</em> is filed and when the pooling <em>order</em> is issued. The application goes on the OCC docket first, and the hearing may be weeks or months later. If you see a pooling application on your section, that&rsquo;s your window to contact the operator and negotiate a voluntary lease &mdash; which almost always gets you better terms than the pooling order will offer.</p>
</div>

<h2 id="permits">Intent to Drill (Form 1000)</h2>

<div class="filing-card">
    <div class="filing-card-header">
        <div class="filing-icon filing-icon-permit">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        </div>
        <div>
            <div class="filing-card-title">Intent to Drill &mdash; Form 1000</div>
            <div class="filing-card-subtitle">Drilling Permit</div>
        </div>
    </div>
    <div class="filing-card-body">
        <p>The Intent to Drill, filed on Form 1000, is the operator&rsquo;s official drilling permit application. It specifies the well&rsquo;s name, proposed location (surface and bottomhole coordinates), target formation, proposed depth, and the operator&rsquo;s identity. For horizontal wells, the Form 1000 includes the lateral path &mdash; the planned horizontal trajectory through the target formation.</p>

        <p>A Form 1000 means a rig is coming. Operators don&rsquo;t file drilling permits speculatively &mdash; the paperwork, fees, and regulatory requirements make it a commitment signal. Drilling typically begins within weeks to a few months of the permit being approved.</p>

        <p>The permit also tells you important details about the planned well: which formation is being targeted (Woodford, Meramec, Mississippian, etc.), the lateral length (which affects the well&rsquo;s production potential), and whether the well is a horizontal or vertical well.</p>

        <div class="filing-detail">
            <div class="filing-detail-item">
                <h4>Action Required</h4>
                <p>No direct action required &mdash; this is informational. However, if you see a drilling permit on your section and you haven&rsquo;t been contacted about leasing or pooling, you should investigate. A pooling application may have been filed that you missed, or the operator may be attempting to contact you.</p>
            </div>
            <div class="filing-detail-item">
                <h4>What It Signals</h4>
                <p>Drilling is imminent. The spacing, pooling, and regulatory approvals are in place (or nearly so). Expect to see a rig on location within weeks.</p>
            </div>
        </div>
    </div>
</div>

<h2 id="increased-density">Increased Density Applications</h2>

<div class="filing-card">
    <div class="filing-card-header">
        <div class="filing-icon filing-icon-density">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/><line x1="5" y1="5" x2="5" y2="19"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
        </div>
        <div>
            <div class="filing-card-title">Increased Density Application / Order</div>
            <div class="filing-card-subtitle">Cause CD &mdash; Oil &amp; Gas Conservation Division</div>
        </div>
    </div>
    <div class="filing-card-body">
        <p>An increased density application asks the OCC for permission to drill more wells in a section than the original spacing order allowed. This is extremely common in Oklahoma&rsquo;s active horizontal plays. An operator might drill an initial well in the Woodford formation, then come back and apply for increased density to drill a second Woodford well, or wells targeting different formations like the Meramec or Mississippian within the same section.</p>

        <p>For mineral owners, increased density is generally positive &mdash; more wells typically means more production and more royalty income. However, each new well may trigger a new pooling order if your interest isn&rsquo;t already leased for that specific well or formation. Pay attention to what formations are covered by your existing lease, if you have one.</p>

        <p>Increased density applications are particularly common in the STACK and SCOOP plays, where a single section might eventually have 4, 6, or even 10+ horizontal wells targeting different formations and lateral positions.</p>

        <div class="filing-detail">
            <div class="filing-detail-item">
                <h4>Action Required</h4>
                <p>Optional. You can attend the hearing. The main thing to watch for is whether the increased density triggers a new pooling order that affects your unleased formations.</p>
            </div>
            <div class="filing-detail-item">
                <h4>What It Signals</h4>
                <p>The operator is expanding development in this section &mdash; a sign that the initial wells were productive enough to justify additional drilling. More wells, more production potential.</p>
            </div>
        </div>
    </div>
</div>

<h2 id="location-exception">Location Exceptions</h2>

<div class="filing-card">
    <div class="filing-card-header">
        <div class="filing-icon filing-icon-location">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
        </div>
        <div>
            <div class="filing-card-title">Location Exception</div>
            <div class="filing-card-subtitle">Cause CD &mdash; Oil &amp; Gas Conservation Division</div>
        </div>
    </div>
    <div class="filing-card-body">
        <p>A location exception allows an operator to drill a well at a location that deviates from the standard spacing requirements. Oklahoma&rsquo;s spacing rules generally dictate minimum distances from section lines and from other wells. When geological conditions, surface access issues, or other practical considerations require the well to be drilled at a non-standard location, the operator files a location exception.</p>

        <p>For horizontal wells, location exceptions are very common. The planned surface location (where the rig sits) and the bottomhole location (where the lateral ends) must comply with spacing rules, but the geometry of horizontal drilling frequently requires adjustments. Multi-section horizontal wells, where the lateral crosses section boundaries, almost always involve location exception filings.</p>

        <p>For most mineral owners, location exceptions are routine and don&rsquo;t change the economics of your interest. The exception may matter if the well&rsquo;s location affects which mineral owners are included in the drilling unit or if the well&rsquo;s lateral path comes closer to (or farther from) your specific acreage within the section.</p>

        <div class="filing-detail">
            <div class="filing-detail-item">
                <h4>Action Required</h4>
                <p>Optional. You can attend the hearing and protest if you believe the location is unfavorable to your interests, but this is rare for individual mineral owners.</p>
            </div>
            <div class="filing-detail-item">
                <h4>What It Signals</h4>
                <p>The operator is actively planning the well and working through the regulatory requirements. It&rsquo;s an indicator that drilling plans are advancing.</p>
            </div>
        </div>
    </div>
</div>

<h2 id="completion">Completion Reports (Form 1002A)</h2>

<div class="filing-card">
    <div class="filing-card-header">
        <div class="filing-icon filing-icon-completion">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/></svg>
        </div>
        <div>
            <div class="filing-card-title">Completion Report &mdash; Form 1002A</div>
            <div class="filing-card-subtitle">Well Completion / Recompletion</div>
        </div>
    </div>
    <div class="filing-card-body">
        <p>The completion report is filed after a well has been drilled, cased, perforated, and tested. It&rsquo;s the official record that the well exists and is (or will be) producing. The Form 1002A includes critical details: the well&rsquo;s actual total depth, the formations encountered, the completion technique (hydraulic fracturing stages, lateral length for horizontal wells), and the initial production test results.</p>

        <p>For mineral owners, the completion report is your first concrete look at the well&rsquo;s potential. The initial production (IP) rate &mdash; usually reported as barrels of oil per day (BOPD) and thousand cubic feet of gas per day (MCF/D) &mdash; gives you a rough sense of how productive the well is, though initial rates can be misleading. What matters more is the decline curve over the first 6&ndash;12 months of production.</p>

        <p>After the completion report is filed, the operator will typically send division orders to all mineral owners in the unit. If you&rsquo;re expecting a division order or royalty checks from a well on your section, the completion report filing is your signal that they should be arriving soon.</p>

        <div class="filing-detail">
            <div class="filing-detail-item">
                <h4>Action Required</h4>
                <p>No direct action required. However, you should note the well name, API number, and initial production rates for your records. These details are useful when verifying your division order and monitoring your royalty payments.</p>
            </div>
            <div class="filing-detail-item">
                <h4>What It Signals</h4>
                <p>The well is drilled and completed. Production has started or will start soon. Division orders and royalty checks should follow within weeks to a few months.</p>
            </div>
        </div>
    </div>
</div>

<h2 id="multi-unit">Multi-Unit Horizontal Well Applications</h2>

<div class="filing-card">
    <div class="filing-card-header">
        <div class="filing-icon filing-icon-density">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><polyline points="16,7 21,12 16,17"/><rect x="3" y="3" width="7" height="18" rx="1" fill="none"/><rect x="14" y="3" width="7" height="18" rx="1" fill="none"/></svg>
        </div>
        <div>
            <div class="filing-card-title">Multi-Unit Horizontal Well</div>
            <div class="filing-card-subtitle">Cause CD &mdash; Often combined with spacing/location exception</div>
        </div>
    </div>
    <div class="filing-card-body">
        <p>Modern horizontal wells frequently span more than one section. A two-mile lateral, for example, might start in one section and end in an adjacent section &mdash; or even cross through three sections. When this happens, the operator files a multi-unit horizontal well application asking the OCC to approve the well spanning multiple drilling units.</p>

        <p>This is significant for mineral owners because it means your section may be affected by a well whose surface location is in a completely different section. The well&rsquo;s production is allocated among the sections it crosses, typically based on the percentage of the lateral that falls within each section. Your royalty interest in a multi-section well is based on this allocation, not on the total well production.</p>

        <p>Multi-unit wells are now the standard in Oklahoma&rsquo;s active plays. A typical STACK horizontal well has a two-mile lateral, which almost always crosses at least two sections. Understanding this helps you make sense of division orders and production allocations.</p>

        <div class="filing-detail">
            <div class="filing-detail-item">
                <h4>Action Required</h4>
                <p>Varies. The multi-unit application itself is informational, but it may come with associated pooling orders for each section the well crosses. If you&rsquo;re an unleased mineral owner in any of the affected sections, you&rsquo;ll need to respond to the pooling order.</p>
            </div>
            <div class="filing-detail-item">
                <h4>What It Signals</h4>
                <p>A significant horizontal well is planned that affects multiple sections. This often indicates a major operator with a broader development plan for the area.</p>
            </div>
        </div>
    </div>
</div>

<h2 id="transfers">Operator Transfers (Form 1073)</h2>

<div class="filing-card">
    <div class="filing-card-header">
        <div class="filing-icon filing-icon-transfer">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17,1 21,5 17,9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7,23 3,19 7,15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
        </div>
        <div>
            <div class="filing-card-title">Operator Transfer &mdash; Form 1073</div>
            <div class="filing-card-subtitle">Change of Operator / Well Transfer</div>
        </div>
    </div>
    <div class="filing-card-body">
        <p>An operator transfer occurs when the responsibility for operating a well changes hands. This can happen because of a sale (one company buying another&rsquo;s wells), a corporate merger, or a transfer of operatorship within a joint venture. The Form 1073 records this change with the OCC.</p>

        <p>For mineral owners, an operator transfer means your royalty checks will start coming from a different company. The new operator should send you an updated division order. Your ownership interest doesn&rsquo;t change &mdash; only who is operating the well and processing your royalty payments.</p>

        <p>Operator transfers happen frequently in Oklahoma, particularly as the industry consolidates. Small operators sell assets to larger ones, companies merge, and private equity-backed operators cycle through portfolios. Keeping track of who operates your wells helps you verify that royalties are being paid correctly through the transition.</p>

        <div class="filing-detail">
            <div class="filing-detail-item">
                <h4>Action Required</h4>
                <p>No direct action required. However, verify that the new operator has your correct contact information and watch for a new division order. If royalty checks stop arriving after a transfer, contact the new operator&rsquo;s division order department.</p>
            </div>
            <div class="filing-detail-item">
                <h4>What It Signals</h4>
                <p>A change in who operates and pays royalties on your well. Not inherently good or bad &mdash; but worth monitoring to ensure continuity of your royalty payments.</p>
            </div>
        </div>
    </div>
</div>

<h2 id="plug-abandon">Plugging and Abandonment</h2>

<div class="filing-card">
    <div class="filing-card-header">
        <div class="filing-icon filing-icon-plug">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
        </div>
        <div>
            <div class="filing-card-title">Plugging &amp; Abandonment</div>
            <div class="filing-card-subtitle">Well Plugging Report</div>
        </div>
    </div>
    <div class="filing-card-body">
        <p>When a well is no longer economic to operate, the operator plugs it &mdash; filling the wellbore with cement to permanently seal it &mdash; and files a plugging report with the OCC. This officially takes the well out of service. The well will no longer produce, and royalty payments from that well will cease.</p>

        <p>A plugged well doesn&rsquo;t necessarily mean your minerals are worthless. The well may have targeted one formation while other formations remain untapped. New drilling technology or higher commodity prices could make the area attractive again in the future. Your mineral rights persist regardless of what happens to any individual well.</p>

        <p>However, if all wells on your section are plugged and no new drilling is planned, your minerals become &ldquo;open&rdquo; &mdash; available for new leasing if an operator becomes interested in the future. Older vertical wells in mature fields are being plugged across Oklahoma at a steady rate, even as new horizontal wells are drilled in the same areas.</p>

        <div class="filing-detail">
            <div class="filing-detail-item">
                <h4>Action Required</h4>
                <p>No. The operator is responsible for plugging and any associated environmental remediation. Your royalty payments from this well will end, but your mineral ownership is not affected.</p>
            </div>
            <div class="filing-detail-item">
                <h4>What It Signals</h4>
                <p>The well has reached the end of its economic life. This is normal &mdash; all wells eventually deplete. Your minerals remain and may be developed again in the future.</p>
            </div>
        </div>
    </div>
</div>

<h2 id="other-filings">Other Filing Types</h2>

<p>Beyond the major filing types above, you may encounter several other OCC filings in your research:</p>

<p><strong>Temporary Spacing Orders</strong> are issued when the standard spacing hasn&rsquo;t yet been established for an area and an operator needs interim approval to drill. These are common in newer development areas.</p>

<p><strong>Vacuum Orders</strong> allow an operator to produce a well at reduced pressure to extract additional oil and gas. This is a secondary recovery technique used on older wells and doesn&rsquo;t require action from mineral owners.</p>

<p><strong>Unitization Orders</strong> combine multiple drilling units into a single, larger unit for enhanced recovery operations like waterflooding or CO2 injection. These are less common than pooling orders but can affect your interest similarly.</p>

<p><strong>Well Status Changes</strong> are filed when a well&rsquo;s status changes &mdash; from active to temporarily abandoned, from temporarily abandoned back to active, or from one producing formation to another (recompletion). These are informational and help you track the current state of wells on your sections.</p>

<p><strong>Environmental Compliance Filings</strong> relate to disposal wells, produced water management, and other environmental aspects of well operations. These don&rsquo;t directly affect your royalties but can be relevant if you own surface rights in the same area.</p>

<h2 id="how-to-monitor">How to Stay Informed</h2>

<p>The OCC&rsquo;s online docket and well records systems are publicly accessible. You can search by section, township, range, operator name, well name, or cause number. However, the OCC systems are designed for industry professionals, not casual users &mdash; the interface can be confusing, and there&rsquo;s no built-in way to set up alerts when new filings appear on your sections.</p>

<p>For mineral owners who want to stay on top of their properties, the options are: check the OCC website manually on a regular basis (weekly or monthly, depending on how active your area is), hire a landman to monitor for you (expensive, but thorough), or use a monitoring service that automates the process. The key is consistency &mdash; a filing you miss today could have a 20-day deadline attached to it.</p>

<h2 id="faq">Frequently Asked Questions</h2>

<div class="faq-section">
    <div class="faq-item">
        <div class="faq-question">What is the Oklahoma Corporation Commission?</div>
        <p class="faq-answer">The OCC is a state agency that regulates the oil and gas industry in Oklahoma. For mineral owners, the OCC is the body that issues drilling permits, establishes spacing and drilling units, approves pooling orders, and oversees well operations.</p>
    </div>
    <div class="faq-item">
        <div class="faq-question">How do I find OCC filings on my property?</div>
        <p class="faq-answer">You can search OCC filings through the Commission&rsquo;s online docket system and well records database. Search by section, township, and range to find filings related to your property. You can also search by operator name or cause number.</p>
    </div>
    <div class="faq-item">
        <div class="faq-question">What is the difference between a spacing order and a pooling order?</div>
        <p class="faq-answer">A spacing order establishes the drilling unit &mdash; it defines the geographic boundaries. A pooling order comes after spacing and combines all the mineral interests within that unit so the operator can proceed with drilling. Spacing sets the boundaries; pooling addresses the ownership within those boundaries.</p>
    </div>
    <div class="faq-item">
        <div class="faq-question">What does an Intent to Drill (Form 1000) mean for mineral owners?</div>
        <p class="faq-answer">It means an operator has received approval to drill a specific well. Drilling is imminent &mdash; typically within weeks to months. If you haven&rsquo;t been contacted about leasing, expect a pooling application to follow.</p>
    </div>
    <div class="faq-item">
        <div class="faq-question">What is an increased density order in Oklahoma?</div>
        <p class="faq-answer">It allows an operator to drill additional wells in a section beyond what the original spacing order permitted. This is common in active plays where operators drill multiple horizontal wells targeting different formations. More wells means more potential production and possibly new pooling orders.</p>
    </div>
    <div class="faq-item">
        <div class="faq-question">Do I need to respond to every OCC filing on my section?</div>
        <p class="faq-answer">No. The filing that requires action is a pooling order, which gives you a 20-day deadline. Spacing and increased density applications have optional hearings. Other filings like permits and completions are informational &mdash; they tell you what&rsquo;s happening but don&rsquo;t require you to do anything.</p>
    </div>
</div>

<h2 id="bottom-line">The Bottom Line</h2>

<p>OCC filings are the public record of everything happening with oil and gas development in Oklahoma. As a mineral owner, you don&rsquo;t need to understand every detail of every filing &mdash; but you do need to know which ones require action (pooling orders), which ones signal upcoming changes (spacing applications, permits), and which ones confirm activity you should track (completions, transfers).</p>

<p>The filing that matters most is the one you don&rsquo;t know about. A spacing application you catch early gives you months to prepare. A pooling order you miss costs you money. Building some kind of regular monitoring habit &mdash; whether it&rsquo;s checking the OCC website yourself, working with a landman, or using an automated service &mdash; is the single best investment you can make in protecting your mineral interests.</p>
`;

const DIVISION_ORDERS_BODY = `
<p>A division order is one of the most common documents Oklahoma mineral owners encounter &mdash; and one of the most misunderstood. It looks official. It has legal language. It asks for your signature. And the number on it &mdash; something like 0.00292969 &mdash; doesn&rsquo;t look like any ownership interest you&rsquo;ve ever heard of.</p>

<p>The good news: division orders are generally straightforward, and signing one doesn&rsquo;t transfer your ownership or lock you into anything permanent. The important thing is understanding what the document says, verifying that the decimal interest is correct, and knowing what to do if it isn&rsquo;t.</p>

<h2 id="what-is-division-order">What Is a Division Order?</h2>

<p>A division order is an administrative document sent by an oil or gas well operator that serves two purposes. First, it states the operator&rsquo;s calculation of your decimal ownership interest in a specific well. Second, it provides your payment instructions &mdash; name, address, tax ID &mdash; so the operator knows where to send your royalty checks.</p>

<p>Think of it as a receipt and a routing slip combined. The operator is saying: &ldquo;Based on our title examination, we believe you own this decimal interest in this well. Here&rsquo;s what we&rsquo;ll use to calculate your royalty payments. Please confirm this is correct and tell us where to send the money.&rdquo;</p>

<p>Division orders typically arrive after a new well has been drilled and completed, shortly before the first royalty payments begin. You might also receive a new division order when well ownership changes hands (an operator transfer), when a title correction affects your interest, or when a new well is drilled in a unit where you already have an interest.</p>

<div class="callout">
    <div class="callout-title">Key Point</div>
    <p>Under Oklahoma law, <strong>a division order is not a conveyance of your mineral rights</strong>. Signing a division order does not transfer, reduce, or modify your actual ownership. It is a statement of what the operator believes your interest to be, based on their title examination. If the decimal is wrong, your actual ownership &mdash; as established by your deeds and other recorded title documents &mdash; controls.</p>
</div>

<h2 id="anatomy">Anatomy of a Division Order</h2>

<p>Division orders vary somewhat in format between operators, but they all contain the same core information. Here&rsquo;s what you&rsquo;ll see and what each field means:</p>

<div class="do-anatomy">
    <div class="do-anatomy-header">Sample Division Order &mdash; Key Fields</div>
    <div class="do-field">
        <div class="do-field-label">Well Name</div>
        <div class="do-field-value">The operator&rsquo;s name for the well, usually combining a lease name and well number (e.g., &ldquo;Price 15-1H&rdquo;). The name may reference the section number and indicate whether it&rsquo;s a horizontal (&ldquo;H&rdquo;) well.</div>
    </div>
    <div class="do-field">
        <div class="do-field-label">API Number</div>
        <div class="do-field-value">A unique identifier assigned to every well in the United States. Oklahoma API numbers start with &ldquo;35&rdquo; (the state code) followed by the county code and well number. This is the definitive way to identify a specific well.</div>
    </div>
    <div class="do-field">
        <div class="do-field-label">Legal Description</div>
        <div class="do-field-value">The section, township, range, and county where the well is located. For horizontal wells, this may reference multiple sections if the lateral crosses section boundaries.</div>
    </div>
    <div class="do-field">
        <div class="do-field-label">Owner Name</div>
        <div class="do-field-value">Your name (or the name of your trust, estate, or entity). Verify this matches exactly how your ownership is recorded at the county clerk&rsquo;s office.</div>
    </div>
    <div class="do-field do-highlight">
        <div class="do-field-label">Decimal Interest</div>
        <div class="do-field-value">Your ownership interest expressed as a decimal fraction (e.g., 0.00292969). This is the number used to calculate your royalty check each month. This is the single most important number on the document &mdash; verify it carefully.</div>
    </div>
    <div class="do-field">
        <div class="do-field-label">Interest Type</div>
        <div class="do-field-value">Indicates whether your interest is a royalty interest (RI), overriding royalty interest (ORRI), working interest (WI), or other type. Most mineral owners who have leased or been pooled will see &ldquo;RI&rdquo; &mdash; royalty interest.</div>
    </div>
    <div class="do-field">
        <div class="do-field-label">Payment Info</div>
        <div class="do-field-value">Your mailing address for royalty checks and your tax identification number (SSN or EIN). The operator needs this to issue your payments and your annual 1099 tax form.</div>
    </div>
</div>

<h2 id="decimal-interest">Understanding Your Decimal Interest</h2>

<p>The decimal interest is where most mineral owners&rsquo; eyes glaze over. It&rsquo;s a small number &mdash; often something like 0.002 or 0.0005 &mdash; and it can feel disconnected from any ownership you recognize. But the math is actually straightforward once you understand what goes into it.</p>

<p>Your decimal interest is the product of three factors: your net mineral acres, the unit size, and your royalty rate.</p>

<div class="math-example">
    <div class="math-example-title">Example 1: Standard Single-Section Well</div>
    <div class="math-row">
        <span class="math-label">Your net mineral acres</span>
        <span class="math-value">10 NMA</span>
    </div>
    <div class="math-row">
        <span class="math-label">Unit size</span>
        <span class="math-value">640 acres (one section)</span>
    </div>
    <div class="math-row">
        <span class="math-label">Royalty rate</span>
        <span class="math-value">3/16 (0.1875)</span>
    </div>
    <div class="math-divider"></div>
    <div class="math-row">
        <span class="math-label">Calculation</span>
        <span class="math-value">(10 &divide; 640) &times; 0.1875</span>
    </div>
    <div class="math-result">
        <span class="math-label">Your decimal interest</span>
        <span class="math-value">0.00292969</span>
    </div>
</div>

<p>That means for every dollar the well generates in gross revenue, you receive approximately $0.0029 &mdash; or about $2.93 for every $1,000 in production revenue. On a well producing $200,000/month in gross revenue, your monthly royalty check would be about $586.</p>

<div class="math-example">
    <div class="math-example-title">Example 2: Multi-Section Horizontal Well</div>
    <div class="math-row">
        <span class="math-label">Your net mineral acres</span>
        <span class="math-value">10 NMA in Section 15</span>
    </div>
    <div class="math-row">
        <span class="math-label">Well spans</span>
        <span class="math-value">Section 15 and Section 22</span>
    </div>
    <div class="math-row">
        <span class="math-label">Lateral allocation</span>
        <span class="math-value">55% in Section 15, 45% in Section 22</span>
    </div>
    <div class="math-row">
        <span class="math-label">Royalty rate</span>
        <span class="math-value">1/5 (0.20)</span>
    </div>
    <div class="math-divider"></div>
    <div class="math-row">
        <span class="math-label">Calculation</span>
        <span class="math-value">(10 &divide; 640) &times; 0.55 &times; 0.20</span>
    </div>
    <div class="math-result">
        <span class="math-label">Your decimal interest</span>
        <span class="math-value">0.00171875</span>
    </div>
</div>

<p>Multi-section wells make the math more complex because the production is allocated between sections based on the percentage of the lateral in each section. This is why your decimal interest might be different for two wells in the same section &mdash; the lateral allocation can vary.</p>

<div class="callout callout-tip">
    <div class="callout-title">Checking the math</div>
    <p>To verify your decimal interest, you need three numbers: your net mineral acres in the section (from your deeds or title opinion), the total acres in the drilling unit (typically 640 for a section), and your royalty rate (from your lease, pooling order, or lease terms). If the well spans multiple sections, you&rsquo;ll also need the lateral allocation percentage. Multiply your NMA &divide; unit acres &times; royalty rate &times; lateral allocation (if applicable). If your calculation doesn&rsquo;t match the division order, contact the operator before signing.</p>
</div>

<h2 id="should-you-sign">Should You Sign It?</h2>

<p>In most cases, yes &mdash; after you&rsquo;ve verified the decimal interest is correct. Here&rsquo;s the practical reasoning:</p>

<p><strong>Signing gets your royalty checks flowing.</strong> Operators typically begin paying royalties after receiving your signed division order. While Oklahoma law requires operators to pay within certain timeframes regardless, in practice an unsigned division order often means your payments go into suspense until the issue is resolved.</p>

<p><strong>Signing doesn&rsquo;t change your ownership.</strong> Oklahoma&rsquo;s Division Order Act (Title 52, Section 570.10 et seq.) explicitly states that division orders do not amend the terms of an existing lease or constitute a conveyance of any interest. Your actual ownership is determined by your title documents, not by the division order. If the operator later discovers a title error and needs to adjust your decimal, they&rsquo;ll send you a corrected division order.</p>

<p><strong>Signing doesn&rsquo;t prevent you from disputing the decimal later.</strong> If you discover after signing that the decimal was wrong &mdash; maybe you find a deed that shows you own more than the operator calculated &mdash; you can contact the operator and request a correction. The division order is not a final settlement of your ownership.</p>

<div class="callout callout-warning">
    <div class="callout-title">When not to sign</div>
    <p><strong>Do not sign if the decimal interest looks wrong.</strong> If you&rsquo;ve done the math and your calculation doesn&rsquo;t match the division order, or if the ownership name or property description is incorrect, contact the operator&rsquo;s division order department before signing. Explain the discrepancy and provide supporting documentation (deeds, probate decree, title opinion). Signing an incorrect division order doesn&rsquo;t change your actual ownership, but it&rsquo;s easier to resolve errors before payments start flowing than after.</p>
</div>

<h2 id="verification-checklist">Division Order Verification Checklist</h2>

<p>Before signing a division order, walk through this checklist:</p>

<div class="checklist">
    <div class="check-item">
        <div class="check-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20,6 9,17 4,12"/></svg></div>
        <div class="check-text"><strong>Verify the well location.</strong> Does the section, township, range, and county match a property where you own minerals? If you don&rsquo;t recognize the location, it could be a well on a property you forgot about &mdash; or it could be an error.</div>
    </div>
    <div class="check-item">
        <div class="check-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20,6 9,17 4,12"/></svg></div>
        <div class="check-text"><strong>Verify your name and address.</strong> Make sure the owner name matches how your interest is recorded. If you inherited and the name still shows the deceased owner, the operator may need your probate or heirship documentation before they can update the division order.</div>
    </div>
    <div class="check-item">
        <div class="check-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20,6 9,17 4,12"/></svg></div>
        <div class="check-text"><strong>Check the interest type.</strong> If you leased your minerals or were pooled, you should see &ldquo;RI&rdquo; (royalty interest). If you elected to participate as a working interest owner, you should see &ldquo;WI.&rdquo; If the interest type doesn&rsquo;t match your situation, something may be wrong.</div>
    </div>
    <div class="check-item">
        <div class="check-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20,6 9,17 4,12"/></svg></div>
        <div class="check-text"><strong>Calculate your expected decimal.</strong> Using your net mineral acres, the unit size, and your royalty rate, calculate what your decimal should be. Compare it to what&rsquo;s on the division order. Small rounding differences (in the 6th or 7th decimal place) are normal. Larger discrepancies need investigation.</div>
    </div>
    <div class="check-item">
        <div class="check-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20,6 9,17 4,12"/></svg></div>
        <div class="check-text"><strong>Check for multi-section allocation.</strong> If the well is a horizontal that crosses multiple sections, make sure the lateral allocation percentage is reasonable. You can compare the division order against the well&rsquo;s completion report to see the lateral path.</div>
    </div>
    <div class="check-item">
        <div class="check-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20,6 9,17 4,12"/></svg></div>
        <div class="check-text"><strong>Compare against prior division orders.</strong> If you have an existing division order for another well in the same section, compare the decimals. They should be similar unless the royalty rate, unit configuration, or lateral allocation is different.</div>
    </div>
    <div class="check-item">
        <div class="check-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20,6 9,17 4,12"/></svg></div>
        <div class="check-text"><strong>Read the fine print.</strong> Some division orders include additional clauses &mdash; post-production cost deductions, interest rate terms for late payments, or dispute resolution procedures. These should align with the terms of your lease or pooling order.</div>
    </div>
</div>

<h2 id="common-issues">Common Division Order Issues</h2>

<h3>The decimal is wrong</h3>

<p>This is the most common issue. The operator&rsquo;s title examination may have missed a deed, used an incorrect heirship determination, or made a mathematical error. If your calculation doesn&rsquo;t match the division order, contact the operator&rsquo;s division order department in writing. Provide your calculation and the supporting documentation &mdash; deeds, probate decrees, affidavits of heirship &mdash; so they can review and correct.</p>

<h3>You don&rsquo;t recognize the well</h3>

<p>If you receive a division order for a well you&rsquo;ve never heard of, it could mean: a new well was drilled on a section where you own minerals (check the legal description against your properties), a multi-section horizontal well crosses into your section from an adjacent section, or the operator sent it to the wrong person. Don&rsquo;t ignore it &mdash; investigate first.</p>

<h3>The owner name is wrong</h3>

<p>If the division order is addressed to a deceased family member or uses an incorrect name, the operator likely hasn&rsquo;t received documentation of the ownership change. Send them a copy of the probate decree, affidavit of heirship, or other transfer document so they can update their records and reissue the division order in the correct name.</p>

<h3>You receive a corrected division order</h3>

<p>Operators periodically send corrected or updated division orders when title information changes. If your decimal went up, it means additional ownership was attributed to you &mdash; possibly from a title correction or an heir being removed. If your decimal went down, ask the operator to explain the change. You have the right to understand any reduction in your calculated interest.</p>

<h3>You never received a division order</h3>

<p>If there&rsquo;s a producing well on your section and you haven&rsquo;t received a division order, the operator may not have your contact information or may not have identified you as an owner. Contact the operator directly &mdash; you can find the operator&rsquo;s name through the OCC well records. Provide documentation of your ownership so they can include you in the division order.</p>

<h2 id="division-orders-vs-leases">Division Orders vs. Leases vs. Pooling Orders</h2>

<p>Mineral owners sometimes confuse these three documents. Here&rsquo;s how they&rsquo;re different:</p>

<p><strong>A lease</strong> is a contract between you and an operator that grants them the right to drill on your minerals. It establishes your bonus payment, royalty rate, and the terms under which the operator can develop your minerals. A lease is a binding contract that can last for years.</p>

<p><strong>A pooling order</strong> is issued by the OCC when not all mineral owners in a drilling unit have signed leases. It gives you election options &mdash; cash bonus, participation, or nonconsent &mdash; and has a 20-day deadline. See our <a href="/insights/guides/understanding-pooling-orders" style="color: var(--red-dirt); font-weight: 600;">pooling orders guide</a> for details.</p>

<p><strong>A division order</strong> comes after leasing or pooling is complete and the well has been drilled. It&rsquo;s the operator&rsquo;s calculation of what you&rsquo;re owed based on the terms of your lease or pooling election. It doesn&rsquo;t establish new rights &mdash; it operationalizes the rights you already have.</p>

<p>The key distinction: leases and pooling orders determine your terms. Division orders calculate your share based on those terms. If your division order decimal doesn&rsquo;t match what you&rsquo;d expect from your lease or pooling election, that&rsquo;s the discrepancy to investigate.</p>

<h2 id="suspense">Payments in Suspense</h2>

<p>If there&rsquo;s an issue with your division order &mdash; you haven&rsquo;t signed it, the operator can&rsquo;t verify your ownership, there&rsquo;s a title dispute, or there&rsquo;s a missing heir &mdash; the operator may place your royalty payments &ldquo;in suspense.&rdquo; This means the money is being held, not lost. It accrues and should be paid to you once the issue is resolved.</p>

<p>Oklahoma law requires operators to pay interest on suspended royalties under certain circumstances. If your payments have been in suspense for an extended period, you may be entitled to statutory interest on top of the royalty amount. An oil and gas attorney can advise you on your specific rights.</p>

<p>Common reasons for suspense: unsigned division order, unresolved title issues (missing probate, unclear heirship), missing tax identification number, or the operator can&rsquo;t locate the mineral owner. If you suspect your royalties are in suspense, contact the operator&rsquo;s division order or owner relations department.</p>

<h2 id="keeping-records">Keeping Good Records</h2>

<p>Every division order you receive should be kept permanently. These documents form a record of your ownership across every well on your properties, and they&rsquo;re invaluable for:</p>

<p><strong>Verifying royalty payments.</strong> When your monthly royalty check arrives, you can use the decimal interest from your division order and the production volumes from the OCC to verify the payment amount. This is how you catch underpayments.</p>

<p><strong>Tax preparation.</strong> Your division orders, combined with your annual 1099s from each operator, provide the documentation your accountant needs to properly report your royalty income and claim your depletion deduction.</p>

<p><strong>Estate planning.</strong> A complete set of division orders gives your heirs a clear picture of what you own, who operates each well, and what income the minerals generate. This makes the inheritance process dramatically easier for the next generation.</p>

<p><strong>Selling or leasing.</strong> If you ever consider selling your minerals or negotiating a new lease, your division orders provide an organized summary of your producing interests. A mineral buyer or landman will ask for this information.</p>

<h2 id="faq">Frequently Asked Questions</h2>

<div class="faq-section">
    <div class="faq-item">
        <div class="faq-question">What is a division order?</div>
        <p class="faq-answer">A division order is a document from an operator that states your decimal ownership interest in a specific well and authorizes the operator to distribute royalty payments to you. It is primarily an administrative document &mdash; it tells the operator how much to pay you and where to send the check.</p>
    </div>
    <div class="faq-item">
        <div class="faq-question">Should I sign a division order?</div>
        <p class="faq-answer">Generally yes, after verifying the decimal interest is correct. Signing does not change your actual ownership under Oklahoma law. However, if the decimal is wrong, contact the operator to dispute it before signing. An unsigned division order can delay your royalty payments.</p>
    </div>
    <div class="faq-item">
        <div class="faq-question">How is my decimal interest calculated?</div>
        <p class="faq-answer">Your decimal is your net mineral acres divided by the total acres in the drilling unit, multiplied by your royalty rate. For multi-section wells, the calculation also factors in the lateral allocation percentage. For example: 10 NMA &divide; 640 acres &times; 3/16 royalty = 0.00292969.</p>
    </div>
    <div class="faq-item">
        <div class="faq-question">What happens if I don&rsquo;t sign a division order?</div>
        <p class="faq-answer">The operator may hold your royalty payments in suspense until the issue is resolved. Oklahoma law requires payment within certain timeframes regardless, but unsigned orders often cause practical delays. If you&rsquo;re disputing the decimal, communicate that in writing.</p>
    </div>
    <div class="faq-item">
        <div class="faq-question">Can a division order change my ownership?</div>
        <p class="faq-answer">No. Under Oklahoma&rsquo;s Division Order Act, a division order is not a transfer of ownership. Your actual ownership is determined by your deeds, probate decrees, and other title documents. If a division order contains an error, it does not change what you actually own.</p>
    </div>
    <div class="faq-item">
        <div class="faq-question">Why did my decimal interest change on a new division order?</div>
        <p class="faq-answer">Common reasons include: a title correction, a new well with different unit size or lateral allocation, a royalty rate change from a new lease or pooling, or the addition of new owners (like heirs) that reduced your proportional share. Ask the operator to explain any changes.</p>
    </div>
</div>

<h2 id="bottom-line">The Bottom Line</h2>

<p>Division orders are routine, not scary. They don&rsquo;t change your ownership, they don&rsquo;t commit you to anything permanent, and in most cases they&rsquo;re correct. But &ldquo;most cases&rdquo; isn&rsquo;t &ldquo;all cases,&rdquo; and the difference between a correct decimal and an incorrect one shows up in every single royalty check for the life of the well.</p>

<p>Take 15 minutes to verify the math before you sign. Know your net mineral acres, your unit size, and your royalty rate. If the numbers check out, sign it and start collecting your royalties. If they don&rsquo;t, make a call. That one phone call could be worth thousands of dollars over the life of the well.</p>
`;

const NAVIGATING_OCC_WEBSITE_BODY = `
<p>The OCC website &mdash; accessible at <a href="https://oklahoma.gov/occ" target="_blank" rel="noopener"><strong>oklahoma.gov/occ</strong></a> &mdash; is the public-facing hub for everything the Oklahoma Corporation Commission regulates. For mineral owners, the Oil and Gas Conservation Division section is where the action is. But the site isn&rsquo;t built for mineral owners. It&rsquo;s built for operators, regulators, and attorneys. The information you need is all there; the challenge is knowing which of the half-dozen different databases to use, and how to search each one.</p>

<p>This guide walks through each tool that matters for mineral owners, explains what it does, and shows you step by step how to use it to find information about your sections. We&rsquo;ll cover how to look up wells, find drilling permits, search for spacing and pooling orders, access scanned documents, and check production data &mdash; all using free, publicly available OCC databases.</p>

<h2 id="quick-reference">Quick Reference: Which Tool Does What</h2>

<p>Before diving into the details, here&rsquo;s a quick map of the OCC&rsquo;s online tools and what each one is best for. The OCC has accumulated multiple overlapping systems over the years, and knowing which one to use for a given task saves a lot of time.</p>

<div style="overflow-x: auto;">
    <table class="quick-ref">
        <thead>
            <tr>
                <th>Tool</th>
                <th>Best For</th>
                <th>URL</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td><strong>Well Browse</strong></td>
                <td>Looking up well details by legal description, API number, or operator</td>
                <td><a href="https://wellbrowse.occ.ok.gov" target="_blank" rel="noopener" class="tool-url">wellbrowse.occ.ok.gov</a></td>
            </tr>
            <tr>
                <td><strong>Well Data Finder</strong></td>
                <td>Visual/map-based well search using GIS</td>
                <td><a href="https://oklahoma.gov/occ" target="_blank" rel="noopener" class="tool-url">oklahoma.gov/occ</a> (GIS Data &amp; Maps)</td>
            </tr>
            <tr>
                <td><strong>Electronic Case Filing (ECF)</strong></td>
                <td>Spacing, pooling, and other CD cases filed after March 2022</td>
                <td><a href="https://ecf.public.occ.ok.gov" target="_blank" rel="noopener" class="tool-url">ecf.public.occ.ok.gov</a></td>
            </tr>
            <tr>
                <td><strong>Case Processing</strong></td>
                <td>Spacing, pooling, and other CD cases filed before March 2022</td>
                <td><a href="https://case.occ.ok.gov" target="_blank" rel="noopener" class="tool-url">case.occ.ok.gov</a></td>
            </tr>
            <tr>
                <td><strong>Imaging System</strong></td>
                <td>Scanned documents: Form 1000s, 1002As, well logs, orders</td>
                <td><a href="https://imaging.occ.ok.gov" target="_blank" rel="noopener" class="tool-url">imaging.occ.ok.gov</a></td>
            </tr>
            <tr>
                <td><strong>RBDMS Data Explorer</strong></td>
                <td>Advanced search, reports, and data export</td>
                <td><a href="https://oklahoma.gov/occ" target="_blank" rel="noopener" class="tool-url">oklahoma.gov/occ</a> (Oil &amp; Gas Division)</td>
            </tr>
            <tr>
                <td><strong>Weekly/Daily Dockets</strong></td>
                <td>Upcoming hearing schedules for CD cases</td>
                <td><a href="https://oklahoma.gov/occ" target="_blank" rel="noopener" class="tool-url">oklahoma.gov/occ</a> (Court Dockets)</td>
            </tr>
        </tbody>
    </table>
</div>

<div class="callout callout-warning">
    <div class="callout-title">Two systems, one dividing line: March 21, 2022</div>
    <p>The OCC launched its Electronic Case Filing (ECF) system on March 21, 2022. This is the critical date to remember. Cases filed <strong>after</strong> that date live in ECF. Cases filed <strong>before</strong> that date live in the older Case Processing system and the Imaging system. If you&rsquo;re searching for a case and can&rsquo;t find it, make sure you&rsquo;re looking in the right system based on when it was filed.</p>
</div>

<h2 id="well-browse">Well Browse Database</h2>

<div class="tool-card">
    <div class="tool-card-header">
        <div class="tool-icon tool-icon-well">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
        </div>
        <div>
            <div class="tool-card-title">Well Browse Database</div>
            <div class="tool-card-subtitle"><a href="https://wellbrowse.occ.ok.gov" target="_blank" rel="noopener" class="tool-url">wellbrowse.occ.ok.gov</a></div>
        </div>
    </div>
    <div class="tool-card-body">
        <p>The Well Browse Database is the workhorse tool for mineral owners. It contains records for every well under OCC jurisdiction &mdash; active producers, plugged and abandoned wells, permitted-but-not-yet-drilled wells, and injection wells. This is where you go to answer the basic question: what wells are on (or have ever been on) my section?</p>

        <p>The database lets you search by well name, API number, county, operator name or number, and &mdash; most usefully for mineral owners &mdash; by legal description (section, township, and range). Each well record includes permit data, completion data, bottom hole location, and production information.</p>

        <div class="step-box">
            <ol>
                <li>Go to <a href="https://wellbrowse.occ.ok.gov" target="_blank" rel="noopener"><strong>wellbrowse.occ.ok.gov</strong></a></li>
                <li>Scroll to the bottom of the search form to the <strong>Legal Description</strong> fields</li>
                <li>Enter your <strong>Section</strong>, <strong>Township</strong>, and <strong>Range</strong> &mdash; for single-digit numbers, enter them as-is (e.g., &ldquo;4&rdquo; not &ldquo;04&rdquo;)</li>
                <li>If your property is in the panhandle, select the <strong>County</strong> &mdash; otherwise it&rsquo;s optional</li>
                <li>Click <strong>Search</strong></li>
                <li>Browse the results list &mdash; click any well to see its full record, then use the <strong>Permits</strong>, <strong>Completions</strong>, <strong>Production</strong>, and <strong>All Images</strong> buttons to access detailed data</li>
            </ol>
        </div>

        <div class="tool-detail">
            <div class="tool-detail-item">
                <h4>What You&rsquo;ll Find</h4>
                <p>Permit status, completion data, operator info, formation, total depth, production volumes, bottom hole location, well status.</p>
            </div>
            <div class="tool-detail-item">
                <h4>Tips</h4>
                <p>The API Number Suffix tracks multiple events on the same well &mdash; the highest suffix is the current record. Results can be exported to CSV.</p>
            </div>
        </div>
    </div>
</div>

<div class="callout callout-tip">
    <div class="callout-title">Understanding legal descriptions</div>
    <p>Oklahoma uses the Section-Township-Range system for legal descriptions. A section is a one-square-mile area (640 acres). Your section number, township, and range are the keys that unlock everything on the OCC website. You&rsquo;ll find them on your lease, your division order, or your royalty check stub. If you only have a street address for your surface property, you can use the county assessor&rsquo;s website to look up the legal description.</p>
</div>

<h2 id="well-data-finder">Well Data Finder (GIS Map)</h2>

<div class="tool-card">
    <div class="tool-card-header">
        <div class="tool-icon tool-icon-gis">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
        </div>
        <div>
            <div class="tool-card-title">Well Data Finder</div>
            <div class="tool-card-subtitle">GIS-Based Map Application</div>
        </div>
    </div>
    <div class="tool-card-body">
        <p>The Well Data Finder is the OCC&rsquo;s map-based well search tool, built on ArcGIS. Instead of entering search criteria into a form, you navigate a map and see wells plotted as points on the landscape. This is particularly useful when you want to see the spatial relationship between wells &mdash; for instance, understanding which wells have laterals crossing your section, or seeing how dense the drilling pattern is in your area.</p>

        <p>You can search by well name, API number, operator, or legal location. Clicking a well point on the map brings up its basic information and links to detailed records. The section grid overlay helps you identify your section visually.</p>

        <div class="step-box">
            <ol>
                <li>Navigate to the OCC website &rarr; Oil &amp; Gas Division &rarr; <strong>GIS Data and Maps</strong></li>
                <li>Click <strong>OCC Well Data Finder</strong> to launch the map application</li>
                <li>Use the <strong>search bar</strong> or zoom/pan to navigate to your area</li>
                <li>Turn on the <strong>section grid layer</strong> to see section boundaries</li>
                <li>Click individual well points to view details and follow links to full records</li>
            </ol>
        </div>

        <div class="tool-detail">
            <div class="tool-detail-item">
                <h4>Best For</h4>
                <p>Visualizing well patterns, seeing horizontal lateral paths, understanding spatial relationships between wells and your section.</p>
            </div>
            <div class="tool-detail-item">
                <h4>Complements</h4>
                <p>Use Well Data Finder to identify wells visually, then switch to Well Browse for detailed data on specific wells.</p>
            </div>
        </div>
    </div>
</div>

<h2 id="ecf">Electronic Case Filing (ECF)</h2>

<div class="tool-card">
    <div class="tool-card-header">
        <div class="tool-icon tool-icon-ecf">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        </div>
        <div>
            <div class="tool-card-title">Electronic Case Filing (ECF)</div>
            <div class="tool-card-subtitle"><a href="https://ecf.public.occ.ok.gov" target="_blank" rel="noopener" class="tool-url">ecf.public.occ.ok.gov</a> &middot; Cases filed after March 21, 2022</div>
        </div>
    </div>
    <div class="tool-card-body">
        <p>For mineral owners, ECF is where you find the filings that matter most: spacing applications, pooling orders, increased density applications, and other Conservation Docket (CD) cases. When an operator files to space your section, pool your interests, or drill additional wells, those filings show up here.</p>

        <p>The ECF system supports two search modes: <strong>Case Search</strong> and <strong>Document Search</strong>. Both let you filter by Program Area (choose &ldquo;Oil &amp; Gas&rdquo;), Docket Type (choose &ldquo;Conservation Docket&rdquo;), Relief Type (such as &ldquo;Spacing,&rdquo; &ldquo;Pooling,&rdquo; or &ldquo;Increased Density&rdquo;), case number, party name, legal description, and filing date range.</p>

        <div class="step-box">
            <ol>
                <li>Go to <a href="https://ecf.public.occ.ok.gov" target="_blank" rel="noopener"><strong>ecf.public.occ.ok.gov</strong></a> and click <strong>Advanced Search</strong></li>
                <li>Select <strong>Case</strong> as the Search Type</li>
                <li>Under Program Area, select <strong>Oil &amp; Gas</strong></li>
                <li>Under Docket Type, select <strong>Conservation Docket</strong></li>
                <li>To narrow results: select a <strong>Relief Type</strong> (e.g., Spacing, Pooling), enter a <strong>legal description</strong>, or enter a <strong>party name</strong></li>
                <li>Click <strong>Search</strong> &mdash; results can be sorted by clicking column headers</li>
                <li>Click a case number to view its details, service list, and docket of filed documents</li>
            </ol>
        </div>

        <p>The case number format in ECF uses a ten-character format: two-letter docket code followed by the year and a six-digit sequence number. For example, <strong>CD2024-000300</strong> is Conservation Docket case number 300 from 2024.</p>

        <div class="tool-detail">
            <div class="tool-detail-item">
                <h4>Key Relief Types for Mineral Owners</h4>
                <p>Spacing, Pooling, Increased Density, Location Exception, Multiunit Horizontal Well, Unitization.</p>
            </div>
            <div class="tool-detail-item">
                <h4>Document Access</h4>
                <p>Click into any case, then use the Docket tab to see all filed documents. Click &ldquo;View&rdquo; to open individual documents as PDFs.</p>
            </div>
        </div>
    </div>
</div>

<div class="callout">
    <div class="callout-title">Searching by legal description in ECF</div>
    <p>ECF includes a location filter where you can enter section, township, and range. This is the most reliable way to find all cases affecting your section. Keep in mind that multi-unit horizontal wells may reference multiple sections &mdash; search each section you own separately to ensure you&rsquo;re catching everything.</p>
</div>

<h2 id="case-processing">Case Processing (Pre-2022 Cases)</h2>

<div class="tool-card">
    <div class="tool-card-header">
        <div class="tool-icon tool-icon-case">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
        </div>
        <div>
            <div class="tool-card-title">Case Processing System</div>
            <div class="tool-card-subtitle"><a href="https://case.occ.ok.gov" target="_blank" rel="noopener" class="tool-url">case.occ.ok.gov</a> &middot; Cases filed before March 21, 2022</div>
        </div>
    </div>
    <div class="tool-card-body">
        <p>The legacy Case Processing system contains all OCC cases filed before March 21, 2022. If you&rsquo;re researching the history of your section &mdash; such as when it was originally spaced, or what pooling terms were set for an existing well &mdash; this is where you&rsquo;ll find those older records.</p>

        <p>The search interface lets you filter by case type (select &ldquo;CD&rdquo; for Conservation Docket), party name, filing date, relief type (spacing, pooling, increased density, etc.), and legal description (section, township, range, and county).</p>

        <div class="step-box">
            <ol>
                <li>Go to <a href="https://case.occ.ok.gov" target="_blank" rel="noopener"><strong>case.occ.ok.gov</strong></a></li>
                <li>Select <strong>CD</strong> from the Case Type dropdown</li>
                <li>Optionally select a <strong>Relief Sought</strong> code &mdash; 50 for Spacing, 41 for Pooling, 29 for Increased Density, 107 for Multiunit Horizontal Well</li>
                <li>Enter your <strong>Section</strong>, <strong>Township</strong>, and <strong>Range</strong>, or enter a <strong>Party Name</strong> (the operator)</li>
                <li>Click <strong>Search</strong></li>
                <li>Sort results by clicking column headers &mdash; click &ldquo;Filing Date&rdquo; to sort chronologically</li>
                <li>Click <strong>Link to Imaging</strong> for any case to view scanned documents</li>
            </ol>
        </div>

        <div class="tool-detail">
            <div class="tool-detail-item">
                <h4>Coverage</h4>
                <p>All cases filed with the OCC prior to March 21, 2022, across all docket types.</p>
            </div>
            <div class="tool-detail-item">
                <h4>Search Tips</h4>
                <p>Use wildcards (* or %) for partial name searches. Example: &ldquo;Continental*&rdquo; finds all Continental Resources cases.</p>
            </div>
        </div>
    </div>
</div>

<h2 id="imaging">OCC Imaging System</h2>

<div class="tool-card">
    <div class="tool-card-header">
        <div class="tool-icon tool-icon-imaging">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        </div>
        <div>
            <div class="tool-card-title">OCC Imaging System</div>
            <div class="tool-card-subtitle"><a href="https://imaging.occ.ok.gov" target="_blank" rel="noopener" class="tool-url">imaging.occ.ok.gov</a> &middot; Scanned Documents</div>
        </div>
    </div>
    <div class="tool-card-body">
        <p>The Imaging system is the OCC&rsquo;s document archive. This is where you find the actual scanned PDF copies of Form 1000s (drilling permits), Form 1002As (completion reports), well logs, unitization orders, Commission orders, and other filed documents. When you need to see the original document &mdash; not just a database summary &mdash; this is where you go.</p>

        <p>The system is organized by document type. From the main page, select the category you need:</p>

        <div class="step-box">
            <ol>
                <li>Go to <a href="https://imaging.occ.ok.gov" target="_blank" rel="noopener"><strong>imaging.occ.ok.gov</strong></a></li>
                <li>Select a document category &mdash; the most useful for mineral owners are <strong>Oil and Gas Well Records Forms</strong> and <strong>Commission Orders and Case Files</strong></li>
                <li>For well records: choose the <strong>Form #</strong> (e.g., 1000 for permits, 1002A for completions), then search by API number, operator, legal description, or scan date range</li>
                <li>For orders and case files: search by cause number, case type, or filing date</li>
                <li>Click a document ID to open the scanned PDF</li>
            </ol>
        </div>

        <div class="tool-detail">
            <div class="tool-detail-item">
                <h4>Key Document Types</h4>
                <p>Form 1000 (permit to drill), Form 1002A (completion report), well logs, production records, Commission orders, unitization documents.</p>
            </div>
            <div class="tool-detail-item">
                <h4>Note</h4>
                <p>For case documents filed after March 2022, use ECF instead. The Imaging system contains pre-2022 case documents and ongoing well records forms.</p>
            </div>
        </div>
    </div>
</div>

<h2 id="data-explorer">RBDMS Data Explorer</h2>

<div class="tool-card">
    <div class="tool-card-header">
        <div class="tool-icon tool-icon-data">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        </div>
        <div>
            <div class="tool-card-title">RBDMS Data Explorer</div>
            <div class="tool-card-subtitle">Risk-Based Data Management System</div>
        </div>
    </div>
    <div class="tool-card-body">
        <p>The RBDMS Data Explorer is the OCC&rsquo;s newest search tool, designed to provide more flexible access to the underlying well and entity data. It offers two search methods: a <strong>filter search</strong> where you build queries using specific criteria, and a <strong>full text search</strong> where you can type any combination of terms and the system returns matching records.</p>

        <p>The Data Explorer also has a reporting feature that can generate reports for any chosen timeframe using publicly available OCC data. This is useful for mineral owners who want to see a summary of activity on their sections over a specific period &mdash; new permits, completions, and status changes.</p>

        <p>You&rsquo;ll find the RBDMS Data Explorer linked from the Oil &amp; Gas Conservation Division page at <a href="https://oklahoma.gov/occ" target="_blank" rel="noopener">oklahoma.gov/occ</a>.</p>

        <div class="tool-detail">
            <div class="tool-detail-item">
                <h4>Best For</h4>
                <p>Flexible searching, generating date-ranged reports, exporting data for analysis.</p>
            </div>
            <div class="tool-detail-item">
                <h4>Access</h4>
                <p>Oil &amp; Gas Division page &rarr; RBDMS Data Explorer link. Help guide available on the same page.</p>
            </div>
        </div>
    </div>
</div>

<h2 id="dockets">Weekly and Daily Dockets</h2>

<div class="tool-card">
    <div class="tool-card-header">
        <div class="tool-icon tool-icon-docket">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        </div>
        <div>
            <div class="tool-card-title">Weekly &amp; Daily Dockets</div>
            <div class="tool-card-subtitle">Hearing Schedules</div>
        </div>
    </div>
    <div class="tool-card-body">
        <p>The OCC publishes weekly and daily dockets as searchable PDFs on their website. These dockets list upcoming hearings &mdash; including the spacing and pooling hearings that directly affect mineral owners. Each entry includes the case number, applicant name, legal description, type of relief sought, and hearing date and time.</p>

        <p>This is important because a hearing is where decisions get made. If a spacing or pooling application is on the docket and you haven&rsquo;t responded, attending the hearing (or ensuring your attorney does) is your last opportunity to be heard before the order is issued.</p>

        <p>Find the dockets at: <a href="https://oklahoma.gov/occ" target="_blank" rel="noopener">oklahoma.gov/occ</a> &rarr; Court Dockets &rarr; select <strong>Weekly Dockets</strong> or <strong>Daily Dockets</strong>. Each PDF is searchable using Ctrl+F, so you can search for your section number or an operator name.</p>

        <div class="tool-detail">
            <div class="tool-detail-item">
                <h4>Best For</h4>
                <p>Tracking upcoming hearing dates for spacing, pooling, and increased density cases on your sections.</p>
            </div>
            <div class="tool-detail-item">
                <h4>Format</h4>
                <p>Searchable PDFs posted to the OCC website. Use Ctrl+F to find your section or operator.</p>
            </div>
        </div>
    </div>
</div>

<h2 id="common-tasks">Common Tasks for Mineral Owners</h2>

<p>Now that you know the tools, here&rsquo;s how to accomplish the specific tasks that come up most often as a mineral owner.</p>

<h3>Finding all wells on your section</h3>

<p>Start with the <strong>Well Browse Database</strong>. Enter your section, township, and range, and search. The results will include every well on record for that section &mdash; active producers, plugged wells, and permitted-but-not-yet-drilled wells. Pay attention to the well status field: &ldquo;A&rdquo; means active, &ldquo;P&rdquo; means plugged, &ldquo;N&rdquo; means new (permitted but not yet drilled). Check the completion data to see what formation each well targets and who the operator is.</p>

<h3>Checking if a new drilling permit has been filed</h3>

<p>Drilling permits are Form 1000 filings. New permits will show up in the <strong>Well Browse Database</strong> as wells with a permit status but no completion date. For the actual Form 1000 document &mdash; which shows the proposed well location, target depth, and operator details &mdash; use the <strong>Imaging system</strong>, select &ldquo;Oil and Gas Well Records Forms,&rdquo; choose Form 1000, and search by your legal description or a scan date range.</p>

<h3>Finding a spacing or pooling order</h3>

<p>These are Conservation Docket (CD) cases. If the case was filed <strong>after March 21, 2022</strong>, search in <strong>ECF</strong>. Select Oil &amp; Gas &rarr; Conservation Docket, then filter by Relief Type (Spacing or Pooling) and enter your legal description. If the case was filed <strong>before March 2022</strong>, use the <strong>Case Processing</strong> system and search by the operator name or the case number if you have it.</p>

<h3>Reading a completion report</h3>

<p>Completion reports (Form 1002A) tell you what the operator found when they drilled. They include the formation name, total depth, perforated intervals, initial production rates, and completion method. Find them in the <strong>Well Browse Database</strong> by clicking the &ldquo;Completions&rdquo; button on a well record, or view the scanned document in the <strong>Imaging system</strong> by searching for Form 1002A with the well&rsquo;s API number.</p>

<h3>Verifying who operates a well</h3>

<p>The <strong>Well Browse Database</strong> shows the current operator for each well. If you need the operator&rsquo;s contact information or operator number, use the <strong>Operator Directory</strong> &mdash; accessible from the Oil &amp; Gas Division page under &ldquo;Database Search and Imaged Documents.&rdquo;</p>

<h3>Checking production data</h3>

<p>The <strong>Well Browse Database</strong> includes gas production data under the &ldquo;Production&rdquo; tab for gas-classified wells. The <strong>RBDMS Data Explorer</strong> can generate production reports for specific timeframes. For gross production volumes and tax data (especially oil production), the Oklahoma Tax Commission&rsquo;s gross production reporting system is the primary source &mdash; though that&rsquo;s a separate agency from the OCC.</p>

<div class="callout callout-tip">
    <div class="callout-title">Cross-referencing tip</div>
    <p>The most effective approach for mineral owners is to cross-reference multiple OCC tools. Start with Well Browse to identify wells on your section, then check ECF for any pending or recent cases (spacing, pooling, increased density), then use the Imaging system to pull the actual documents you need. This three-step process gives you the most complete picture of what&rsquo;s happening on your property.</p>
</div>

<h2 id="forms-reference">Key OCC Forms for Mineral Owners</h2>

<p>The OCC uses a numbered form system. Knowing which form numbers matter helps you search the Imaging system more efficiently and understand what you&rsquo;re looking at when you find a document.</p>

<div style="overflow-x: auto;">
    <table class="quick-ref">
        <thead>
            <tr>
                <th>Form</th>
                <th>Name</th>
                <th>Why It Matters</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td><strong>Form 1000</strong></td>
                <td>Intent to Drill / Permit to Drill</td>
                <td>Filed when an operator plans to drill. Shows proposed location, target depth, target formation, and operator details. This is the first concrete signal that a rig is coming to your section.</td>
            </tr>
            <tr>
                <td><strong>Form 1002A</strong></td>
                <td>Well Completion Report</td>
                <td>Filed within 60 days of completing a well. Shows actual total depth, formation, perforated intervals, initial production test results, and completion method.</td>
            </tr>
            <tr>
                <td><strong>Form 1073</strong></td>
                <td>Transfer of Operatorship</td>
                <td>Filed when a well changes operators. If your royalty checks start coming from a different company, a 1073 should have been filed.</td>
            </tr>
            <tr>
                <td><strong>Form 1006B</strong></td>
                <td>Operator Agreement</td>
                <td>The operator&rsquo;s registration with the OCC. Contains the operator&rsquo;s name, address, and contact information.</td>
            </tr>
            <tr>
                <td><strong>Form 1014</strong></td>
                <td>Plugging Report</td>
                <td>Filed when a well is plugged and abandoned. If a producing well on your section stops generating royalties, a plugging report will eventually be filed.</td>
            </tr>
        </tbody>
    </table>
</div>

<h2 id="okies">What&rsquo;s Changing: OKIES System</h2>

<p>The OCC is transitioning to a new platform called the <strong>Oklahoma Information Exchange System (OKIES)</strong>, which began phased implementation on June 30, 2025. OKIES is a form management platform that is replacing legacy systems &mdash; starting with the Form 1000 (Intent to Drill) process. Additional forms and processes are being added in phases.</p>

<p>For mineral owners, the key implication is that the way operators submit certain filings is changing. The underlying data &mdash; permits, completions, well records &mdash; will continue to be publicly accessible, but the systems through which you access them may look different over time.</p>

<p>In the meantime, the existing tools described in this guide remain active. Well Browse, ECF, the Imaging system, and the other databases continue to function. If you can&rsquo;t find a recent filing in one system, it&rsquo;s worth checking whether it has moved to OKIES.</p>

<h2 id="limitations">Limitations of the OCC Website</h2>

<p>The OCC website is an invaluable resource, but it has real limitations that mineral owners should understand:</p>

<p><strong>It&rsquo;s not designed for monitoring.</strong> The OCC databases are designed for searching &mdash; you look up something specific. They don&rsquo;t have a built-in way to set alerts or notifications when a new filing appears on your section. If you want to know when a new spacing application or drilling permit is filed, you have to manually check on a regular basis.</p>

<p><strong>Multiple overlapping systems create confusion.</strong> The split between ECF (post-March 2022) and Case Processing (pre-March 2022), combined with the separate Imaging system, Well Browse, Well Data Finder, and RBDMS Data Explorer, means you often need to check multiple places to get the full picture.</p>

<p><strong>Production data is incomplete.</strong> The OCC&rsquo;s production data focuses on gas volumes. For comprehensive production reporting including oil volumes, you often need to go to the Oklahoma Tax Commission, which is a separate system with its own search interface.</p>

<p><strong>Horizontal well tracking is tricky.</strong> A multi-unit horizontal well may have its surface location in one section but its lateral extending through two or three sections. The OCC records the well under its surface location, which means a well producing from your section may not show up when you search your section by legal description alone. You may need to search adjacent sections as well.</p>

<p><strong>Real-time updates aren&rsquo;t guaranteed.</strong> There can be a lag between when a document is filed and when it appears in the online databases. For time-sensitive filings like pooling orders (which have response deadlines), the mailed notice is the official notice &mdash; don&rsquo;t rely solely on the website for deadline tracking.</p>

<div class="callout callout-warning">
    <div class="callout-title">Don&rsquo;t miss pooling deadlines</div>
    <p>Pooling orders have strict response deadlines &mdash; typically 20 days from the date of the order. Missing a deadline means the OCC assigns you a default election, which may not be in your best interest. The official notice comes by mail, but if you&rsquo;re checking the website and see a pooling order on your section, act immediately. Contact the operator or an attorney to understand your options before the deadline passes.</p>
</div>

<h2 id="faq">Frequently Asked Questions</h2>

<div class="faq-section">
    <div class="faq-item">
        <div class="faq-question">How do I search for wells on my section at the OCC?</div>
        <p class="faq-answer">Use the Well Browse Database at wellbrowse.occ.ok.gov. Enter your section, township, and range in the legal description fields and click Search. The results show every well on record for that section. You can also use the Well Data Finder map tool to visually locate wells.</p>
    </div>
    <div class="faq-item">
        <div class="faq-question">Where do I find spacing and pooling orders for my section?</div>
        <p class="faq-answer">For cases filed after March 21, 2022, use the Electronic Case Filing system at ecf.public.occ.ok.gov. Select Oil &amp; Gas &rarr; Conservation Docket, then filter by Relief Type and legal description. For older cases, use the Case Processing system at case.occ.ok.gov.</p>
    </div>
    <div class="faq-item">
        <div class="faq-question">How do I look up a drilling permit on the OCC website?</div>
        <p class="faq-answer">Drilling permits (Form 1000) appear in Well Browse as wells with a permit status. To view the actual document, use the Imaging system at imaging.occ.ok.gov &mdash; select &ldquo;Oil and Gas Well Records Forms,&rdquo; choose Form 1000, and search by API number or legal description.</p>
    </div>
    <div class="faq-item">
        <div class="faq-question">What is the difference between Well Browse and Well Data Finder?</div>
        <p class="faq-answer">Well Browse is a traditional database search returning tabular results with detailed well data. Well Data Finder is a GIS map application showing wells as points on a map. Both access the same data &mdash; Well Browse is better for detail, Well Data Finder is better for spatial context.</p>
    </div>
    <div class="faq-item">
        <div class="faq-question">How do I find completion reports for wells on my section?</div>
        <p class="faq-answer">In Well Browse, search for the well and click &ldquo;Completions&rdquo; to see the data. For the scanned Form 1002A document, use the Imaging system &mdash; select &ldquo;Oil and Gas Well Records Forms,&rdquo; choose Form 1002A, and search by API number.</p>
    </div>
    <div class="faq-item">
        <div class="faq-question">What is the OCC Electronic Case Filing system?</div>
        <p class="faq-answer">ECF is the OCC&rsquo;s current case management platform, launched March 21, 2022. It handles all new case filings including spacing, pooling, and increased density applications. The public can search and view case documents without an account.</p>
    </div>
    <div class="faq-item">
        <div class="faq-question">How do I check production data for a well in Oklahoma?</div>
        <p class="faq-answer">The Well Browse Database includes gas production data under the &ldquo;Production&rdquo; tab. For oil production and gross production tax data, the Oklahoma Tax Commission is the primary source. The RBDMS Data Explorer on the OCC site can also generate production reports.</p>
    </div>
</div>

<h2 id="bottom-line">The Bottom Line</h2>

<p>The OCC website holds an extraordinary amount of public information about every oil and gas well and regulatory filing in Oklahoma. For mineral owners, learning to navigate it effectively is one of the highest-leverage skills you can develop. The tools aren&rsquo;t intuitive, the systems overlap, and the learning curve is real &mdash; but every spacing application, pooling order, drilling permit, and completion report on your sections is in there, waiting to be found.</p>

<p>The practical challenge is that the OCC website is designed for on-demand searching, not proactive monitoring. It can tell you what&rsquo;s happened on your section, but it won&rsquo;t tell you when something new happens. For mineral owners with properties across multiple counties, manually checking each section across multiple OCC databases on a regular basis quickly becomes impractical. That&rsquo;s the gap that automated monitoring fills &mdash; turning the OCC&rsquo;s reactive databases into proactive alerts that reach you when filings appear, rather than when you happen to check.</p>
`;
