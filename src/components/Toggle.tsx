interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <label className={`toggle-row ${disabled ? 'is-disabled' : ''}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`toggle ${checked ? 'is-on' : ''}`}
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
      >
        <span />
      </button>
      <span>{label}</span>
    </label>
  );
}
