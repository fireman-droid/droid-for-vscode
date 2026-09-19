import { type ThemePreference } from '../../shared/protocol/shell';
import { STUDIO_SCENARIOS, type StudioScenarioId } from './scenarios';
import {
  STUDIO_VIEWPORT_WIDTHS,
  type StudioConfig,
  type StudioViewportWidth,
} from './studioRuntime';

export function StudioControls({
  config,
  onScenarioChange,
  onThemeChange,
  onWidthChange,
  onReset,
}: {
  readonly config: StudioConfig;
  readonly onScenarioChange: (scenario: StudioScenarioId) => void;
  readonly onThemeChange: (theme: ThemePreference) => void;
  readonly onWidthChange: (width: StudioViewportWidth) => void;
  readonly onReset: () => void;
}): React.JSX.Element {
  const activeScenario = STUDIO_SCENARIOS.find(
    (scenario) => scenario.id === config.scenario,
  );
  return (
    <header className="dvx-studio-controls">
      <div className="dvx-studio-control-group">
        <label htmlFor="dvx-studio-scenario">Scenario</label>
        <select
          id="dvx-studio-scenario"
          value={config.scenario}
          onChange={(event) =>
            onScenarioChange(event.currentTarget.value as StudioScenarioId)
          }
        >
          {STUDIO_SCENARIOS.map((scenario) => (
            <option key={scenario.id} value={scenario.id}>
              {scenario.label}
            </option>
          ))}
        </select>
      </div>
      <div className="dvx-studio-control-group">
        <label htmlFor="dvx-studio-theme">Theme</label>
        <select
          id="dvx-studio-theme"
          value={config.theme}
          onChange={(event) =>
            onThemeChange(event.currentTarget.value as ThemePreference)
          }
        >
          <option value="auto">Auto (editor dark)</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>
      <div className="dvx-studio-control-group">
        <label htmlFor="dvx-studio-width">Viewport</label>
        <select
          id="dvx-studio-width"
          value={config.width}
          onChange={(event) =>
            onWidthChange(Number(event.currentTarget.value) as StudioViewportWidth)
          }
        >
          {STUDIO_VIEWPORT_WIDTHS.map((width) => (
            <option key={width} value={width}>
              {width}px
            </option>
          ))}
        </select>
      </div>
      <button type="button" className="dvx-studio-reset" onClick={onReset}>
        Reset
      </button>
      <p className="dvx-studio-description">{activeScenario?.description}</p>
    </header>
  );
}
