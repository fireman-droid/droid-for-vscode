import { readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Version-specific repairs for npm tarballs that omit upstream license files.
const supplementalLicenses = {
  'react-remove-scroll-bar@2.3.8': 'react-remove-scroll-bar.txt',
  'remark-math@6.0.0': 'remark-math.txt',
  'rehype-katex@7.0.1': 'remark-math.txt',
};

/** Collect packages contributing bytes, not the entire installed dependency tree. */
export function createThirdPartyNotices(baseDirectory, adaptedNoticePath) {
  const directories = new Set();
  async function owner(file) {
    let directory = path.dirname(file);
    while (directory !== path.dirname(directory)) {
      try {
        const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
        if (manifest.name) return directory;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      directory = path.dirname(directory);
    }
    throw new Error(`Cannot locate bundled package: ${file}`);
  }
  return {
    // CSS preprocessors erase their source paths before esbuild sees them.
    async addPreprocessedPackage(directory) {
      directories.add(await realpath(directory));
    },
    async add(metafile) {
      for (const output of Object.values(metafile.outputs)) {
        for (const [input, contribution] of Object.entries(output.inputs)) {
          if (contribution.bytesInOutput === 0 || !input.replaceAll('\\', '/').includes('node_modules/')) continue;
          directories.add(await owner(await realpath(path.resolve(baseDirectory, input))));
        }
      }
    },
    async write(destination) {
      const notices = new Map();
      const missing = [];
      for (const directory of directories) {
        const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
        const name = `${manifest.name}@${manifest.version}`;
        const files = (await readdir(directory, { withFileTypes: true }))
          .filter((file) => file.isFile() && /^(?:licen[sc]e|copying|notice|copyright)(?:[.-]|$)/i.test(file.name))
          .map((file) => file.name).sort();
        const texts = await Promise.all(files.map(async (file) =>
          `${file}\n${(await readFile(path.join(directory, file), 'utf8')).trim()}`));
        if (!files.some((file) => /^(?:licen[sc]e|copying)(?:[.-]|$)/i.test(file))) {
          const supplement = supplementalLicenses[name];
          if (!supplement || manifest.license !== 'MIT') {
            missing.push(name);
            continue;
          }
          texts.push(await readFile(new URL(`../licenses/${supplement}`, import.meta.url), 'utf8'));
        }
        notices.set(name,
          `${name}\nDeclared license: ${typeof manifest.license === 'string' ? manifest.license : 'see documents'}\n\n${texts.join('\n\n')}`);
      }
      if (missing.length) throw new Error(`Bundled dependencies need license documents: ${missing.join(', ')}`);
      const adapted = adaptedNoticePath ? await readFile(adaptedNoticePath, 'utf8') : '';
      const dependencies = [...notices].sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text);
      await writeFile(destination, `${adapted.trim()}\n\n${dependencies.join('\n\n' + '='.repeat(72) + '\n\n')}\n`, 'utf8');
      console.log(`Third-party notices: ${directories.size} bundled packages -> ${path.relative(baseDirectory, destination)}`);
    },
  };
}
