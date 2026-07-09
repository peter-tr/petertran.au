import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { runImposterQuery, IMPOSTER_GAME_QUERY, type ImposterGame, type ImposterGameResult } from "./api";
import { removeRecentGame } from "./recentGamesStore";
import RevealBoard from "./RevealBoard";
import DiscussionPanel from "./DiscussionPanel";
import ResultsPanel from "./ResultsPanel";
import "./imposter.css";

export default function ImposterGamePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const [game, setGame] = useState<ImposterGame | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  // A finished game has nothing left to continue -- drop it from this
  // device's list as soon as it's seen reaching RESULTS, whether that's
  // because it just finished or because it was already done when revisited.
  useEffect(() => {
    if (game?.phase === "RESULTS") removeRecentGame(game.gameId);
  }, [game?.phase, game?.gameId]);

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">
          game {gameId} · {game?.categoryLabel ?? "…"}
        </p>
        <h1>Imposter</h1>
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
