import path from 'node:path';
import { defineConfig } from 'vitepress';
import { repositoryLinks } from './repositoryLinks.mjs';

const repository = 'https://github.com/fireman-droid/droid-for-vscode';

export default defineConfig({
  title: 'Droid',
  titleTemplate: ':title · Droid 文档',
  description: 'Droid 使用指南与开发文档：在 VS Code / Cursor 中聊天、审阅改动和补全代码。',
  lang: 'zh-CN',
  base: '/droid-for-vscode/',
  rewrites: { 'README.md': 'index.md' },
  srcExclude: ['PLAN.md', 'STATUS.md', 'DESIGN.md', 'FEEDBACK.md', 'OPEN_SOURCE_POST.md', 'RUNTIME_CORRECTNESS_REVIEW.md'],
  lastUpdated: true,
  head: [
    ['meta', { name: 'theme-color', content: '#202229' }],
  ],
  themeConfig: {
    logo: { src: '/droid.svg', alt: 'Droid 风车标识' },
    siteTitle: 'Droid 文档',
    nav: [
      { text: '使用指南', link: '/GETTING_STARTED' },
      { text: '开发文档', link: '/DEVELOPMENT' },
      { text: '下载', link: `${repository}/releases/latest` },
    ],
    sidebar: [
      { text: '开始', items: [
        { text: '文档首页', link: '/' },
        { text: '安装与第一次对话', link: '/GETTING_STARTED' },
      ] },
      { text: '使用 Droid', items: [
        { text: '聊天与 BTW 旁问', link: '/CHAT' },
        { text: '模型与服务渠道', link: '/MODELS' },
        { text: '审阅文件改动', link: '/REVIEW' },
        { text: '代码补全与 Next Edit', link: '/AUTOCOMPLETE' },
        { text: '子代理与 Mission', link: '/MISSIONS' },
        { text: '排障与诊断', link: '/TROUBLESHOOTING' },
        { text: '反馈问题', link: `${repository}/issues` },
      ] },
      { text: '参与开发', items: [
        { text: '开发与发布', link: '/DEVELOPMENT' },
        { text: '架构与代码导航', link: '/ARCHITECTURE' },
        { text: '能力与支持范围', link: '/CAPABILITIES' },
        { text: '贡献规则', link: `${repository}/blob/main/AGENTS.md` },
      ] },
    ],
    search: {
      provider: 'local',
      options: {
        miniSearch: {
          options: {
            tokenize: (text) => Array.from(new Intl.Segmenter('zh-CN', { granularity: 'word' }).segment(text))
              .filter((part) => part.isWordLike).map((part) => part.segment),
          },
        },
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            displayDetails: '显示详细结果', resetButtonTitle: '清除搜索', backButtonTitle: '关闭搜索',
            noResultsText: '没有找到相关内容',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
          },
        },
      },
    },
    outline: { label: '本页目录', level: [2, 3] },
    docFooter: { prev: '上一篇', next: '下一篇' },
    lastUpdated: { text: '最后更新', formatOptions: { dateStyle: 'medium' } },
    editLink: { pattern: `${repository}/edit/main/docs/:path`, text: '在 GitHub 编辑此页' },
    socialLinks: [{ icon: 'github', link: repository }],
    darkModeSwitchLabel: '主题', lightModeSwitchTitle: '切换到浅色', darkModeSwitchTitle: '切换到深色',
    sidebarMenuLabel: '导航', returnToTopLabel: '回到顶部', skipToContentLabel: '跳到正文',
    footer: {
      message: `社区维护的非官方 Factory Droid CLI 扩展 · <a href="${repository}/blob/main/LICENSE">MIT 许可</a>`,
      copyright: 'Factory 名称与风车标识归各自权利人所有。',
    },
  },
  markdown: {
    config(md) {
      repositoryLinks(md, repository);
      const fence = md.renderer.rules.fence;
      md.renderer.rules.fence = (tokens, index, options, env, self) => {
        const token = tokens[index];
        if (token.info.trim() !== 'mermaid') return fence(tokens, index, options, env, self);
        return `<MermaidDiagram code="${md.utils.escapeHtml(token.content)}" />`;
      };
    },
  },
  vite: { publicDir: path.resolve(import.meta.dirname, 'public') },
});
