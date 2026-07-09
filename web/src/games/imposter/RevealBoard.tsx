import { useState } from "react";
import { Link } from "react-router-dom";
import {
  runImposterQuery,
  REVEAL_IMPOSTER_WORD_MUTATION,
  type ImposterGame,
  type ImposterPlayer,
  type RevealImposterWordResult,
} from "./api";

interface RevealBoardProps {
  gameId: string;
  players: ImposterPlayer[];
  onAllRevealed: (game: ImposterGame) => void;
}

export default function RevealBoard({ gameId, players: initialPlayers, onAllRevealed }: RevealBoardProps) {
  // Owns its own copy of the player list so a mid-modal reveal (including the
  // very last one) never causes the parent to swap this view out for the
  // discussion screen before the player has actually seen their word.
  const [players, setPlayers] = useState(initialPlayers);
  const [openPlayer, setOpenPlayer] = useState<ImposterPlayer | null>(null);
  const [word, setWord] = useState<string | null>(null);
  const [isImposter, setIsImposter] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finalGame, setFinalGame] = useState<ImposterGame | null>(null);

  function openModal(player: ImposterPlayer) {
    setOpenPlayer(player);
    setWord(null);
    setIsImposter(false);
    setRevealed(false);
    setError(null);
  }

  function closeModal() {
    setOpenPlayer(null);
    if (revealed && openPlayer) {
      const revealedId = openPlayer.id;
      setPlayers((prev) => prev.map((p) => (p.id === revealedId ? { ...p, hasRevealed: true } : p)));
    }
    // The mutation returns the current game on every reveal, not just the
    // last one -- only hand off to the parent once the phase has actually
    // moved past REVEAL, otherwise every reveal (not just the final one)
    // would skip the update above and the box would never turn grey until
    // a refresh re-fetched the game from scratch.
    if (finalGame && finalGame.phase !== "REVEAL") {
      onAllRevealed(finalGame);
    }
  }

  async function handleReveal() {
    if (!openPlayer) return;
    setRevealing(true);
    setError(null);
    try {
      const res = await runImposterQuery<RevealImposterWordResult>(REVEAL_IMPOSTER_WORD_MUTATION, {
        gameId,
        playerId: openPlayer.id,
      });
      setWord(res.revealImposterWord.word);
      setIsImposter(res.revealImposterWord.isImposter);
      setRevealed(true);
      // Hold onto the fully-updated game (which may have moved past REVEAL)
      // until this player dismisses the modal, rather than handing it to the
      // parent immediately - otherwise the last player's word would vanish
      // out from under them the instant the phase flips.
      setFinalGame(res.revealImposterWord.game);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reveal your word - please try again.");
    } finally {
      setRevealing(false);
    }
  }

  return (
    <div className="imposter-board-wrap">
      <Link to="/imposter" className="imposter-back-link">
        ← Back to start
      </Link>
      <p className="section-hint">
        Everyone can go in any order. Tap your name, make sure only you can see the screen, then reveal.
        Already seen yours? Tap your name again to check it.
      </p>
      <div className="imposter-board">
        {players.map((player) => {
          const status = player.hasRevealed ? "done" : "active";
          return (
            <button
              key={player.id}
              type="button"
              className={`imposter-box imposter-box-${status}`}
              onClick={() => openModal(player)}
            >
              <span className="imposter-box-name">{player.name}</span>
              <span className="imposter-box-status">
                {status === "done" ? "seen ✓ · view again" : "tap to view"}
              </span>
            </button>
          );
        })}
      </div>

      {openPlayer && (
        <div className="imposter-modal-backdrop" onClick={closeModal}>
          <div className="imposter-modal" onClick={(e) => e.stopPropagation()}>
            <p className="imposter-modal-name">{openPlayer.name}</p>
            {!revealed ? (
              <>
                <p className="project-desc">
                  Make sure only {openPlayer.name} can see the screen, then tap below.
                </p>
                {error && <p className="status-line">// {error}</p>}
                <button className="run-btn" type="button" onClick={handleReveal} disabled={revealing}>
                  {revealing
                    ? "Revealing…"
                    : openPlayer.hasRevealed
                      ? "Tap to view your word again"
                      : "Tap to reveal your word"}
                </button>
              </>
            ) : (
              <>
                {isImposter && <p className="imposter-role-badge">You are the IMPOSTER</p>}
                {word !== null ? (
                  <>
                    {isImposter && <p className="imposter-hint">Your hint word (not the real word):</p>}
                    <p className="imposter-word">{word}</p>
                    <p className="project-desc">Memorize it, then tap outside to pass it on.</p>
                  </>
                ) : (
                  <p className="project-desc">No hint this time - you'll have to bluff blind.</p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
