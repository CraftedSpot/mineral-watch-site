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
            <a href="/" class="logo">${icon('pickaxe', 20)} Mineral Watch</a>
            <button class="mobile-menu-btn" onclick="document.querySelector('.nav-links').classList.toggle('open')" aria-label="Menu">
                <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
            </button>
            <nav class="nav-links">
                <a href="/features">Features</a>
                <a href="/pricing">Pricing</a>
                <a href="/insights" class="nav-active">Insights</a>
                <a href="/counties/">Counties</a>
                <a href="/about">About</a>
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
.nav-links .nav-active { color: var(--oil-navy); font-weight: 600; }
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
                        <img src="/assets/insights/pooling-orders-guide.jpg" alt="Pooling order documents and production data on a desk — representing the complexity of OCC filings for Oklahoma mineral owners" width="605" height="320" loading="eager">
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
                <p class="county-section-intro">Live drilling activity, OCC filings, and operator data for every Oklahoma county. Click any county to see recent permits, pooling orders, and top operators.</p>

                <div class="county-grid">
                    <a href="/counties/canadian-county" class="county-tile featured">
                        <div class="county-tile-name">Canadian</div>
                        <div class="county-tile-stat"><strong>3,069</strong> active wells</div>
                    </a>
                    <a href="/counties/grady-county" class="county-tile featured">
                        <div class="county-tile-name">Grady</div>
                        <div class="county-tile-stat"><strong>2,411</strong> active wells</div>
                    </a>
                    <a href="/counties/kingfisher-county" class="county-tile featured">
                        <div class="county-tile-name">Kingfisher</div>
                        <div class="county-tile-stat"><strong>1,892</strong> active wells</div>
                    </a>
                    <a href="/counties/blaine-county" class="county-tile featured">
                        <div class="county-tile-name">Blaine</div>
                        <div class="county-tile-stat"><strong>1,654</strong> active wells</div>
                    </a>
                    <a href="/counties/stephens-county" class="county-tile featured">
                        <div class="county-tile-name">Stephens</div>
                        <div class="county-tile-stat"><strong>1,523</strong> active wells</div>
                    </a>
                    <a href="/counties/carter-county" class="county-tile">
                        <div class="county-tile-name">Carter</div>
                        <div class="county-tile-stat"><strong>1,412</strong> active wells</div>
                    </a>
                    <a href="/counties/garfield-county" class="county-tile">
                        <div class="county-tile-name">Garfield</div>
                        <div class="county-tile-stat"><strong>1,380</strong> active wells</div>
                    </a>
                    <a href="/counties/mcclain-county" class="county-tile">
                        <div class="county-tile-name">McClain</div>
                        <div class="county-tile-stat"><strong>1,245</strong> active wells</div>
                    </a>
                    <a href="/counties/caddo-county" class="county-tile">
                        <div class="county-tile-name">Caddo</div>
                        <div class="county-tile-stat"><strong>1,187</strong> active wells</div>
                    </a>
                    <a href="/counties/custer-county" class="county-tile">
                        <div class="county-tile-name">Custer</div>
                        <div class="county-tile-stat"><strong>1,034</strong> active wells</div>
                    </a>
                </div>

                <a href="/counties/" class="view-all-link">See all 77 Oklahoma counties &rarr;</a>
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
  featuredImage?: { src: string; alt: string; width: number; height: number };
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
      width: 1100,
      height: 620,
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
};

export function renderArticle(slug: string): string | null {
  const article = ARTICLES[slug];
  if (!article) return null;

  const tocHtml = article.toc.map(t =>
    `<a href="#${t.id}" class="toc-link">${esc(t.label)}</a>`
  ).join('\\n');

  const relatedHtml = article.related.map(r =>
    `<a href="${r.href}" class="related-link">${esc(r.label)} &rarr;</a>`
  ).join('\\n');

  const imageHtml = article.featuredImage
    ? `<div class="article-image"><img src="${article.featuredImage.src}" alt="${esc(article.featuredImage.alt)}" width="${article.featuredImage.width}" height="${article.featuredImage.height}" loading="eager"></div>`
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
        .article-image { margin: 32px 0; border-radius: 6px; overflow: hidden; border: 1px solid var(--border); }
        .article-image img { width: 100%; height: auto; display: block; }

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
                        <span>By <span class="author-name">${esc(article.author)}</span>, ${esc(article.authorTitle)}</span>
                        <span>${esc(article.readTime)}</span>
                        <span>${esc(article.updated)}</span>
                    </div>
                </div>
            </div>

            ${imageHtml}

            <div class="article-layout">
                <article class="article-body">
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
