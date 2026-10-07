import { bundledLanguages, type BundledLanguage } from 'shiki/langs';

// Shiki owns the grammar and alias catalog. Only file names/extensions that
// are not language aliases are adapted here; no keyword-based guessing.
const filenames: Readonly<Record<string, string>> = {
  dockerfile: 'dockerfile', containerfile: 'dockerfile', makefile: 'make', gnumakefile: 'make',
  'cmakelists.txt': 'cmake', gemfile: 'ruby', rakefile: 'ruby', justfile: 'just',
  '.gitignore': 'gitignore', '.gitattributes': 'git-attributes', '.bashrc': 'bash',
  '.bash_profile': 'bash', '.zshrc': 'shellscript', '.env': 'dotenv',
};
const extensions: Readonly<Record<string, string>> = {
  h: 'c', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp', cs: 'csharp',
  m: 'objective-c', mm: 'objective-cpp', rs: 'rust', rb: 'ruby', pyw: 'python',
  ps1: 'powershell', psm1: 'powershell', psd1: 'powershell', kt: 'kotlin', kts: 'kotlin',
  sh: 'shellscript', bash: 'bash', zsh: 'shellscript', yml: 'yaml', htm: 'html',
  cjs: 'javascript', mjs: 'javascript', mts: 'typescript', cts: 'typescript',
  tf: 'terraform', tfvars: 'terraform', frag: 'glsl', vert: 'glsl', geom: 'glsl',
  comp: 'glsl', fs: 'fsharp', fsx: 'fsharp', bat: 'bat', cmd: 'bat',
};
const aliases: Readonly<Record<string, string>> = {
  'c#': 'csharp', 'c++': 'cpp', shell: 'shellscript', zsh: 'shellscript',
};
function known(name: string): BundledLanguage | undefined {
  const key = aliases[name.toLowerCase()] ?? name.toLowerCase();
  return Object.hasOwn(bundledLanguages, key) ? key as BundledLanguage : undefined;
}
export function syntaxLanguage(language?: string | null, path?: string, source = ''): BundledLanguage | undefined {
  if (language?.trim()) return known(language.trim());
  const file = path?.split(/[\\/]/).at(-1)?.toLowerCase() ?? '';
  const named = filenames[file] ?? (file.startsWith('.env.') ? 'dotenv' :
    /^(dockerfile|containerfile)\./.test(file) ? 'dockerfile' : undefined);
  if (named) return known(named);
  const extension = file.split('.').slice(1).at(-1);
  const fromPath = extension && known(extensions[extension] ?? extension);
  if (fromPath) return fromPath;
  const interpreter = /^#![^\n]*\b(python[\d.]*|node|ruby|bash|sh|zsh|perl|pwsh)\b/.exec(source)?.[1];
  return interpreter ? known(interpreter.startsWith('python') ? 'python' :
    ({ node: 'javascript', sh: 'shellscript', pwsh: 'powershell' } as Record<string, string>)[interpreter] ?? interpreter) : undefined;
}
