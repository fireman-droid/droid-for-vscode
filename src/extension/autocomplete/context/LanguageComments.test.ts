import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  extensions: [] as { id: string; extensionUri: { toString(): string }; packageJSON: unknown }[],
  stat: vi.fn(), readFile: vi.fn(),
}));

vi.mock('vscode', () => ({
  extensions: { get all() { return mocks.extensions; } },
  workspace: { fs: { stat: mocks.stat, readFile: mocks.readFile } },
  Uri: { joinPath: (base: { toString(): string }, path: string) => ({ toString: () => `${base.toString()}/${path}` }) },
}));

function extension(language: string, id = 'sample.language', version = '1', configuration = 'language.json') {
  return {
    id, extensionUri: { toString: () => `file:///extensions/${id}` },
    packageJSON: { version, contributes: { languages: [{ id: language, configuration }] } },
  };
}

function metadata(value: string) { return Buffer.from(value, 'utf8'); }

beforeEach(() => {
  vi.resetModules();
  mocks.extensions = [];
  mocks.stat.mockReset().mockResolvedValue({ size: 100 });
  mocks.readFile.mockReset().mockResolvedValue(metadata('{"comments":{"lineComment":"//"}}'));
});

afterEach(() => { vi.useRealTimers(); });

describe('readLanguageComments', () => {
  it.each(['go', 'java', 'typescript'])('reads %s JSONC language configuration without activating extensions', async (language) => {
    mocks.extensions = [extension(language)];
    mocks.readFile.mockResolvedValue(metadata(`{
      // Configuration files may contain comments and trailing commas.
      "comments": { "lineComment": "//", "blockComment": ["/*", "*/"], },
    }`));
    const { readLanguageComments } = await import('./LanguageComments');
    expect(await readLanguageComments(language)).toEqual({ line: '//', block: ['/*', '*/'] });
    expect(mocks.readFile.mock.calls[0][0].toString()).toBe('file:///extensions/sample.language/language.json');
  });

  it('works for a newly contributed language and block-only syntax', async () => {
    mocks.extensions = [extension('custom-language')];
    mocks.readFile.mockResolvedValue(metadata('{"comments":{"blockComment":["(*","*)"]}}'));
    const { readLanguageComments } = await import('./LanguageComments');
    expect(await readLanguageComments('custom-language')).toEqual({ block: ['(*', '*)'] });
    expect(await readLanguageComments('unknown')).toBeUndefined();
  });

  it('shares pending reads, and invalidates when installed extensions change', async () => {
    mocks.extensions = [extension('custom')];
    const { readLanguageComments } = await import('./LanguageComments');
    await Promise.all([readLanguageComments('custom'), readLanguageComments('custom')]);
    expect(mocks.readFile).toHaveBeenCalledTimes(1);
    mocks.extensions.push(extension('custom', 'override', '2'));
    mocks.readFile.mockResolvedValue(metadata('{"comments":{"lineComment":"#"}}'));
    expect(await readLanguageComments('custom')).toEqual({ line: '#' });
    expect(mocks.readFile).toHaveBeenCalledTimes(2);
    mocks.extensions = [];
    expect(await readLanguageComments('custom')).toBeUndefined();
  });

  it('invalidates when a contributing extension is updated in place', async () => {
    mocks.extensions = [extension('custom')];
    const { readLanguageComments } = await import('./LanguageComments');
    await readLanguageComments('custom');
    mocks.extensions = [extension('custom', 'sample.language', '2')];
    mocks.readFile.mockResolvedValue(metadata('{"comments":{"lineComment":"--"}}'));
    expect(await readLanguageComments('custom')).toEqual({ line: '--' });
  });

  it('bounds metadata reads using both the reported size and actual byte count', async () => {
    mocks.extensions = [extension('large')];
    mocks.stat.mockResolvedValue({ size: 128 * 1024 + 1 });
    const { readLanguageComments } = await import('./LanguageComments');
    expect(await readLanguageComments('large')).toBeUndefined();
    expect(mocks.readFile).not.toHaveBeenCalled();
    mocks.extensions = [extension('large', 'sample.language', '2')];
    mocks.stat.mockResolvedValue({ size: 100 });
    mocks.readFile.mockResolvedValue(metadata(' '.repeat(128 * 1024) + '{"comments":{"lineComment":"#"}}'));
    expect(await readLanguageComments('large')).toBeUndefined();
  });

  it.each(['../outside.json', '/outside.json', 'C:\\private.json', 'https://example.com/config.json'])(
    'does not follow a configuration outside the extension: %s', async (configuration) => {
      mocks.extensions = [extension('custom', 'sample', '1', configuration)];
      const { readLanguageComments } = await import('./LanguageComments');
      expect(await readLanguageComments('custom')).toBeUndefined();
      expect(mocks.stat).not.toHaveBeenCalled();
      expect(mocks.readFile).not.toHaveBeenCalled();
    },
  );

  it.each(['{broken', '{"comments":{"lineComment":3}}', '{"comments":{"lineComment":"x\\ny"}}'])(
    'ignores malformed optional configuration: %s', async (content) => {
      mocks.extensions = [extension('custom')];
      mocks.readFile.mockResolvedValue(metadata(content));
      const { readLanguageComments } = await import('./LanguageComments');
      expect(await readLanguageComments('custom')).toBeUndefined();
    },
  );

  it('can fall back to another valid contribution when a configuration is unavailable', async () => {
    mocks.extensions = [extension('custom', 'builtin'), extension('custom', 'missing')];
    mocks.readFile.mockRejectedValueOnce(new Error('FileNotFound'));
    const { readLanguageComments } = await import('./LanguageComments');
    expect(await readLanguageComments('custom')).toEqual({ line: '//' });
  });

  it('returns after 150ms when metadata stalls and retries without caching a timeout', async () => {
    mocks.extensions = [extension('custom')];
    mocks.stat.mockImplementationOnce(() => new Promise(() => {}));
    const { readLanguageComments } = await import('./LanguageComments');
    vi.useFakeTimers();
    let settled = false;
    const pending = readLanguageComments('custom').then((value) => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(149);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBeUndefined();
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(await readLanguageComments('custom')).toEqual({ line: '//' });
    expect(mocks.stat).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels one caller immediately while another shares the same successful read', async () => {
    mocks.extensions = [extension('custom')];
    let complete!: (bytes: Uint8Array) => void;
    mocks.readFile.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const { readLanguageComments } = await import('./LanguageComments');
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const cancelled = readLanguageComments('custom', controller.signal);
    const surviving = readLanguageComments('custom');
    await Promise.resolve();
    controller.abort();
    expect(await cancelled).toBeUndefined();
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    complete(metadata('{"comments":{"lineComment":"#"}}'));
    expect(await surviving).toEqual({ line: '#' });
    expect(await readLanguageComments('custom')).toEqual({ line: '#' });
    expect(mocks.readFile).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not read metadata for a caller that was already cancelled', async () => {
    mocks.extensions = [extension('custom')];
    const { readLanguageComments } = await import('./LanguageComments');
    const controller = new AbortController();
    controller.abort();
    expect(await readLanguageComments('custom', controller.signal)).toBeUndefined();
    expect(mocks.stat).not.toHaveBeenCalled();
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it('does not let a late result from a timed-out read overwrite a fresh cached result', async () => {
    mocks.extensions = [extension('custom')];
    let complete!: (bytes: Uint8Array) => void;
    mocks.readFile.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const { readLanguageComments } = await import('./LanguageComments');
    vi.useFakeTimers();
    const expired = readLanguageComments('custom');
    await vi.advanceTimersByTimeAsync(150);
    expect(await expired).toBeUndefined();
    mocks.readFile.mockResolvedValue(metadata('{"comments":{"lineComment":"#"}}'));
    expect(await readLanguageComments('custom')).toEqual({ line: '#' });
    complete(metadata('{"comments":{"lineComment":"//"}}'));
    await Promise.resolve();
    expect(await readLanguageComments('custom')).toEqual({ line: '#' });
    expect(mocks.readFile).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

});
