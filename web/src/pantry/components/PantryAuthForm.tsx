import { useState, type FormEvent } from "react";
import type { PantryAuthMode } from "../hooks/usePantryAuth";

interface PantryAuthFormProps {
  pending: boolean;
  error: string | null;
  onSubmit: (mode: PantryAuthMode, email: string, password: string) => Promise<boolean>;
  onClose: () => void;
}

export default function PantryAuthForm({ pending, error, onSubmit, onClose }: Readonly<PantryAuthFormProps>) {
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
      <p className="pantry-auth-blurb">
        Want your own saved pantry, prices, and settings? Sign in or create an account.
      </p>
      <form onSubmit={handleSubmit}>
        {/* type="text" (not "email") and no required/minLength - Cognito's
            own SignUp/InitiateAuth response already carries a real error
            message (see auth.ts's friendlyMessage) for a bad/missing
            email or a too-short password, so the browser's native
            validation popups here would just be a second, redundant
            (and worse-worded) copy of the same feedback. */}
        <input
          type="text"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
