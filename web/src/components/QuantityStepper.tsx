import { useState } from "react";

interface QuantityStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  disabled?: boolean;
}

export default function QuantityStepper({ value, onChange, min = 1, disabled }: QuantityStepperProps) {
  // Typing is tracked as free text and only clamped/committed on blur or
  // Enter - clamping on every keystroke made it impossible to clear the
  // field and type a new multi-digit number (it would snap back to `min`
  // the instant the field was briefly empty).
  const [draft, setDraft] = useState(String(value));
  // Resets the draft when `value` changes from outside (e.g. the +/- buttons,
  // or another user action) - adjusted during render rather than in an
  // effect, per React's guidance for syncing state from a changed prop.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setDraft(String(value));
  }

  function commit() {
    const n = Math.max(min, Number(draft) || min);
    setDraft(String(n));
    if (n !== value) onChange(n);
  }

  return (
    <div className="qty-stepper">
      <button
        type="button"
        className="qty-stepper-btn"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={disabled || value <= min}
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        className="qty-stepper-input"
        value={draft}
        min={min}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      <button type="button" className="qty-stepper-btn" onClick={() => onChange(value + 1)} disabled={disabled}>
        +
      </button>
    </div>
  );
}
