interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function ToggleSwitch({ checked, onChange, disabled }: ToggleSwitchProps) {
  return (
    <label style={{
      position: 'relative',
      display: 'inline-block',
      width: 44,
      height: 24,
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.5 : 1,
    }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => !disabled && onChange(e.target.checked)}
        disabled={disabled}
        style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
      />
      <span style={{
        position: 'absolute',
        inset: 0,
        borderRadius: 12,
        background: checked ? '#10b981' : '#cbd5e1',
        transition: 'background 0.2s',
      }} />
      <span style={{
        position: 'absolute',
        top: 2,
        left: checked ? 22 : 2,
        width: 20,
        height: 20,
        borderRadius: '50%',
        background: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        transition: 'left 0.2s',
      }} />
    </label>
  );
}
