import { renderCalculator } from './calculator';

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/tools';

    try {
      // Tools index — redirect to mineral calculator (only tool for now)
      if (path === '/tools') {
        return Response.redirect('https://mymineralwatch.com/tools/mineral-calculator', 302);
      }

      // Mineral calculator
      if (path === '/tools/mineral-calculator') {
        return html(renderCalculator(), 200);
      }

      return html(render404(), 404, 300);
    } catch (e) {
      console.error('Tools worker error:', e);
      return html(render404(), 500, 60);
    }
  },
};

function html(body: string, status: number, maxAge = 3600): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': `public, max-age=${maxAge}, s-maxage=${maxAge}`,
    },
  });
}

function render404(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Page Not Found | Mineral Watch</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:wght@400;700;900&display=swap" media="print" onload="this.media='all'">
    <style>
        :root { --oil-navy: #1C2B36; --slate-blue: #334E68; --red-dirt: #C05621; --border: #E2E8F0; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: var(--oil-navy); background: #fff; }
        h1, h2, .logo { font-family: 'Merriweather', serif; }
        .container { max-width: 1100px; margin: 0 auto; padding: 0 20px; }
        a { color: inherit; }
        header { background: #fff; padding: 20px 0; border-bottom: 1px solid var(--border); }
        .header-inner { display: flex; justify-content: space-between; align-items: center; }
        .logo { font-size: 22px; font-weight: 900; color: var(--oil-navy); letter-spacing: -0.5px; text-decoration: none; }
        .nav-links { display: flex; gap: 30px; align-items: center; }
        .nav-links a { color: var(--slate-blue); text-decoration: none; font-weight: 500; font-size: 15px; }
        .nav-links .btn-login { background: var(--oil-navy); color: white; padding: 10px 20px; border-radius: 4px; font-weight: 600; }
        .mobile-menu-btn { display: none; background: none; border: none; cursor: pointer; color: var(--oil-navy); }
        @media (max-width: 768px) {
            .mobile-menu-btn { display: block; }
            .nav-links { display: none; position: absolute; top: 100%; left: 0; right: 0; background: #fff; flex-direction: column; padding: 20px; gap: 16px; border-bottom: 1px solid var(--border); z-index: 100; }
            .nav-links.open { display: flex; }
            header { position: relative; }
        }
    </style>
</head>
<body>
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
                    <a href="/about">About</a>
                    <a href="/contact">Contact</a>
                    <a href="https://portal.mymineralwatch.com" class="btn-login">Sign In</a>
                </nav>
            </div>
        </div>
    </header>
    <main style="text-align:center;padding:120px 20px;">
        <h1 style="font-size:36px;margin-bottom:16px;">Page Not Found</h1>
        <p style="font-size:18px;color:var(--slate-blue);margin-bottom:32px;">The page you're looking for doesn't exist.</p>
        <a href="/tools/mineral-calculator" style="color:var(--red-dirt);font-weight:600;font-size:16px;text-decoration:underline;">Go to Mineral Calculator</a>
    </main>
</body>
</html>`;
}
