import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ResultsPanel from "./ResultsPanel";
import type { ImposterGame } from "../lib/api";

const navigateMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");

  return { ...actual, useNavigate: () => navigateMock };
});

function makeGame(overrides: Partial<ImposterGame> = {}): ImposterGame {
  return {
    gameId: "abcde",
    categoryLabel: "Animals",
    hintEnabled: true,
    phase: "RESULTS" as never,
    imposterPlayerIds: ["p2"],
    civilianWord: "Lion",
    imposterWord: "Tiger",
    createdAt: "2026-01-01T00:00:00.000Z",
    players: [
      { id: "p1", name: "Alice", hasRevealed: true },
      { id: "p2", name: "Bob", hasRevealed: true },
      { id: "p3", name: "Player 3", hasRevealed: true },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  navigateMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ResultsPanel", () => {
  it("shows the singular label and name for a single imposter", () => {
    render(<ResultsPanel game={makeGame()} />);

    expect(screen.getByText(/The imposter was/)).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("shows the plural label and joined names for multiple imposters", () => {
    render(<ResultsPanel game={makeGame({ imposterPlayerIds: ["p1", "p2"] })} />);

    expect(screen.getByText(/The imposters were/)).toBeInTheDocument();
    expect(screen.getByText("Alice, Bob")).toBeInTheDocument();
  });

  it("falls back to 'unknown' when there are no matching imposter ids", () => {
    render(<ResultsPanel game={makeGame({ imposterPlayerIds: [] })} />);

    expect(screen.getByText("unknown")).toBeInTheDocument();
  });

  it("tolerates a null imposterPlayerIds", () => {
    render(<ResultsPanel game={makeGame({ imposterPlayerIds: null })} />);

    expect(screen.getByText("unknown")).toBeInTheDocument();
  });

  it("shows the civilian word and imposter word", () => {
    render(<ResultsPanel game={makeGame()} />);

    expect(screen.getByText("Lion")).toBeInTheDocument();
    expect(screen.getByText("Tiger")).toBeInTheDocument();
  });

  it("shows a 'no hint' fallback when imposterWord is null", () => {
    render(<ResultsPanel game={makeGame({ imposterWord: null })} />);

    expect(screen.getByText("nothing - no hint this game")).toBeInTheDocument();
  });

  it("navigates to /imposter with prefilled names on 'Play again', blanking out generic 'Player N' names", () => {
    render(<ResultsPanel game={makeGame()} />);

    fireEvent.click(screen.getByText("Play again"));

    expect(navigateMock).toHaveBeenCalledWith("/imposter", {
      state: { prefillNames: ["Alice", "Bob", ""] },
    });
  });
});
