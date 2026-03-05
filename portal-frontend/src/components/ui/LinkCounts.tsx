/**
 * Inline SVG link count icons — wells, docs, filings.
 * Colored when count > 0, muted #CBD5E1 when 0.
 * Matches vanilla .link-count styling from dashboard-properties.txt.
 */

const LINK_COLORS: Record<string, string> = {
  wells: '#2563EB',
  docs: '#1D6F5C',
  filings: '#111827',
  properties: '#2563EB',
};

const LINK_SVGS: Record<string, React.ReactNode> = {
  wells: (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width={14} height={14}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
    </svg>
  ),
  docs: (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width={14} height={14}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  filings: (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width={14} height={14}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
    </svg>
  ),
  properties: (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width={14} height={14}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
    </svg>
  ),
};

export function LinkCount({ icon, count }: { icon: string; count: number }) {
  const isZero = count === 0;
  const color = isZero ? '#CBD5E1' : LINK_COLORS[icon] || '#111827';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, color }}>
      {LINK_SVGS[icon]}
      {count}
    </span>
  );
}

const pipeSep = <span style={{ color: '#CBD5E1', fontSize: 11, margin: '0 2px' }}>|</span>;

/** Render all three property link counts inline */
export function PropertyLinkCounts({ counts }: { counts?: { wells: number; documents: number; filings: number } }) {
  return (
    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center' }}>
      <LinkCount icon="wells" count={counts?.wells ?? 0} />
      {pipeSep}
      <LinkCount icon="docs" count={counts?.documents ?? 0} />
      {pipeSep}
      <LinkCount icon="filings" count={counts?.filings ?? 0} />
    </div>
  );
}

/** Render well link counts (properties, documents, filings) */
export function WellLinkCounts({ counts }: { counts?: { properties: number; documents: number; filings: number } }) {
  return (
    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center' }}>
      <LinkCount icon="properties" count={counts?.properties ?? 0} />
      {pipeSep}
      <LinkCount icon="docs" count={counts?.documents ?? 0} />
      {pipeSep}
      <LinkCount icon="filings" count={counts?.filings ?? 0} />
    </div>
  );
}
