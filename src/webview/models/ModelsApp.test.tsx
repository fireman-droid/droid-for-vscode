// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelsApp } from './ModelsApp';
import { ModelsApp as ModelsAppV2 } from '../../webview-v2/models/ModelsApp';
import { createModelsPreviewTransport } from '../dev/modelsPreviewTransport';

afterEach(cleanup);
describe.each([['V1', ModelsApp], ['V2', ModelsAppV2]] as const)('%s Models editor save lifecycle', (_version, App) => {
  it('retains connection input on a failed save and closes only after confirmation', async () => {
    const preview = createModelsPreviewTransport();
    render(<App transport={preview.transport} />);
    await screen.findByRole('heading', { name: 'Personal gateway' });
    fireEvent.click(screen.getByRole('button', { name: '+ New connection' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Connection name' }), {
      target: { value: 'My new gateway' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Base URL/ }), {
      target: { value: 'https://new.example.com/v1' },
    });
    preview.failSave();
    fireEvent.click(screen.getByRole('button', { name: 'Save connection' }));
    await screen.findByRole('alert');
    expect(
      (screen.getByRole('textbox', { name: 'Connection name' }) as HTMLInputElement)
        .value,
    ).toBe('My new gateway');
    fireEvent.click(screen.getByRole('button', { name: 'Save connection' }));
    await screen.findByRole('heading', { name: 'My new gateway' });
    expect(screen.queryByRole('textbox', { name: 'Connection name' })).toBeNull();
  });
  it('saves an edited Model ID before verifying it and disables chat selection while busy', async () => {
    const preview = createModelsPreviewTransport();
    render(<App transport={preview.transport} />);
    await screen.findByRole('heading', { name: 'Personal gateway' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit', exact: true })[0]!);
    fireEvent.change(screen.getByRole('textbox', { name: 'Model ID' }), {
      target: { value: 'new-upstream-id' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save & verify…' }));
    await screen.findByText(/Simulated reply from new-upstream-id/);
    preview.busy(true);
    await waitFor(() => {
      expect(
        screen
          .getAllByRole('button', { name: 'Use in chat' })
          .every((button) => (button as HTMLButtonElement).disabled),
      ).toBe(true);
    });
  });
  it('imports only newly selected discovered models and applies the refreshed model identity', async () => {
    const preview = createModelsPreviewTransport();
    const requests: Parameters<typeof preview.transport.postMessage>[0][] = [];
    const transport = {
      ...preview.transport,
      postMessage: (request: (typeof requests)[number]) => {
        requests.push(request);
        preview.transport.postMessage(request);
      },
    };
    render(<App transport={transport} />);
    await screen.findByRole('heading', { name: 'Personal gateway' });
    fireEvent.click(screen.getByRole('button', { name: 'Discover models' }));
    const discovered = await screen.findByRole('region', { name: 'Discovered models' });
    expect(within(discovered).getByRole('checkbox', { name: /gateway-reasoner/ }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(within(discovered).getByRole('checkbox', { name: 'gateway-coder-32b' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add selected (1)' }));
    const modelHeading = await screen.findByRole('heading', { name: /gateway-coder-32b/ });
    const imported = requests.find((request) => request.action.kind === 'importModels');
    expect(imported?.action).toEqual({ kind: 'importModels', connectionId: 'gateway', models: [{ model: 'gateway-coder-32b' }] });
    const row = modelHeading.closest('article')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Use in chat' }));
    await waitFor(() => {
      expect(requests.at(-1)?.action).toMatchObject({ kind: 'useModel', expectedModel: 'gateway-coder-32b' });
    });
  });
});
