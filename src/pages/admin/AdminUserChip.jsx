import React, { useState, useEffect } from 'react';
import { Copy, Check, ArrowSquareOut } from '@phosphor-icons/react';
import { supabase } from '../../api/supabaseClient';

/**
 * AdminUserChip — 统一的「创建者 / 用户」展示单元(2026-06-10 甲方需求)
 *
 * 背景:admin 各处过去把 user uuid 截断成 "User: 21b2…" 字符串,既看不到
 * Display Name,也没法 copy 完整 id / 跳用户主页。本组件一处解决三件事:
 *   1. 显示 Display Name(profiles.username),无 profile 时 fallback 到 id 前缀
 *   2. copy 完整 user id 到剪贴板(带 ✓ 反馈)
 *   3. 点名字 / 外链图标 → 新标签打开 /u/:userId 用户主页(保留 admin 上下文)
 *
 * Display Name 解析:caller 能传 `displayName` 就直接用(零查询);传不了时
 * 组件用 module-level 缓存按需查 profiles(同 id 去重,跨 chip 共享)。
 *
 * variant:
 *   'full'    — avatar? + 名字(链到主页) + copy 按钮(Works 创建者列等)
 *   'actions' — 仅 copy + 外链两个图标,不渲染名字(Users 列表已自带名字)
 */

// userId -> username|null(已解析);跨组件实例共享,避免重复查询
const _nameCache = new Map();
const _inflight = new Map();

async function resolveUsername(userId) {
  if (_nameCache.has(userId)) return _nameCache.get(userId);
  if (_inflight.has(userId)) return _inflight.get(userId);
  const p = (async () => {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', userId)
        .maybeSingle();
      const name = data?.username || null;
      _nameCache.set(userId, name);
      return name;
    } catch {
      _nameCache.set(userId, null);
      return null;
    } finally {
      _inflight.delete(userId);
    }
  })();
  _inflight.set(userId, p);
  return p;
}

function useUsername(userId, preloaded) {
  const [name, setName] = useState(
    preloaded ?? (userId && _nameCache.has(userId) ? _nameCache.get(userId) : null)
  );
  useEffect(() => {
    if (preloaded) { setName(preloaded); return; }
    if (!userId) { setName(null); return; }
    if (_nameCache.has(userId)) { setName(_nameCache.get(userId)); return; }
    let alive = true;
    resolveUsername(userId).then(n => { if (alive) setName(n); });
    return () => { alive = false; };
  }, [userId, preloaded]);
  return name;
}

function openProfile(userId) {
  if (userId) window.open(`/u/${userId}`, '_blank', 'noopener');
}

export function CopyIdButton({ id, size = 13, className = '' }) {
  const [copied, setCopied] = useState(false);
  if (!id) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!navigator.clipboard) return;
        navigator.clipboard.writeText(id).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className={`p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer flex-shrink-0 ${className}`}
      title={copied ? 'Copied!' : `Copy user ID: ${id}`}
    >
      {copied ? <Check size={size} className="text-emerald-400" /> : <Copy size={size} />}
    </button>
  );
}

export function OpenProfileButton({ userId, size = 13, className = '' }) {
  if (!userId) return null;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); openProfile(userId); }}
      className={`p-1 rounded text-zinc-500 hover:text-blue-300 hover:bg-zinc-800 transition-colors cursor-pointer flex-shrink-0 ${className}`}
      title="Open user profile in new tab"
    >
      <ArrowSquareOut size={size} />
    </button>
  );
}

export default function AdminUserChip({
  userId,
  displayName,
  avatarUrl,
  variant = 'full',
  className = '',
}) {
  const resolved = useUsername(userId, displayName);

  if (variant === 'actions') {
    return (
      <span className={`inline-flex items-center gap-0.5 ${className}`}>
        <CopyIdButton id={userId} />
        <OpenProfileButton userId={userId} />
      </span>
    );
  }

  const label = resolved || displayName
    || (userId ? userId.slice(0, 8) + '…' : 'Unknown');

  return (
    <span className={`inline-flex items-center gap-1.5 min-w-0 ${className}`}>
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="w-6 h-6 rounded-full bg-zinc-800 flex-shrink-0" />
      ) : null}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); openProfile(userId); }}
        disabled={!userId}
        className="text-sm text-zinc-200 hover:text-blue-300 truncate transition-colors cursor-pointer text-left disabled:cursor-default disabled:hover:text-zinc-200"
        title={userId ? `Open profile · ${userId}` : ''}
      >
        {label}
      </button>
      <CopyIdButton id={userId} />
    </span>
  );
}
