import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  runImposterQuery,
  LIVE_IMPOSTER_GAMES_QUERY,
  type ImposterGame,
  type LiveImposterGamesResult,
} from "./api";
import { formatWhen } from "./format";

const POLL_INTERVAL_MS = 5000;

const PHASE_LABEL: Record<ImposterGame["phase"], string> = {
  REVEAL: "revealing",
  DISCUSSION: "discussing",
  RESULTS: "finished",
};

// Every room currently in progress, anywhere - not just the ones started on
// this device (see RecentGames, which is the localStorage-backed version of
// this same idea). Polls rather than pushing updates, same tradeoff as
// Game.tsx's in-game poll - simplest thing that keeps the list fresh without
// new realtime infra.
export default function LiveGames() {
  const [games, setGames] = useState<ImposterGame[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    function load() {
      runImposterQuery<LiveImposterGamesResult>(LIVE_IMPOSTER_GAMES_QUERY)
        .then((res) => {
          if (!cancelled) setGames(res.liveImposterGames);
        })
        .catch(() => {
          // Nice-to-have on the landing page, not core functionality - fail quietly.
        });
    }

    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!games || games.length === 0) return null;

  return (
    <div className="imposter-field-group imposter-recent-games">
      <p className="form-label">Live games ({games.length})</p>
      <ul className="imposter-recent-list">
        {games.map((game) => (
          <li key={game.gameId} className="imposter-recent-item">
            <Link to={`/imposter/${game.gameId}`} className="imposter-recent-link">
              <span className="imposter-recent-code">{game.gameId}</span>
              <span className="imposter-recent-meta">
                {game.categoryLabel ?? "Category hidden"} ·{" "}
                {game.players.map((p) => p.name).join(", ")} · {PHASE_LABEL[game.phase]}
              </span>
              <span className="imposter-recent-time">since {formatWhen(game.createdAt)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
