import { formatFieldName, formatFieldValue, cleanFieldValue } from '../../lib/format-doc-type';
import { SLATE, DARK, BORDER } from '../../lib/constants';

interface Props {
  fieldName: string;
  value: unknown;
}

export function GenericField({ fieldName, value }: Props) {
  const isArrayOfObjects = Array.isArray(value) && value.length > 0 &&
    typeof value[0] === 'object' && value[0] !== null;

  // Array of objects: render each item as a sub-row
  if (isArrayOfObjects) {
    return (
      <div style={{ padding: '10px 0', borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: SLATE, marginBottom: 6 }}>
          {formatFieldName(fieldName)}
        </div>
        {(value as Array<Record<string, unknown>>).map((item, idx) => (
          <div key={idx} style={{
            fontSize: 14, color: DARK, padding: '5px 0', lineHeight: 1.5,
            borderBottom: idx < (value as unknown[]).length - 1
              ? `1px solid ${BORDER}` : undefined,
            wordBreak: 'break-word', overflowWrap: 'break-word',
          }}>
            {cleanFieldValue(formatFieldValue(item))}
          </div>
        ))}
      </div>
    );
  }

  // Default: horizontal flex row (label left, value right) matching vanilla
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      padding: '12px 0', borderBottom: `1px solid ${BORDER}`, gap: 16,
    }}>
      <label style={{ fontSize: 14, fontWeight: 500, color: SLATE, flex: '0 0 160px' }}>
        {formatFieldName(fieldName)}
      </label>
      <div style={{
        fontSize: 15, color: DARK, textAlign: 'right', flex: 1, lineHeight: 1.5,
        wordBreak: 'break-word', overflowWrap: 'break-word',
      }}>
        {cleanFieldValue(formatFieldValue(value))}
      </div>
    </div>
  );
}
