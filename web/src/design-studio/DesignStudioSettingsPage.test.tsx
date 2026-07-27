import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import DesignStudioSettingsPage from "./DesignStudioSettingsPage";
import { getAiSettings, updateAiSettings, AiProvider, AiModelTier } from "./api";
import type { AiSettings } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();

  return {
    ...actual,
    getAiSettings: vi.fn(),
    updateAiSettings: vi.fn(),
  };
});

const mockGetAiSettings = vi.mocked(getAiSettings);
const mockUpdateAiSettings = vi.mocked(updateAiSettings);

function makeSettings(overrides: Partial<AiSettings> = {}): AiSettings {
  return {
    provider: AiProvider.Anthropic,
    modelTier: AiModelTier.Haiku,
    allowSupergraphQuery: false,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DesignStudioSettingsPage />
    </MemoryRouter>
  );
}

describe("DesignStudioSettingsPage", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("renders the AI provider panel and the portfolio-data-access panel once settings load", async () => {
    mockGetAiSettings.mockResolvedValueOnce(makeSettings());

    renderPage();

    await waitFor(() => expect(screen.getByText("AI provider")).toBeInTheDocument());
    expect(screen.getByText("Portfolio data access")).toBeInTheDocument();
    expect(screen.getByLabelText("Provider")).toHaveValue("ANTHROPIC");
    expect(screen.getByLabelText("Model")).toHaveValue("HAIKU");
    expect(screen.getByLabelText(/Allow AI generation to query portfolio data/)).not.toBeChecked();
  });

  it("toggling the checkbox calls updateSettings with the right partial", async () => {
    mockGetAiSettings.mockResolvedValueOnce(makeSettings({ allowSupergraphQuery: false }));
    mockUpdateAiSettings.mockResolvedValueOnce(makeSettings({ allowSupergraphQuery: true }));

    renderPage();

    const checkbox = await screen.findByLabelText(/Allow AI generation to query portfolio data/);
    fireEvent.click(checkbox);

    expect(mockUpdateAiSettings).toHaveBeenCalledWith({ allowSupergraphQuery: true });
    await waitFor(() => expect(checkbox).toBeChecked());
  });

  it("steers away from BEDROCK+HAIKU when switching provider to Bedrock", async () => {
    mockGetAiSettings.mockResolvedValueOnce(
      makeSettings({ provider: AiProvider.Anthropic, modelTier: AiModelTier.Haiku })
    );
    mockUpdateAiSettings.mockResolvedValueOnce(
      makeSettings({ provider: AiProvider.Bedrock, modelTier: AiModelTier.Sonnet })
    );

    renderPage();

    const providerSelect = await screen.findByLabelText("Provider");
    fireEvent.change(providerSelect, { target: { value: "BEDROCK" } });

    expect(mockUpdateAiSettings).toHaveBeenCalledWith({
      provider: AiProvider.Bedrock,
      modelTier: AiModelTier.Sonnet,
    });
  });

  it("shows an error message when the initial load fails", async () => {
    mockGetAiSettings.mockRejectedValueOnce(new Error("network down"));

    renderPage();

    await waitFor(() => expect(screen.getByText(/network down/)).toBeInTheDocument());
  });
});
