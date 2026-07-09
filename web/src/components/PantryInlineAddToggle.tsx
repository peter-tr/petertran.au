import { useState, type FormEvent } from "react";

interface PantryInlineAddToggleProps {
  placeholder: string;
  toggleLabel: string;
  onAdd: (name: string) => Promise<void> | void;
}

// Collapsed to a single "+ ..." button by default - clicking it reveals the
// input. Used for both the shopping list and common items "add" forms so
// neither section shows an always-visible input bar.
export default function PantryInlineAddToggle({ placeholder, toggleLabel, onAdd }: PantryInlineAddToggleProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  function close() {
    setOpen(false);
    setValue("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await onAdd(trimmed);
      setValue("");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="pantry-details-toggle" onClick={() => setOpen(true)}>
        {toggleLabel}
      </button>
    );
  }

  return (
    <form className="pantry-inline-add" onSubmit={handleSubmit}>
      <input
        className="form-input"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        maxLength={200}
        disabled={busy}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
      />
      <button type="submit" className="run-btn" disabled={busy}>
        Add
      </button>
      <button type="button" className="pantry-details-toggle" onClick={close} disabled={busy}>
        cancel
      </button>
    </form>
  );
}
