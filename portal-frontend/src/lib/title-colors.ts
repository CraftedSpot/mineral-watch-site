import { ORANGE_LIGHT, DARK, SLATE, BORDER, GAP_BG } from './constants';

export interface TitleColors {
  bg: string;
  surface: string;
  card: string;
  cardHover: string;
  border: string;
  cardStroke: string;
  text: string;
  textMuted: string;
  gapBg: string;
  gapBgHover: string;
  ownerBg: string;
  ownerBgHover: string;
  stackBg: string;
  zoomBtn: string;
  zoomText: string;
  legendBg: string;
  fieldBg: string;
  shadowCard1: string;
  shadowCard2: string;
  disclaimerBg: string;
  disclaimerBorder: string;
  disclaimerText: string;
}

export function getTitleColors(dark: boolean): TitleColors {
  if (dark) {
    return {
      bg: '#0F172A',
      surface: '#1E293B',
      card: '#334155',
      cardHover: 'rgba(192,86,33,0.15)',
      border: '#334155',
      cardStroke: '#475569',
      text: '#E2E8F0',
      textMuted: '#94A3B8',
      gapBg: 'rgba(232,93,74,0.1)',
      gapBgHover: 'rgba(232,93,74,0.2)',
      ownerBg: 'rgba(22,163,74,0.1)',
      ownerBgHover: 'rgba(22,163,74,0.15)',
      stackBg: 'rgba(30,41,59,0.95)',
      zoomBtn: '#334155',
      zoomText: '#CBD5E1',
      legendBg: 'rgba(30,41,59,0.95)',
      fieldBg: '#0F172A',
      shadowCard1: '#1E293B',
      shadowCard2: '#263548',
      disclaimerBg: '#44403C',
      disclaimerBorder: '#78716C',
      disclaimerText: '#FDE68A',
    };
  }
  return {
    bg: '#fff',
    surface: '#fff',
    card: '#fff',
    cardHover: ORANGE_LIGHT,
    border: BORDER,
    cardStroke: BORDER,
    text: DARK,
    textMuted: SLATE,
    gapBg: GAP_BG,
    gapBgHover: '#fee2e2',
    ownerBg: '#f8fffe',
    ownerBgHover: '#f0fdf4',
    stackBg: 'rgba(248,249,251,0.95)',
    zoomBtn: '#fff',
    zoomText: DARK,
    legendBg: 'rgba(255,255,255,0.95)',
    fieldBg: '#f8f9fb',
    shadowCard1: '#f1f5f9',
    shadowCard2: '#f8fafc',
    disclaimerBg: '#FFFBEB',
    disclaimerBorder: '#FDE68A',
    disclaimerText: '#92400E',
  };
}
