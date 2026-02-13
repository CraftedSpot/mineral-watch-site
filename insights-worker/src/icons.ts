// Inline SVG icons — Heroicons outline style, 24x24, stroke-width 1.5
// Use currentColor so CSS color variables apply

const attr = 'xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';

export const ICONS: Record<string, string> = {
  // Scale / Balance — OCC filings, pooling orders, legal
  scale: `<svg ${attr}><path d="M12 3v18"/><path d="M5 7h14"/><path d="M5 7L3 14h4L5 7z"/><path d="M3 14a2 2 0 0 0 4 0"/><path d="M19 7l-2 7h4l-2-7z"/><path d="M17 14a2 2 0 0 0 4 0"/></svg>`,

  // Home — inherited mineral rights
  home: `<svg ${attr}><path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V19a1 1 0 0 0 1 1h4v-5h4v5h4a1 1 0 0 0 1-1V9.5"/></svg>`,

  // Document — division orders, filings
  document: `<svg ${attr}><path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/></svg>`,

  // Magnifying glass — search, navigation
  search: `<svg ${attr}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>`,

  // Banknotes — royalties, money, production revenue
  banknotes: `<svg ${attr}><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M2 10h2"/><path d="M20 10h2"/><path d="M2 14h2"/><path d="M20 14h2"/></svg>`,

  // Map — SCOOP/STACK, county exploration
  map: `<svg ${attr}><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6z"/><path d="M9 3v15"/><path d="M15 6v15"/></svg>`,

  // Building — OCC, regulatory, government
  building: `<svg ${attr}><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-4h6v4"/><path d="M9 10h.01"/><path d="M15 10h.01"/><path d="M9 14h.01"/><path d="M15 14h.01"/></svg>`,

  // Book open — getting started, education
  bookOpen: `<svg ${attr}><path d="M12 6.5C12 6.5 9.5 4 5.5 4S2 5.5 2 5.5v13s1.5-1 5.5-1 4.5 2 4.5 2"/><path d="M12 6.5C12 6.5 14.5 4 18.5 4S22 5.5 22 5.5v13s-1.5-1-5.5-1-4.5 2-4.5 2"/><path d="M12 6.5v14"/></svg>`,

  // Clipboard — featured article, guides
  clipboard: `<svg ${attr}><path d="M9 3h6v2a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V3z"/><rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 11h6"/><path d="M9 15h4"/></svg>`,

  // Chart — production, analysis
  chart: `<svg ${attr}><path d="M3 20h18"/><path d="M7 20V12"/><path d="M11 20V8"/><path d="M15 20V14"/><path d="M19 20V10"/></svg>`,

  // Shield — protecting interests
  shield: `<svg ${attr}><path d="M12 3l8 4v5c0 5.25-3.5 9.75-8 11-4.5-1.25-8-5.75-8-11V7l8-4z"/></svg>`,

  // Chevron right — links, navigation
  chevronRight: `<svg ${attr} width="16" height="16" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>`,

  // Pickaxe — logo
  pickaxe: `<svg ${attr} width="20" height="20" viewBox="0 0 24 24"><path d="M14.5 3.5L20 9l-2 2-5.5-5.5 2-2z"/><path d="M12.5 5.5L4 14l3 3 8.5-8.5"/><path d="M7 17l-3 4"/></svg>`,
};

// Helper to render icon at a custom size
export function icon(name: string, size = 24): string {
  const svg = ICONS[name];
  if (!svg) return '';
  if (size === 24) return svg;
  return svg
    .replace(/width="24"/, `width="${size}"`)
    .replace(/height="24"/, `height="${size}"`);
}

// Render icon at 40px for guide cards
export function iconLg(name: string): string {
  return icon(name, 40);
}

// Render icon at 28px for topic cards
export function iconMd(name: string): string {
  return icon(name, 28);
}
