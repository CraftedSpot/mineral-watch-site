import { ORANGE, GAP_COLOR, GREEN, SLATE, BORDER } from '../../lib/constants';
import type { TitleColors } from '../../lib/title-colors';

interface TreeLegendProps {
  isMobile?: boolean;
  colors?: TitleColors;
}

export function TreeLegend({ isMobile, colors: c }: TreeLegendProps) {
  return (
    <div style={{
      position: 'absolute', bottom: 12, left: 12, right: isMobile ? 12 : undefined, zIndex: 10,
      display: 'flex', gap: isMobile ? 8 : 16, flexWrap: 'wrap', fontSize: 10, color: c?.textMuted || SLATE,
      background: c?.legendBg || 'rgba(255,255,255,0.95)', padding: '6px 12px',
      borderRadius: 6, border: `1px solid ${c?.border || BORDER}`,
      fontFamily: "'DM Sans', sans-serif",
    }}>
      <span>
        <span style={{ display: 'inline-block', width: 12, height: 4, background: ORANGE,
          marginRight: 4, verticalAlign: 'middle', borderRadius: 1 }} />
        Document
      </span>
      <span>
        <span style={{ display: 'inline-block', width: 12, height: 4, background: GAP_COLOR,
          marginRight: 4, verticalAlign: 'middle', borderRadius: 1 }} />
        Gap
      </span>
      <span>
        <span style={{ display: 'inline-block', width: 8, height: 8, background: GREEN,
          marginRight: 4, verticalAlign: 'middle', borderRadius: 8 }} />
        Current Owner
      </span>
      {!isMobile && (
        <span style={{ opacity: 0.5 }}>Hover peek · Click for details · Click stacks to expand</span>
      )}
      {isMobile && (
        <span style={{ opacity: 0.5 }}>Tap for details</span>
      )}
    </div>
  );
}
