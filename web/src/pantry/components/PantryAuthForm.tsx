import { useState, type FormEvent } from "react";
import type { PantryAuthMode } from "../hooks/usePantryAuth";

interface PantryAuthFormProps {
  pending: boolean;
  error: string | null;
  onSubmit: (mode: PantryAuthMode, email: string, password: string) => Promise<boolean>;
  onClose: () => void;
}

export default function PantryAuthForm({ pending, error, onSubmit, onClose }: PantryAuthFormProps) {
  const [mode, setMode] = useState<PantryAuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const ok = await onSubmit(mode, email, password);

    if (ok) onClose();
  }

  return (
    <div className="pantry-auth-form">
      <form onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={6}
          required
        />
        {error && <p className="pantry-auth-error">{error}</p>}
        <div className="pantry-auth-actions">
          <button type="submit" disabled={pending}>
            {mode === "signin" ? "Sign in" : "Create account"}
          </button>
          <button
            type="button"
            className="pantry-auth-toggle"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin" ? "Need an account?" : "Have an account?"}
          </button>
        </div>
      </form>
      <button type="button" className="pantry-auth-close" onClick={onClose} aria-label="Close sign-in">
        ×
      </button>
    </div>
  );
}
