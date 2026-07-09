import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { runImposterQuery, IMPOSTER_GAME_QUERY, type ImposterGame, type ImposterGameResult } from "./api";
import { removeRecentGame } from "./recentGamesStore";
import RevealBoard from "./RevealBoard";
import DiscussionPanel from "./DiscussionPanel";
import ResultsPanel from "./ResultsPanel";
import "./imposter.css";

const POLL_INTERVAL_MS = 3000;

export default function ImposterGamePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const [game, setGame] = useState<ImposterGame | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!gameId) return;
    runImposterQuery<ImposterGameResult>(IMPOSTER_GAME_QUERY, { gameId })
      .then((res) => {
        if (!res.imposterGame) {
          setError("That game code wasn't found - double check it and try again.");
        } else {
          setGame(res.imposterGame);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load game"))
      .finally(() => setLoading(false));
  }, [gameId]);

  // Poll for updates so anyone else with this link - another device, or a
  // friend just watching along - sees the game move without a manual
  // refresh. Stops once the game reaches RESULTS, since nothing more changes.
  useEffect(() => {
    if (!gameId || loading || game?.phase === "RESULTS") return;
    const interval = setInterval(() => {
      runImposterQuery<ImposterGameResult>(IMPOSTER_GAME_QUERY, { gameId })
        .then((res) => {
          if (res.imposterGame) setGame(res.imposterGame);
        })
        .catch(() => {
          // Transient polling failure - just keep showing the last good state.
        });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [gameId, loading, game?.phase]);

  // A finished game has nothing left to continue -- drop it from this
  // device's list as soon as it's seen reaching RESULTS, whether that's
  // because it just finished or because it was already done when revisited.
  useEffect(() => {
    if (game?.phase === "RESULTS") removeRecentGame(game.gameId);
  }, [game?.phase, game?.gameId]);

  async function handleShare() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Join my Imposter game", url });
        return;
      } catch {
        // User dismissed the native share sheet - fall through to clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable - nothing more we can do here.
    }
  }

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">{game?.categoryLabel ?? "…"}</p>
        <h1>Imposter</h1>
        {!loading && game && (
          <button type="button" className="imposter-add-btn" onClick={handleShare}>
            {copied ? "Link copied!" : "Share this game"}
          </button>
        )}
      </header>

      {loading && <p className="status-line">// loading game…</p>}

      {!loading && error && (
        <p className="status-line">
          // {error} <Link to="/imposter">Start a new game</Link>
        </p>
      )}

      {!loading && game && game.phase === "REVEAL" && (
        <RevealBoard gameId={game.gameId} players={game.players} onAllRevealed={setGame} />
      )}

      {!loading && game && game.phase === "DISCUSSION" && (
        <DiscussionPanel gameId={game.gameId} players={game.players} onGameUpdate={setGame} />
      )}

      {!loading && game && game.phase === "RESULTS" && <ResultsPanel game={game} />}
    </>
  );
}
