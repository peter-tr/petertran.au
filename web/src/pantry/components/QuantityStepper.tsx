import { useEffect, useRef, useState } from "react";

interface QuantityStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  step?: number;
  disabled?: boolean;
}

// How long to wait after the last +/- click before actually sending it -
// rapid clicking used to fire one mutation per click, which both felt
// laggy (each click waited on a round trip before the number moved) and
// burned through the pantry API's rate limit fast.
const DEBOUNCE_MS = 400;

export default function QuantityStepper({
  value,
  onChange,
  min = 1,
  step = 1,
  disabled,
}: QuantityStepperProps) {
  // Typing is tracked as free text and only clamped/committed on blur or
  // Enter - clamping on every keystroke made it impossible to clear the
  // field and type a new multi-digit number (it would snap back to `min`
  // the instant the field was briefly empty).
  const [draft, setDraft] = useState(String(value));
  // Resets the draft when `value` changes from outside (e.g. a debounced
  // change of ours finally landing, or another device's edit coming in via
  // polling) - adjusted during render rather than in an effect, per React's
  // guidance for syncing state from a changed prop.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setDraft(String(value));
  }

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<number | null>(null);

  // Flushes a still-pending change immediately if this row disappears
  // mid-debounce (e.g. deleted, or the page navigated away right after a
  // click) so the last click isn't silently lost.
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        if (pendingRef.current !== null) onChange(pendingRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function scheduleChange(next: number) {
    pendingRef.current = next;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending !== null) onChange(pending);
    }, DEBOUNCE_MS);
  }

  // The displayed number moves the instant you click - only the network
  // call waits. Clicks are disabled again the moment one actually lands
  // (via the `disabled` prop reflecting the parent's in-flight state), so a
  // burst of clicks always collapses into a single trailing mutation rather
  // than racing several in flight at once.
  function applyStep(delta: number) {
    const current = Number(draft) || value;
    const next = Math.max(min, current + delta);
    setDraft(String(next));
    scheduleChange(next);
  }

  function commit() {
    const n = Math.max(min, Number(draft) || min);
    setDraft(String(n));
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    pendingRef.current = null;
    if (n !== value) onChange(n);
  }

  return (
    <div className="qty-stepper">
      <button
        type="button"
        className="qty-stepper-btn"
        onClick={() => applyStep(-step)}
        disabled={disabled || Number(draft) <= min}
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
      <button type="button" className="qty-stepper-btn" onClick={() => applyStep(step)} disabled={disabled}>
        +
      </button>
    </div>
  );
}
