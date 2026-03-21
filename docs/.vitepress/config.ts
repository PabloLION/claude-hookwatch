import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'hookwatch',
  description:
    'Local observability for Claude Code — captures every hook event to SQLite with a live web UI',
  base: '/claude-hookwatch/',

  srcExclude: ['**/agents/**'],

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/quick-start' },
      { text: 'Reference', link: '/reference/hook-events' },
    ],

    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Quick Start', link: '/guide/quick-start' },
          { text: 'Features', link: '/guide/features' },
          { text: 'Use Cases', link: '/guide/use-cases' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Hook Events', link: '/reference/hook-events' },
          { text: 'Hook Input Schema', link: '/reference/hook-stdin-schema' },
          { text: 'Hook Output Schema', link: '/reference/hook-stdout-schema' },
          { text: 'Execution Cheat Sheet', link: '/reference/hook-execution-cheatsheet' },
          { text: 'Storage', link: '/reference/storage' },
          { text: 'Querying', link: '/reference/querying' },
        ],
      },
    ],

    socialLinks: [{ icon: 'github', link: 'https://github.com/PabloLION/claude-hookwatch' }],

    search: {
      provider: 'local',
    },

    footer: {
      message: 'Released under the MIT License.',
    },
  },
});
