import { Atom, Braces, Code, FileCode2, FileText, Hash } from 'lucide-react';

export function ChangeFileIcon({ path }: { readonly path: string }) {
  const extension = path.split(/[\\/]/u).pop()?.split('.').pop()?.toLowerCase();
  const react = extension !== undefined && ['tsx', 'jsx'].includes(extension);
  const script = extension !== undefined && ['js', 'mjs', 'cjs'].includes(extension);
  const style = extension !== undefined && ['css', 'scss', 'sass', 'less'].includes(extension);
  const data = extension !== undefined && ['json', 'jsonc', 'yaml', 'yml', 'toml'].includes(extension);
  const markup = extension !== undefined && ['html', 'htm', 'xml', 'svg', 'vue', 'svelte'].includes(extension);
  const prose = extension !== undefined && ['md', 'mdx', 'txt'].includes(extension);
  const Icon = react ? Atom : style ? Hash : data ? Braces : markup ? Code : prose ? FileText : FileCode2;
  const tone = react ? 'react' : script ? 'script' : style ? 'style' : data ? 'data' : markup ? 'markup' : prose ? 'text' : 'code';
  return <Icon className="dvx-change-file-icon" data-file-tone={tone} aria-hidden="true" />;
}
