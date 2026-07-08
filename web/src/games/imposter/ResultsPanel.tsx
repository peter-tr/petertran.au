import { useNavigate } from "react-router-dom";
import type { ImposterGame } from "./api";

interface ResultsPanelProps {
  game: ImposterGame;
}

export default function ResultsPanel({ game }: ResultsPanelProps) {
  const navigate = useNavigate();
  const imposterIds = new Set(game.imposterPlayerIds ?? []);
  const imposters = game.players.filter((p) => imposterIds.has(p.id));
  const label = imposters.length > 1 ? "The imposters were" : "The imposter was";

  return (
    <div className="imposter-results">
      <p className="imposter-results-imposter">
        {label} <strong>{imposters.map((p) => p.name).join(", ") || "unknown"}</strong>
      </p>
      <div className="imposter-results-words">
        <div>
          <p className="imposter-hint">Everyone else got</p>
          <p className="imposter-word">{game.civilianWord}</p>
        </div>
        <div>
          <p className="imposter-hint">
            {imposters.length > 1 ? "The imposters got" : "The imposter got"}
          </p>
          <p className="imposter-word imposter-word-alt">{game.imposterWord ?? "nothing - no hint this game"}</p>
        </div>
      </div>
      <button
        className="run-btn"
        type="button"
        onClick={() => navigate("/imposter", { state: { prefillNames: game.players.map((p) => p.name) } })}
      >
        Play again
      </button>
    </div>
  );
}
