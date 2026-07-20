import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import StatsPanel from "./StatsPanel";
import { runImposterQuery } from "../lib/api";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");

  return { ...actual, runImposterQuery: vi.fn() };
});

const runImposterQueryMock = vi.mocked(runImposterQuery);

beforeEach(() => {
  runImposterQueryMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("StatsPanel", () => {
  it("renders nothing while the stats fetch is still pending", () => {
    runImposterQueryMock.mockReturnValue(new Promise(() => {})); // never resolves

    const { container } = render(<StatsPanel />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing if no games have ever been played", async () => {
    runImposterQueryMock.mockResolvedValue({
      imposterStats: { gamesPlayedTotal: 0, gamesCompletedTotal: 0, avgGameDurationMs: 0 },
    } as never);

    const { container } = render(<StatsPanel />);

    await waitFor(() => expect(runImposterQueryMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing if the stats fetch fails", async () => {
    runImposterQueryMock.mockRejectedValue(new Error("boom"));

    const { container } = render(<StatsPanel />);

    await waitFor(() => expect(runImposterQueryMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders played/completed counts and a minutes+seconds duration once loaded", async () => {
    runImposterQueryMock.mockResolvedValue({
      imposterStats: { gamesPlayedTotal: 42, gamesCompletedTotal: 30, avgGameDurationMs: 125_000 },
    } as never);
    render(<StatsPanel />);

    expect(await screen.findByText("42")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.getByText("2m 5s")).toBeInTheDocument();
  });

  it("renders a seconds-only duration when under a minute", async () => {
    runImposterQueryMock.mockResolvedValue({
      imposterStats: { gamesPlayedTotal: 5, gamesCompletedTotal: 5, avgGameDurationMs: 45_000 },
    } as never);
    render(<StatsPanel />);

    expect(await screen.findByText("45s")).toBeInTheDocument();
  });

  it("renders an em dash for a non-positive duration", async () => {
    runImposterQueryMock.mockResolvedValue({
      imposterStats: { gamesPlayedTotal: 5, gamesCompletedTotal: 0, avgGameDurationMs: 0 },
    } as never);
    render(<StatsPanel />);

    expect(await screen.findByText("—")).toBeInTheDocument();
  });
});
