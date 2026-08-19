// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  IDLE_CUSTOM_MODEL_DISCOVERY_STATE,
  type ProviderConnectionSummary,
} from "../../shared/customModelsProtocol";
import {
  CustomModelsContext,
  type CustomModelsFlowValue,
} from "./customModelsFlow";
import { ModelsPage, ProviderEditor } from "./ModelsPage";

afterEach(cleanup);

const provider: ProviderConnectionSummary = {
  id: "provider-a",
  displayName: "Gateway",
  protocol: "openai",
  rootUrl: "https://api.example.com",
  apiBaseUrl: "https://api.example.com/v1",
  hasApiKey: true,
  imported: false,
  modelCount: 0,
};

function editorProps(
  overrides: Partial<React.ComponentProps<typeof ProviderEditor>> = {},
): React.ComponentProps<typeof ProviderEditor> {
  return {
    provider,
    providers: [provider],
    items: [],
    discovery: { status: "ready", items: [] },
    busy: false,
    onBack: vi.fn(),
    onSave: vi.fn(),
    onFetch: vi.fn(),
    onImport: vi.fn(),
    onSaveModel: vi.fn(),
    onTest: vi.fn(),
    onTestAll: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
}

describe("ProviderEditor", () => {
  it("offers manual entry when fetch returns no models", () => {
    render(<ProviderEditor {...editorProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Fetch model list" }));
    expect(
      screen.getByText("No models were returned by this connection."),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Add model manually" }));
    expect(screen.getByLabelText("Model ID *")).toBeDefined();
  });

  it("tests a saved model from the editor card", () => {
    const onTest = vi.fn();
    const onTestAll = vi.fn();
    render(
      <ProviderEditor
        {...editorProps({
          onTest,
          onTestAll,
          items: [
            {
              rawIndex: 0,
              model: "claude-sonnet-5",
              displayName: "Claude Sonnet 5",
              provider: "openai",
              baseUrl: "https://api.example.com",
              hasApiKey: true,
              hasBedrockConfig: false,
              isValid: true,
              maxOutputTokens: 16384,
            },
          ],
          provider: {
            ...provider,
            rootUrl: "https://api.example.com",
            apiBaseUrl: "https://api.example.com/v1",
            modelCount: 1,
            modelTests: [
              {
                model: "claude-sonnet-5",
                status: "passed",
                summary: "OK",
                latencyMs: 42,
              },
            ],
          },
          providers: [
            {
              ...provider,
              rootUrl: "https://api.example.com",
              apiBaseUrl: "https://api.example.com/v1",
              modelCount: 1,
              modelTests: [
                {
                  model: "claude-sonnet-5",
                  status: "passed",
                  summary: "OK",
                  latencyMs: 42,
                },
              ],
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("Passed · 42ms")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    fireEvent.click(screen.getByRole("button", { name: "Test all" }));
    expect(onTest).toHaveBeenCalledWith("provider-a", "claude-sonnet-5");
    expect(onTestAll).toHaveBeenCalledWith("provider-a");
  });

  it("keeps fetch disabled until the connection has a saved key", () => {
    const providerWithoutKey = { ...provider, hasApiKey: false };
    render(
      <ProviderEditor
        {...editorProps({
          provider: providerWithoutKey,
          providers: [providerWithoutKey],
        })}
      />,
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Fetch model list",
      }).disabled,
    ).toBe(true);
    expect(
      screen.getByText(
        "Save an API key for this connection before fetching its model list.",
      ),
    ).toBeDefined();
  });
});

it("refreshes provider state when returning to the list", () => {
  const onRefresh = vi.fn();
  const onRefreshProviders = vi.fn();
  const flow: CustomModelsFlowValue = {
    sessionId: "session-a",
    customModels: { status: "ready", items: [] },
    discovery: IDLE_CUSTOM_MODEL_DISCOVERY_STATE,
    providers: { status: "ready", providers: [provider] },
    onOpenManager: vi.fn(),
    onRefresh,
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onDiscover: vi.fn(),
    onImport: vi.fn(),
    onRefreshProviders,
    onSaveProvider: vi.fn(),
    onFetchProvider: vi.fn(),
    onImportProviderModels: vi.fn(),
    onSaveProviderModel: vi.fn(),
    onTestProviderModel: vi.fn(),
    onTestAllProviderModels: vi.fn(),
  };
  render(
    <CustomModelsContext.Provider value={flow}>
      <ModelsPage onClose={vi.fn()} />
    </CustomModelsContext.Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Gateway/ }));
  fireEvent.click(screen.getByRole("button", { name: "Back to models" }));
  expect(onRefreshProviders).toHaveBeenCalledTimes(2);
  expect(onRefresh).toHaveBeenCalledTimes(2);
});
