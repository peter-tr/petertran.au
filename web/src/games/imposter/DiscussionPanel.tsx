import { useState } from "react";
import { runImposterQuery, REVEAL_IMPOSTER_MUTATION, type ImposterGame, type RevealImposterResult } from "./api";

interface DiscussionPanelProps {
  gameId: string;
  playerNames: string[];
  onGameUpdate: (game: ImposterGame) => void;
}

export default function DiscussionPanel({ gameId, playerNames, onGameUpdate }: DiscussionPanelProps) {
  const [revealing, setRevealing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Picked once when discussion starts, not re-rolled on every re-render.
  const [firstPlayer] = useState(() => playerNames[Math.floor(Math.random() * playerNames.length)]);

  async function handleReveal() {
    setRevealing(true);
    setError(null);
    try {
      const res = await runImposterQuery<RevealImposterResult>(REVEAL_IMPOSTER_MUTATION, { gameId });
      onGameUpdate(res.revealImposter);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reveal the imposter - please try again.");
      setRevealing(false);
    }
  }

  return (
    <div className="imposter-discussion">
      <p className="imposter-first-player">
        <strong>{firstPlayer}</strong> goes first
      </p>
      <p className="project-desc">
        Everyone&apos;s seen their word: <strong>{playerNames.join(", ")}</strong>. Discuss out loud, take
        turns describing your word without saying it, and vote on who you think the imposter is.
      </p>
      {error && <p className="status-line">// {error}</p>}
      <button className="run-btn" type="button" onClick={handleReveal} disabled={revealing}>
        {revealing ? "Revealing…" : "Reveal the imposter"}
      </button>
    </div>
  );
}
