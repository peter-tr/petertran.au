import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DiscussionPanel from "./DiscussionPanel";
import { runImposterQuery } from "../lib/api";
import type { ImposterPlayer } from "../lib/api";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");

  return { ...actual, runImposterQuery: vi.fn() };
});

// WordPeekModal has its own reveal/error flow already covered in spirit by
// RevealBoard's modal tests - stub it here so these tests stay focused on
// DiscussionPanel's own logic (first-player pick, reveal handoff).
vi.mock("./WordPeekModal", () => ({
  default: ({ playerName, onClose }: { playerName: string; onClose: () => void }) => (
    <div data-testid="word-peek-modal">
      <span>peeking: {playerName}</span>
      <button type="button" onClick={onClose}>
        close peek
      </button>
    </div>
  ),
}));

const runImposterQueryMock = vi.mocked(runImposterQuery);

const players: ImposterPlayer[] = [
  { id: "p1", name: "Alice", hasRevealed: true },
  { id: "p2", name: "Bob", hasRevealed: true },
  { id: "p3", name: "Carol", hasRevealed: true },
];

beforeEach(() => {
  runImposterQueryMock.mockReset();
});

describe("DiscussionPanel", () => {
  it("picks a first player from the given list and lists everyone in the prompt", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0); // -> players[0]
    render(<DiscussionPanel gameId="abcde" players={players} onGameUpdate={vi.fn()} />);

    expect(screen.getByText(/goes first/).closest("p")?.textContent).toContain("Alice");
    expect(screen.getByRole("button", { name: "Alice" })).toBeInTheDocument();
    expect(screen.getByText(/Alice, Bob, Carol/)).toBeInTheDocument();

    randomSpy.mockRestore();
  });

  it("does not re-roll the first player across re-renders", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99); // -> last player, Carol
    const { rerender } = render(<DiscussionPanel gameId="abcde" players={players} onGameUpdate={vi.fn()} />);

    expect(screen.getByText(/goes first/).closest("p")?.textContent).toContain("Carol");

    randomSpy.mockReturnValue(0); // would now pick Alice if re-evaluated
    rerender(<DiscussionPanel gameId="abcde" players={players} onGameUpdate={vi.fn()} />);

    expect(screen.getByText(/goes first/).closest("p")?.textContent).toContain("Carol");

    randomSpy.mockRestore();
  });

  it("opens a word-peek modal for the tapped player", () => {
    render(<DiscussionPanel gameId="abcde" players={players} onGameUpdate={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Bob" }));

    expect(screen.getByTestId("word-peek-modal")).toHaveTextContent("peeking: Bob");
  });

  it("closes the peek modal via its onClose callback", () => {
    render(<DiscussionPanel gameId="abcde" players={players} onGameUpdate={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Bob" }));
    fireEvent.click(screen.getByText("close peek"));

    expect(screen.queryByTestId("word-peek-modal")).not.toBeInTheDocument();
  });

  it("reveals the imposter and hands the updated game to the parent", async () => {
    const updatedGame = { gameId: "abcde", phase: "RESULTS" } as never;
    runImposterQueryMock.mockResolvedValue({ revealImposter: updatedGame } as never);

    const onGameUpdate = vi.fn();
    render(<DiscussionPanel gameId="abcde" players={players} onGameUpdate={onGameUpdate} />);

    fireEvent.click(screen.getByText("Reveal the imposter"));

    await waitFor(() => expect(onGameUpdate).toHaveBeenCalledWith(updatedGame));
    expect(runImposterQueryMock).toHaveBeenCalledWith(expect.any(String), { gameId: "abcde" });
  });

  it("shows an error and re-enables the button when revealing fails", async () => {
    runImposterQueryMock.mockRejectedValue(new Error("server exploded"));
    render(<DiscussionPanel gameId="abcde" players={players} onGameUpdate={vi.fn()} />);

    fireEvent.click(screen.getByText("Reveal the imposter"));

    await waitFor(() => expect(screen.getByText(/server exploded/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Reveal the imposter" })).not.toBeDisabled();
  });
});
