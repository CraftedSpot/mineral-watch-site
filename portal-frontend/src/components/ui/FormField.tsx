import { BORDER } from '../../lib/constants';

const baseInput: React.CSSProperties = {
  border: `1px solid ${BORDER}`, fontSize: 14, fontFamily: 'inherit',
  boxSizing: 'border-box', background: '#fff',
};

// --- TextArea ---
interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Minimum height (default 80) */
  minHeight?: number;
}

export function TextArea({ minHeight = 80, style, ...rest }: TextAreaProps) {
  return (
    <textarea
      {...rest}
      style={{
        ...baseInput,
        padding: 10, borderRadius: 6, width: '100%',
        minHeight, resize: 'vertical',
        ...style,
      }}
    />
  );
}

// --- TextInput ---
type TextInputProps = React.InputHTMLAttributes<HTMLInputElement>;

export function TextInput({ style, ...rest }: TextInputProps) {
  return (
    <input
      {...rest}
      style={{
        ...baseInput,
        padding: '6px 10px', borderRadius: 4,
        ...style,
      }}
    />
  );
}

// --- Select ---
type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ style, children, ...rest }: SelectProps) {
  return (
    <select
      {...rest}
      style={{
        ...baseInput,
        padding: '8px 12px', borderRadius: 6, cursor: 'pointer',
        fontFamily: "'Inter', 'DM Sans', sans-serif",
        ...style,
      }}
    >
      {children}
    </select>
  );
}
