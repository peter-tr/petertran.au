import { useState } from "react";
import { Link } from "react-router-dom";
import { getRecentGames, removeRecentGame, type RecentGame } from "./recentGames";

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function RecentGames() {
  const [games, setGames] = useState<RecentGame[]>(() => getRecentGames());

  function handleDelete(game: RecentGame) {
    if (!window.confirm(`Remove game ${game.gameId} from your list? This won't end it for other players.`)) {
      return;
    }
    removeRecentGame(game.gameId);
    setGames(getRecentGames());
  }

  if (games.length === 0) return null;

  return (
    <div className="imposter-field-group imposter-recent-games">
      <p className="form-label">Continue a game</p>
      <ul className="imposter-recent-list">
        {games.map((game) => (
          <li key={game.gameId} className="imposter-recent-item">
            <Link to={`/imposter/${game.gameId}`} className="imposter-recent-link">
              <span className="imposter-recent-code">{game.gameId}</span>
              <span className="imposter-recent-meta">
                {game.categoryLabel} · {game.playerNames.join(", ")}
              </span>
              <span className="imposter-recent-time">{formatWhen(game.createdAt)}</span>
            </Link>
            <button
              type="button"
              className="imposter-remove-btn"
              onClick={() => handleDelete(game)}
              aria-label={`Remove game ${game.gameId} from your list`}
            >
              &times;
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
