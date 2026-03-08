import { useRef, useEffect } from 'react';

interface DataPoint {
  label: string;
  value: number;
}

interface TrendChartProps {
  data: DataPoint[];
  type?: 'bar' | 'line';
  height?: number;
  color?: string;
  negativeColor?: string;
}

export function TrendChart({
  data,
  type = 'bar',
  height = 120,
  color = '#3b82f6',
  negativeColor = '#ef4444',
}: TrendChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = height;

    // Guard against zero-width before layout
    if (w < 1) return;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.clearRect(0, 0, w, h);

    const padding = { top: 10, right: 12, bottom: 24, left: 48 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    const values = data.map((d) => d.value);
    const maxVal = Math.max(...values, 1);
    const minVal = Math.min(...values, 0);
    const range = maxVal - minVal || 1;

    const getY = (v: number) => padding.top + chartH - ((v - minVal) / range) * chartH;

    // Y-axis labels
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'right';
    const ySteps = 4;
    for (let i = 0; i <= ySteps; i++) {
      const val = minVal + (range * i) / ySteps;
      const y = getY(val);
      ctx.fillText(formatAxisValue(val), padding.left - 6, y + 3);
      // Grid line
      ctx.beginPath();
      ctx.strokeStyle = '#f1f5f9';
      ctx.lineWidth = 1;
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();
    }

    if (type === 'bar') {
      const barGap = 2;
      const barW = Math.max((chartW - barGap * (data.length - 1)) / data.length, 4);
      const zeroY = minVal >= 0 ? getY(0) : getY(0);

      data.forEach((d, i) => {
        const x = padding.left + i * (barW + barGap);
        const y = getY(d.value);
        const barH = Math.abs(y - zeroY);

        ctx.fillStyle = d.value >= 0 ? color : negativeColor;
        ctx.fillRect(x, Math.min(y, zeroY), barW, barH || 1);
      });
    } else {
      // Line chart with 3-month moving average trend line

      const getX = (i: number) => padding.left + (i / Math.max(data.length - 1, 1)) * chartW;

      // 3-month moving average trend line (behind, thick, semi-transparent)
      ctx.strokeStyle = color + '40'; // 25% opacity
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      values.forEach((_, i) => {
        const start = Math.max(0, i - 1);
        const end = Math.min(values.length, i + 2);
        const window = values.slice(start, end);
        const avg = window.reduce((sum, v) => sum + v, 0) / window.length;
        const x = getX(i);
        const y = getY(avg);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Main data line
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      data.forEach((d, i) => {
        const x = getX(i);
        const y = getY(d.value);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Data point dots
      ctx.fillStyle = color;
      data.forEach((d, i) => {
        ctx.beginPath();
        ctx.arc(getX(i), getY(d.value), 3, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // X-axis labels (show ~6 labels max)
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'center';
    const labelStep = Math.max(1, Math.ceil(data.length / 6));
    data.forEach((d, i) => {
      if (i % labelStep !== 0 && i !== data.length - 1) return;
      const x = type === 'bar'
        ? padding.left + i * ((chartW) / data.length) + ((chartW) / data.length) / 2
        : padding.left + (i / Math.max(data.length - 1, 1)) * chartW;
      ctx.fillText(d.label, x, h - 4);
    });

    // Cleanup function clears canvas to prevent ghost renders
    return () => {
      ctx.clearRect(0, 0, w * dpr, h * dpr);
    };
  }, [data, type, height, color, negativeColor]);

  if (data.length === 0) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13 }}>
        No chart data
      </div>
    );
  }

  return <canvas ref={canvasRef} style={{ width: '100%', height }} />;
}

function formatAxisValue(val: number): string {
  if (Math.abs(val) >= 1000000) return (val / 1000000).toFixed(1) + 'M';
  if (Math.abs(val) >= 1000) return (val / 1000).toFixed(0) + 'K';
  return Math.round(val).toString();
}
