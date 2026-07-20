import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import RevealBoard from "./RevealBoard";
import { runImposterQuery } from "../lib/api";
import type { ImposterPlayer } from "../lib/api";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");

  return { ...actual, runImposterQuery: vi.fn() };
});

const runImposterQueryMock = vi.mocked(runImposterQuery);

function makePlayers(): ImposterPlayer[] {
  return [
    { id: "p1", name: "Alice", hasRevealed: false },
    { id: "p2", name: "Bob", hasRevealed: true },
  ];
}

function renderBoard(players: ImposterPlayer[], onAllRevealed = vi.fn()) {
  const utils = render(
    <MemoryRouter>
      <RevealBoard gameId="abcde" players={players} onAllRevealed={onAllRevealed} />
    </MemoryRouter>
  );

  return { ...utils, onAllRevealed };
}

beforeEach(() => {
  runImposterQueryMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("RevealBoard", () => {
  it("shows an unrevealed player as 'tap to view' and a revealed one as 'seen'", () => {
    renderBoard(makePlayers());

    expect(screen.getByText("Alice").closest("button")).toHaveClass("imposter-box-active");
    expect(screen.getByText("Bob").closest("button")).toHaveClass("imposter-box-done");
    expect(screen.getAllByText(/tap to view/)).toHaveLength(1);
    expect(screen.getAllByText(/seen ✓/)).toHaveLength(1);
  });

  it("opens a per-player modal on tap, showing that player's name and reveal button", () => {
    renderBoard(makePlayers());

    fireEvent.click(screen.getByText("Alice"));

    expect(screen.getByText("Tap to reveal your word")).toBeInTheDocument();
    expect(screen.getByText(/Make sure only Alice can see the screen/)).toBeInTheDocument();
  });

  it("shows the word and imposter badge after a successful reveal", async () => {
    runImposterQueryMock.mockResolvedValue({
      revealImposterWord: {
        word: "Tiger",
        isImposter: true,
        game: { gameId: "abcde", phase: "REVEAL" } as never,
      },
    } as never);
    renderBoard(makePlayers());

    fireEvent.click(screen.getByText("Alice"));
    fireEvent.click(screen.getByText("Tap to reveal your word"));

    await waitFor(() => expect(screen.getByText("Tiger")).toBeInTheDocument());
    expect(screen.getByText("You are the IMPOSTER")).toBeInTheDocument();
    expect(runImposterQueryMock).toHaveBeenCalledWith(expect.any(String), {
      gameId: "abcde",
      playerId: "p1",
    });
  });

  it("shows the 'no hint' message when the reveal returns a null word", async () => {
    runImposterQueryMock.mockResolvedValue({
      revealImposterWord: {
        word: null,
        isImposter: true,
        game: { gameId: "abcde", phase: "REVEAL" } as never,
      },
    } as never);
    renderBoard(makePlayers());

    fireEvent.click(screen.getByText("Alice"));
    fireEvent.click(screen.getByText("Tap to reveal your word"));

    await waitFor(() =>
      expect(screen.getByText("No hint this time - you'll have to bluff blind.")).toBeInTheDocument()
    );
  });

  it("shows an error and re-enables the button when the reveal fails", async () => {
    runImposterQueryMock.mockRejectedValue(new Error("network down"));
    renderBoard(makePlayers());

    fireEvent.click(screen.getByText("Alice"));
    fireEvent.click(screen.getByText("Tap to reveal your word"));

    await waitFor(() => expect(screen.getByText(/network down/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Tap to reveal your word" })).not.toBeDisabled();
  });

  it("marks a player as locally revealed once the modal is closed after a reveal, without waiting for new props", async () => {
    runImposterQueryMock.mockResolvedValue({
      revealImposterWord: {
        word: "Tiger",
        isImposter: false,
        // Still REVEAL - onAllRevealed must NOT fire for a mid-board reveal.
        game: { gameId: "abcde", phase: "REVEAL" } as never,
      },
    } as never);

    const onAllRevealed = vi.fn();
    renderBoard(makePlayers(), onAllRevealed);

    fireEvent.click(screen.getByText("Alice"));
    fireEvent.click(screen.getByText("Tap to reveal your word"));
    await waitFor(() => expect(screen.getByText("Tiger")).toBeInTheDocument());

    // Close by clicking the backdrop (modal content itself stops propagation).
    fireEvent.click(document.querySelector(".imposter-modal-backdrop")!);

    expect(screen.getByText("Alice").closest("button")).toHaveClass("imposter-box-done");
    expect(onAllRevealed).not.toHaveBeenCalled();
  });

  it("calls onAllRevealed once the final reveal moves the game past REVEAL", async () => {
    runImposterQueryMock.mockResolvedValue({
      revealImposterWord: {
        word: "Tiger",
        isImposter: false,
        game: { gameId: "abcde", phase: "DISCUSSION" } as never,
      },
    } as never);

    const onAllRevealed = vi.fn();
    renderBoard(makePlayers(), onAllRevealed);

    fireEvent.click(screen.getByText("Alice"));
    fireEvent.click(screen.getByText("Tap to reveal your word"));
    await waitFor(() => expect(screen.getByText("Tiger")).toBeInTheDocument());

    fireEvent.click(document.querySelector(".imposter-modal-backdrop")!);

    expect(onAllRevealed).toHaveBeenCalledWith(expect.objectContaining({ phase: "DISCUSSION" }));
  });

  it("lets an already-revealed player view their word again", () => {
    renderBoard(makePlayers());

    fireEvent.click(screen.getByText("Bob"));

    expect(screen.getByText("Tap to view your word again")).toBeInTheDocument();
  });
});
