import { useState } from 'react';
import { formatFieldName, formatFieldValue, cleanFieldValue } from '../../lib/format-doc-type';
import { SLATE, DARK, BORDER, ORANGE } from '../../lib/constants';
import type { FieldCorrection } from '../../api/documents';

interface Props {
  fieldName: string;
  fieldPath: string;
  value: unknown;
  isEditMode: boolean;
  correction?: FieldCorrection | null;
  pendingValue?: string;
  onEdit: (fieldPath: string, newValue: string) => void;
  onUndo: (fieldPath: string, correctionId: string) => void;
}

export function EditableField({ fieldName, fieldPath, value, isEditMode, correction, pendingValue, onEdit, onUndo }: Props) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const displayValue = pendingValue ?? (correction ? correction.corrected_value : (value != null ? String(value) : ''));
  const formatted = cleanFieldValue(formatFieldValue(displayValue || null));
  const hasPending = pendingValue !== undefined;
  const hasCorrected = !!correction && !hasPending;

  const startEdit = () => {
    setInputValue(displayValue);
    setEditing(true);
  };

  const saveEdit = () => {
    const trimmed = inputValue.trim();
    if (trimmed !== displayValue) {
      onEdit(fieldPath, trimmed);
    }
    setEditing(false);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  // Editing inline
  if (editing) {
    return (
      <div style={{
        padding: '8px 0', borderBottom: `1px solid ${BORDER}`,
        borderLeft: `3px solid ${ORANGE}`, paddingLeft: 12, marginLeft: -12,
      }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: ORANGE, display: 'block', marginBottom: 4 }}>
          {formatFieldName(fieldName)}
        </label>
        <input
          type={fieldPath.includes('date') ? 'date' : 'text'}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
          autoFocus
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '6px 10px', fontSize: 14, fontWeight: 600,
            border: `1.5px solid ${ORANGE}`, borderRadius: 6,
            background: '#fff', color: DARK, outline: 'none',
            fontFamily: "'DM Sans', sans-serif",
          }}
        />
        {correction && (
          <div style={{ fontSize: 11, color: SLATE, marginTop: 3 }}>
            AI extracted: &ldquo;{correction.original_value ?? 'null'}&rdquo;
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <button onClick={saveEdit} style={{
            padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 5,
            background: ORANGE, color: '#fff', border: 'none', cursor: 'pointer',
          }}>Done</button>
          <button onClick={cancelEdit} style={{
            padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 5,
            background: 'transparent', color: SLATE, border: `1px solid ${BORDER}`, cursor: 'pointer',
          }}>Cancel</button>
        </div>
      </div>
    );
  }

  // Read mode
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      padding: '12px 0', borderBottom: `1px solid ${BORDER}`, gap: 16,
      borderLeft: (hasCorrected || hasPending) ? `3px solid ${ORANGE}` : undefined,
      paddingLeft: (hasCorrected || hasPending) ? 12 : undefined,
      marginLeft: (hasCorrected || hasPending) ? -12 : undefined,
    }}>
      <label style={{ fontSize: 14, fontWeight: 500, color: SLATE, flex: '0 0 160px', display: 'flex', alignItems: 'center', gap: 6 }}>
        {formatFieldName(fieldName)}
        {(hasCorrected || hasPending) && (
          <span title="Manually corrected" style={{ width: 7, height: 7, borderRadius: '50%', background: ORANGE, flexShrink: 0 }} />
        )}
      </label>
      <div style={{ fontSize: 15, color: DARK, textAlign: 'right', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
        <span>{formatted || <span style={{ color: SLATE, fontStyle: 'italic' }}>null</span>}</span>
        {isEditMode && (
          <button onClick={startEdit} title="Edit this field" style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 2,
            color: SLATE, fontSize: 14, opacity: 0.6, flexShrink: 0,
          }}>{'\u270E'}</button>
        )}
        {hasCorrected && !isEditMode && (
          <button onClick={() => onUndo(fieldPath, correction!.id)} title="Undo correction" style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 2,
            color: '#dc2626', fontSize: 10, opacity: 0.7, flexShrink: 0,
          }}>undo</button>
        )}
      </div>
    </div>
  );
}
