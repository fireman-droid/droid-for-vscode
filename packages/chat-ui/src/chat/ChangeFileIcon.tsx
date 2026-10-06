import { Code, FileCode2, FileText, Hash } from 'lucide-react';

export function ChangeFileIcon({ path }: { readonly path: string }) {
  const extension = path.split(/[\\/]/u).pop()?.split('.').pop()?.toLowerCase();
  const style = extension !== undefined && ['css', 'scss', 'sass', 'less'].includes(extension);
  const markup = extension !== undefined && ['html', 'htm', 'xml', 'svg', 'vue', 'svelte'].includes(extension);
  const prose = extension !== undefined && ['md', 'mdx', 'txt'].includes(extension);
  const Icon = style ? Hash : markup ? Code : prose ? FileText : FileCode2;
  return <Icon className="dvx-change-file-icon" data-file-tone={style ? 'style' : prose ? 'text' : 'code'} aria-hidden="true" />;
}
