import { useState } from "react";
import { runImposterQuery, REVEAL_IMPOSTER_WORD_MUTATION, type RevealImposterWordResult } from "./api";

interface WordPeekModalProps {
  gameId: string;
  playerId: string;
  playerName: string;
  onClose: () => void;
}

// Read-only "what was my word again" peek, used once a player has already
// revealed (discussion screen, or re-tapping a done card on the reveal
// board). revealImposterWord is idempotent for an already-revealed player,
// so this is just a replay of the same call -- no separate query needed.
export default function WordPeekModal({ gameId, playerId, playerName, onClose }: WordPeekModalProps) {
  const [word, setWord] = useState<string | null>(null);
  const [isImposter, setIsImposter] = useState(false);
  const [loading, setLoading] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReveal() {
    setLoading(true);
    setError(null);
    try {
      const res = await runImposterQuery<RevealImposterWordResult>(REVEAL_IMPOSTER_WORD_MUTATION, {
        gameId,
        playerId,
      });
      setWord(res.revealImposterWord.word);
      setIsImposter(res.revealImposterWord.isImposter);
      setRevealed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your word - please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="imposter-modal-backdrop" onClick={onClose}>
      <div className="imposter-modal" onClick={(e) => e.stopPropagation()}>
        <p className="imposter-modal-name">{playerName}</p>
        {!revealed ? (
          <>
            <p className="project-desc">Make sure only {playerName} can see the screen, then tap below.</p>
            {error && <p className="status-line">// {error}</p>}
            <button className="run-btn" type="button" onClick={handleReveal} disabled={loading}>
              {loading ? "Loading…" : "Tap to view your word again"}
            </button>
          </>
        ) : (
          <>
            {isImposter && <p className="imposter-role-badge">You are the IMPOSTER</p>}
            {word !== null ? (
              <>
                {isImposter && <p className="imposter-hint">Your hint word (not the real word):</p>}
                <p className="imposter-word">{word}</p>
                <p className="project-desc">Memorize it, then tap outside to close.</p>
              </>
            ) : (
              <p className="project-desc">No hint this time - you'll have to bluff blind.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
