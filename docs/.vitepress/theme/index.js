// §2026-06-06 — 自定义 theme:扩展默认 theme,通过 doc-before slot 在每页内容
//   顶部注入 <BugStatusFilter>。组件只在 known-issues 页激活(其它页渲染空),
//   客户端扫描页面里的 BUG 区块按「状态」emoji 显隐 → 实现状态筛选。
//   走 Layout slot 而非在 markdown 里嵌组件标签,是因为 config 里 markdown.html=false
//   (技术文档含裸 <...>),嵌的组件标签会被转义成文本。
import DefaultTheme from 'vitepress/theme';
import { h } from 'vue';
import BugStatusFilter from './BugStatusFilter.vue';

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'doc-before': () => h(BugStatusFilter),
    });
  },
};
