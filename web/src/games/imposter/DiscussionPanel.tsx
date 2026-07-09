import { useState } from "react";
import {
  runImposterQuery,
  REVEAL_IMPOSTER_MUTATION,
  type ImposterGame,
  type ImposterPlayer,
  type RevealImposterResult,
} from "./api";
import WordPeekModal from "./WordPeekModal";

interface DiscussionPanelProps {
  gameId: string;
  players: ImposterPlayer[];
  onGameUpdate: (game: ImposterGame) => void;
}

export default function DiscussionPanel({ gameId, players, onGameUpdate }: DiscussionPanelProps) {
  const [revealing, setRevealing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [peekPlayer, setPeekPlayer] = useState<ImposterPlayer | null>(null);
  // Picked once when discussion starts, not re-rolled on every re-render.
  const [firstPlayer] = useState(() => players[Math.floor(Math.random() * players.length)]?.name);

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
        Everyone&apos;s seen their word: <strong>{players.map((p) => p.name).join(", ")}</strong>. Discuss
        out loud, take turns describing your word without saying it, and vote on who you think the
        imposter is.
      </p>

      <div className="imposter-field-group">
        <p className="imposter-hint">Forgot your word? Tap your name to check it privately.</p>
        <div className="imposter-category-grid">
          {players.map((player) => (
            <button
              key={player.id}
              type="button"
              className="imposter-category-btn"
              onClick={() => setPeekPlayer(player)}
            >
              {player.name}
            </button>
          ))}
        </div>
      </div>

      {peekPlayer && (
        <WordPeekModal
          gameId={gameId}
          playerId={peekPlayer.id}
          playerName={peekPlayer.name}
          onClose={() => setPeekPlayer(null)}
        />
      )}

      {error && <p className="status-line">// {error}</p>}
      <button className="run-btn" type="button" onClick={handleReveal} disabled={revealing}>
        {revealing ? "Revealing…" : "Reveal the imposter"}
      </button>
    </div>
  );
}
