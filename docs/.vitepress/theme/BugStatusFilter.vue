<script setup>
// §2026-06-06 — known-issues 状态筛选器。仅在 known-issues 页激活;客户端扫描
//   .vp-doc 里所有 `## BUG-*` 区块,从「状态」行的首个 emoji 判定类别,渲染筛选
//   chips,点选时直接显隐对应区块的 DOM 节点(不动 markdown 源,兼容 html:false)。
import { ref, onMounted, watch, nextTick } from 'vue';
import { useRoute } from 'vitepress';

const route = useRoute();
const active = ref(false);
const filter = ref('all');
const counts = ref({ all: 0, '🔴': 0, '🟡': 0, '✅': 0, '⚪': 0 });
let sections = [];

const CATS = [
  { key: 'all', label: '全部' },
  { key: '🔴', label: '未解决' },
  { key: '🟡', label: '进行中' },
  { key: '✅', label: '已解决' },
  { key: '⚪', label: '观察' },
];

const isKnownIssues = () => /known-issues/.test(route.path);

// 收集**每个** h2 区块(heading + 其后到下一个 h2 之前的所有兄弟节点)。
//   `## BUG-*` 标记 isBug + 从「状态」行首个 emoji 判类别;其余(Sentry triage /
//   清查记录 / 需费配合 等说明性区块)isBug=false,无状态。
function collect() {
  const doc = document.querySelector('.vp-doc');
  if (!doc) return [];
  return [...doc.querySelectorAll('h2')].map((h2) => {
    const nodes = [h2];
    let el = h2.nextElementSibling;
    while (el && el.tagName !== 'H2') {
      nodes.push(el);
      el = el.nextElementSibling;
    }
    const isBug = /^bug-/i.test(h2.id || '');
    let emoji = null;
    if (isBug) {
      const text = nodes.map((n) => n.textContent || '').join(' ');
      const m = text.match(/状态[\s\S]{0,40}?(✅|\u{1F534}|\u{1F7E1}|⚪)/u);
      emoji = m ? m[1] : '🟡';
    }
    return { nodes, isBug, emoji };
  });
}

// 「全部」显示所有区块;选具体状态时**只显示匹配的 BUG**,非 BUG 区块(无状态)
//   一并隐藏 —— 否则它们会在每个状态下都常驻,看起来"同属多个状态"。
function applyFilter() {
  for (const s of sections) {
    const show = filter.value === 'all' ? true : s.isBug && s.emoji === filter.value;
    for (const n of s.nodes) n.style.display = show ? '' : 'none';
  }
}

function recompute() {
  sections = collect();
  const bugs = sections.filter((s) => s.isBug);
  const c = { all: bugs.length, '🔴': 0, '🟡': 0, '✅': 0, '⚪': 0 };
  for (const s of bugs) c[s.emoji] = (c[s.emoji] || 0) + 1;
  counts.value = c;
}

function init() {
  active.value = isKnownIssues();
  if (!active.value) return;
  nextTick(() => { recompute(); applyFilter(); });
}

onMounted(init);

watch(() => route.path, () => {
  // 离开页面前复位之前隐藏的节点,避免回来时残留 display:none
  for (const s of sections) for (const n of s.nodes) n.style.display = '';
  sections = [];
  filter.value = 'all';
  init();
});

watch(filter, applyFilter);
</script>

<template>
  <div v-if="active" class="bug-filter">
    <span class="bug-filter__label">按状态筛选</span>
    <button
      v-for="c in CATS"
      :key="c.key"
      type="button"
      :class="['bug-filter__chip', { 'is-active': filter === c.key }]"
      @click="filter = c.key"
    >
      <span v-if="c.key !== 'all'" class="bug-filter__emoji">{{ c.key }}</span>
      {{ c.label }}
      <span class="bug-filter__count">{{ counts[c.key] ?? 0 }}</span>
    </button>
  </div>
</template>

<style scoped>
.bug-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0 0 28px;
  padding: 12px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
}
.bug-filter__label {
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  margin-right: 2px;
}
.bug-filter__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  line-height: 1;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.bug-filter__chip:hover {
  border-color: var(--vp-c-brand-1);
}
.bug-filter__chip.is-active {
  background: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
  color: #fff;
}
.bug-filter__emoji {
  font-size: 12px;
}
.bug-filter__count {
  font-size: 11px;
  opacity: 0.65;
  font-variant-numeric: tabular-nums;
}
.bug-filter__chip.is-active .bug-filter__count {
  opacity: 0.9;
}
</style>
