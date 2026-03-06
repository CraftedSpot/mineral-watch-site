import type { ReactNode } from 'react';
import { createElement } from 'react';

const DOC_TYPE_MAP: Record<string, string> = {
  pooling_order: 'Pooling Order',
  spacing_order: 'Spacing Order',
  increased_density: 'Increased Density Order',
  location_exception: 'Location Exception',
  multiunit_horizontal: 'Multi-Unit Horizontal Order',
  well_proposal: 'Well Proposal',
  oil_gas_lease: 'Oil & Gas Lease',
  multi_document: 'Multi-Document PDF',
  lease_production: 'Lease Production Report',
  production_record: 'Production Record',
  production_summary: 'Production Summary',
  division_order: 'Division Order',
  deed: 'Deed',
  assignment: 'Assignment',
  other: 'Other Document',
};

export function formatDocType(type: string | null | undefined): string {
  if (!type) return 'Document';
  return DOC_TYPE_MAP[type] || type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const NAME_MAP: Record<string, string> = {
  cd_number: 'CD Number',
  api_number: 'API Number',
  nri: 'Net Revenue Interest',
  orri: 'Overriding Royalty Interest',
  poa_type: 'Power of Attorney Type',
  property_name: 'Well/Lease Name',
};

export function formatFieldName(key: string): string {
  if (NAME_MAP[key]) return NAME_MAP[key];
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Condense a legal description object into a readable line.
 * "S14-T17N-R8W, NE/4, Beckham County"
 */
export function condenseLegal(legal: Record<string, unknown>): string {
  if (!legal || typeof legal !== 'object') return '';

  // Handle sections array (multi-section documents)
  if (Array.isArray(legal.sections)) {
    return (legal.sections as Array<unknown>)
      .map((loc) => (typeof loc === 'object' && loc ? condenseLegal(loc as Record<string, unknown>) : String(loc)))
      .filter(Boolean)
      .join('\n');
  }

  const parts: string[] = [];
  const section = legal.section || legal.sec;
  const township = legal.township;
  const range = legal.range;

  if (section || township || range) {
    let str = '';
    if (section) str += `S${section}`;
    if (township) str += (str ? '-' : '') + `T${township}`;
    if (range) str += (str ? '-' : '') + `R${range}`;
    if (str) parts.push(str);
  }

  const quarters = legal.quarters || legal.quarter || legal.quarter_section;
  if (quarters) {
    parts.push(Array.isArray(quarters) ? quarters.join(' ') : String(quarters));
  }

  let county = legal.county;
  if (county) {
    const c = String(county).trim();
    parts.push(c.toLowerCase().endsWith('county') ? c : c + ' County');
  }

  return parts.join(', ');
}

/**
 * Condense a sections array into readable lines.
 * [{section:7, township:"12N", range:"8W", is_target_section:true}]
 * → "S7-T12N-R8W (target)"
 */
export function condenseSections(sections: Array<Record<string, unknown>>): string {
  if (!Array.isArray(sections) || sections.length === 0) return '';
  return sections.map((s) => {
    let str = '';
    if (s.section) str += `S${s.section}`;
    if (s.township) str += (str ? '-' : '') + `T${s.township}`;
    if (s.range) str += (str ? '-' : '') + `R${s.range}`;

    let role = '';
    if (s.role) role = String(s.role).replace(/_/g, ' ');
    else if (s.is_surface_location === true) role = 'surface location';
    else if (s.is_target_section === true) role = 'target';
    if (role) str += ` (${role})`;

    if (s.county) str += `, ${s.county} County`;
    return str;
  }).filter(Boolean).join('\n');
}

/**
 * Convert snake_case identifier-like strings to readable form.
 * "closer_than_600_feet" → "Closer Than 600 Feet"
 */
export function formatSnakeCaseValue(text: string): string {
  if (!text || typeof text !== 'string') return text;
  if (text.includes('_') && !text.includes(' ')) {
    return text.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
  return text;
}

/**
 * Clean markdown artifacts from a field value.
 */
export function cleanFieldValue(text: string): string {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .trim();
}

/**
 * Check if array looks like a sections array (has section/township/range).
 */
export function isSectionsArray(arr: unknown[]): boolean {
  if (!Array.isArray(arr) || arr.length === 0) return false;
  const first = arr[0];
  return typeof first === 'object' && first !== null &&
    'section' in first && 'township' in first;
}

/**
 * Convert markdown analysis text to React elements.
 */
export function formatAnalysisText(text: string): ReactNode[] {
  if (!text) return [];
  const lines = text
    .replace(/^---+$/gm, '')
    .replace(/^\s+/gm, '')
    .replace(/\t/g, ' ')
    .split('\n');

  const elements: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Headers
    const headerMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headerMatch) {
      elements.push(
        createElement('strong', {
          key: `h-${i}`,
          style: { fontSize: 15, display: 'inline-block', marginTop: 8 },
        }, headerMatch[1]),
      );
      elements.push(createElement('br', { key: `hbr-${i}` }));
      continue;
    }

    // Bullets
    if (line.match(/^- /)) {
      let processed = line.replace(/^- /, '\u2022 ');
      // Bold within bullet
      processed = processed.replace(/\*\*([^*]+)\*\*/g, '');
      const parts: ReactNode[] = [];
      const boldRegex = /\*\*([^*]+)\*\*/g;
      const original = line.replace(/^- /, '\u2022 ');
      let lastIdx = 0;
      let match: RegExpExecArray | null;
      while ((match = boldRegex.exec(original)) !== null) {
        if (match.index > lastIdx) parts.push(original.slice(lastIdx, match.index));
        parts.push(createElement('strong', { key: `b-${i}-${match.index}` }, match[1]));
        lastIdx = match.index + match[0].length;
      }
      if (lastIdx < original.length) parts.push(original.slice(lastIdx));
      if (parts.length > 0) {
        elements.push(createElement('span', { key: `bul-${i}` }, ...parts));
      } else {
        elements.push(processed);
      }
      elements.push(createElement('br', { key: `bbr-${i}` }));
      continue;
    }

    // Regular line — handle bold
    if (line.includes('**')) {
      const parts: ReactNode[] = [];
      const boldRegex = /\*\*([^*]+)\*\*/g;
      let lastIdx = 0;
      let match: RegExpExecArray | null;
      while ((match = boldRegex.exec(line)) !== null) {
        if (match.index > lastIdx) parts.push(line.slice(lastIdx, match.index));
        parts.push(createElement('strong', { key: `s-${i}-${match.index}` }, match[1]));
        lastIdx = match.index + match[0].length;
      }
      if (lastIdx < line.length) parts.push(line.slice(lastIdx));
      elements.push(createElement('span', { key: `ln-${i}` }, ...parts));
      elements.push(createElement('br', { key: `lbr-${i}` }));
      continue;
    }

    // Plain line
    if (line.trim()) {
      elements.push(line);
      elements.push(createElement('br', { key: `pbr-${i}` }));
    } else if (i > 0) {
      elements.push(createElement('br', { key: `ebr-${i}` }));
    }
  }
  return elements;
}

export function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return '\u2014';
  if (typeof value === 'string') {
    // Format snake_case identifiers
    return formatSnakeCaseValue(value);
  }
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    if (value.length === 0) return '\u2014';
    // Sections array → condensed
    if (isSectionsArray(value)) {
      return condenseSections(value as Array<Record<string, unknown>>);
    }
    return value.map((v) => formatFieldValue(v)).join(', ');
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // Legal description objects with sections array
    if (Array.isArray(obj.sections)) {
      return condenseLegal(obj);
    }
    // Handle legal description objects
    if (obj.section || obj.township || obj.range) {
      return condenseLegal(obj);
    }
    // Flatten simple objects into readable key: value pairs
    const entries = Object.entries(obj).filter(([, v]) => v != null && v !== '');
    if (entries.length === 0) return '\u2014';
    return entries.map(([k, v]) => {
      const label = formatFieldName(k);
      return `${label}: ${formatFieldValue(v)}`;
    }).join('; ');
  }
  return String(value);
}

/** Check if a value is "empty" (null, empty string, empty array, all-null object) */
export function isEmptyValue(value: unknown): boolean {
  if (value == null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v != null && v !== '');
    return entries.length === 0;
  }
  return false;
}
