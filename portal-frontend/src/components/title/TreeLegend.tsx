import { ORANGE, GAP_COLOR, GREEN, SLATE, BORDER } from '../../lib/constants';

export function TreeLegend() {
  return (
    <div style={{
      position: 'absolute', bottom: 12, left: 12, zIndex: 10,
      display: 'flex', gap: 16, fontSize: 10, color: SLATE,
      background: 'rgba(255,255,255,0.95)', padding: '6px 12px',
      borderRadius: 6, border: `1px solid ${BORDER}`,
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
      <span style={{ opacity: 0.5 }}>Hover peek · Click pin · Click stacks to expand</span>
    </div>
  );
}
