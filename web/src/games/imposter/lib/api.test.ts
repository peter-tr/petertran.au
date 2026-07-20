import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  runImposterQuery,
  IMPOSTER_ENDPOINT,
  IMPOSTER_CATEGORIES_QUERY,
  IMPOSTER_GAME_QUERY,
  LIVE_IMPOSTER_GAMES_QUERY,
  CREATE_IMPOSTER_GAME_MUTATION,
  REVEAL_IMPOSTER_WORD_MUTATION,
  REVEAL_IMPOSTER_MUTATION,
  IMPOSTER_STATS_QUERY,
} from "./api";

// api.ts wires runImposterQuery from the shared fetch-based GraphQL client
// (see ../../../shared/graphqlClient.ts). We mock global fetch rather than
// hitting a real Lambda endpoint, and drive it through the actual exported
// runImposterQuery so this test exercises how this module wires that client
// up (endpoint, error surfacing) rather than re-testing the shared client.
describe("api.ts", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the imposter GraphQL endpoint from VITE_IMPOSTER_GRAPHQL_ENDPOINT (.env.test)", () => {
    expect(IMPOSTER_ENDPOINT).toBe("https://api.test.petertran.au/imposter");
  });

  it("POSTs the query/variables as JSON to the configured endpoint, tagged with the operation name", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { imposterCategories: [{ id: "animals", label: "Animals" }] } }),
    });

    const result = await runImposterQuery(IMPOSTER_CATEGORIES_QUERY);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${IMPOSTER_ENDPOINT}?opname=ImposterCategories`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ query: IMPOSTER_CATEGORIES_QUERY, variables: undefined });
    expect(result).toEqual({ imposterCategories: [{ id: "animals", label: "Animals" }] });
  });

  it("passes variables through in the request body", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { imposterGame: null } }),
    });

    await runImposterQuery(IMPOSTER_GAME_QUERY, { gameId: "abcde" });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).variables).toEqual({ gameId: "abcde" });
  });

  it("throws when the HTTP response isn't ok", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    await expect(runImposterQuery(IMPOSTER_STATS_QUERY)).rejects.toThrow("Request failed with status 500");
  });

  it("throws when the response body carries a GraphQL errors array, even on HTTP 200", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ errors: [{ message: "Game not found" }, { message: "Try again" }] }),
    });

    await expect(runImposterQuery(IMPOSTER_GAME_QUERY, { gameId: "nope" })).rejects.toThrow(
      "Game not found; Try again"
    );
  });

  it.each([
    ["IMPOSTER_CATEGORIES_QUERY", IMPOSTER_CATEGORIES_QUERY, "query ImposterCategories"],
    ["IMPOSTER_GAME_QUERY", IMPOSTER_GAME_QUERY, "query ImposterGameState"],
    ["LIVE_IMPOSTER_GAMES_QUERY", LIVE_IMPOSTER_GAMES_QUERY, "query LiveImposterGames"],
    ["CREATE_IMPOSTER_GAME_MUTATION", CREATE_IMPOSTER_GAME_MUTATION, "mutation CreateImposterGame"],
    ["REVEAL_IMPOSTER_WORD_MUTATION", REVEAL_IMPOSTER_WORD_MUTATION, "mutation RevealImposterWord"],
    ["REVEAL_IMPOSTER_MUTATION", REVEAL_IMPOSTER_MUTATION, "mutation RevealImposter"],
    ["IMPOSTER_STATS_QUERY", IMPOSTER_STATS_QUERY, "query ImposterStatsQuery"],
  ])("%s is named (required for opname tagging and codegen)", (_label, query, expectedPrefix) => {
    expect(query.trim().startsWith(expectedPrefix)).toBe(true);
  });

  it("game-shaped queries/mutations all spread the ImposterGameFields fragment", () => {
    for (const query of [
      IMPOSTER_GAME_QUERY,
      LIVE_IMPOSTER_GAMES_QUERY,
      CREATE_IMPOSTER_GAME_MUTATION,
      REVEAL_IMPOSTER_WORD_MUTATION,
      REVEAL_IMPOSTER_MUTATION,
    ]) {
      expect(query).toContain("...ImposterGameFields");
      expect(query).toContain("fragment ImposterGameFields on ImposterGame");
    }
  });
});
