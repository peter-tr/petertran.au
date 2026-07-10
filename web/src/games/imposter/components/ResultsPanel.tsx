import { useNavigate } from "react-router-dom";
import type { ImposterGame } from "../lib/api";

interface ResultsPanelProps {
  game: ImposterGame;
}

// Names left blank at setup are stored as "Player 1", "Player 2", etc, not
// as placeholders -- so a "Play again" prefill has to leave those blank
// again rather than carrying the literal string over as real text a player
// would have to delete before typing their own name.
const GENERIC_NAME_PATTERN = /^Player \d+$/;

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
          <p className="imposter-hint">{imposters.length > 1 ? "The imposters got" : "The imposter got"}</p>
          <p className="imposter-word imposter-word-alt">
            {game.imposterWord ?? "nothing - no hint this game"}
          </p>
        </div>
      </div>
      <button
        className="run-btn"
        type="button"
        onClick={() =>
          navigate("/imposter", {
            state: {
              prefillNames: game.players.map((p) => (GENERIC_NAME_PATTERN.test(p.name) ? "" : p.name)),
            },
          })
        }
      >
        Play again
      </button>
    </div>
  );
}
