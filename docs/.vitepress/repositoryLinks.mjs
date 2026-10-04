import path from 'node:path';

const excluded = new Set(['PLAN.md', 'STATUS.md', 'DESIGN.md', 'FEEDBACK.md', 'OPEN_SOURCE_POST.md', 'RUNTIME_CORRECTNESS_REVIEW.md']);

// Keep one Markdown source readable both on GitHub and in the documentation site.
// Source files and maintainer-only pages retain their repository destinations.
export function repositoryLinks(md, repository) {
  md.core.ruler.after('inline', 'droid-repository-links', (state) => {
    for (const token of state.tokens) {
      for (const child of token.children ?? []) {
        if (child.type !== 'link_open') continue;
        const href = child.attrGet('href');
        if (!href || /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(href)) continue;
        const [file, ...hash] = href.split('#');
        const current = state.env.relativePath ?? 'README.md';
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(current), file));
        const fragment = hash.length ? `#${hash.join('#')}` : '';
        if (target === 'README.md') child.attrSet('href', `./index.md${fragment}`);
        else if (target.startsWith('../') || excluded.has(target)) {
          const repositoryPath = path.posix.normalize(path.posix.join('docs', target));
          child.attrSet('href', `${repository}/blob/main/${repositoryPath}${fragment}`);
        }
      }
    }
  });
}
