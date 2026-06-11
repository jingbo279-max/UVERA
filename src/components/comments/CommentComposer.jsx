/**
 * §2026-06-10 — CommentComposer:评论/回复共用输入框。
 *
 * textarea + Emoji picker + @ 提及自动补全 + Send/Cancel。
 * 三处 composer 复用(desktop 底栏 / desktop 回复 / mobile sheet)。
 *
 * - Emoji:点 😊 弹 picker,插入光标处。
 * - @ 提及:输入 "@" + 前缀 → 弹用户下拉(searchUsers 查 profiles)→ 选中后
 *   把 "@前缀" 替换成 "@username ",并记入 mentions(结构化 {username,userId})。
 *   提交时连同 body 一起回传;commentService 只保留正文里仍存在的 @username。
 * - 提交:onSubmit(body, mentions);成功后清空。Enter 不发送(多行);
 *   当 @ 下拉打开时 Enter 选中高亮项。
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Smiley, At, CircleNotch } from '@phosphor-icons/react';
import { searchUsers } from '../../api/commentService';
import EmojiPicker from './EmojiPicker';

export default function CommentComposer({
  placeholder = 'Say something...',
  autoFocus = false,
  busy = false,
  compact = false,
  submitLabel = 'Send',
  onSubmit,
  onCancel,
}) {
  const [value, setValue] = useState('');
  const [mentions, setMentions] = useState([]);       // [{username, userId}]
  const [emojiOpen, setEmojiOpen] = useState(false);

  // @ 自动补全
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionResults, setMentionResults] = useState([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const anchorRef = useRef(null);   // 当前 @ 在 value 中的索引
  const searchTimer = useRef(null);

  const taRef = useRef(null);
  const wrapRef = useRef(null);

  // 外点关闭 emoji + mention 浮层
  useEffect(() => {
    if (!emojiOpen && !mentionOpen) return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setEmojiOpen(false);
        setMentionOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [emojiOpen, mentionOpen]);

  const setCaret = (pos) => {
    setTimeout(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    }, 0);
  };

  const insertAtCursor = (text) => {
    const ta = taRef.current;
    const start = ta?.selectionStart ?? value.length;
    const end = ta?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    setValue(next);
    setCaret(start + text.length);
  };

  // 检测光标前的 "@token",决定是否开提及下拉
  const detectMention = useCallback((val, caret) => {
    const before = val.slice(0, caret);
    const m = before.match(/(^|\s)@([^\s@]{0,30})$/);
    if (m) {
      const token = m[2];
      anchorRef.current = caret - token.length - 1; // '@' 的位置
      setMentionOpen(true);
      setActiveIdx(0);
      if (searchTimer.current) clearTimeout(searchTimer.current);
      if (token.length === 0) { setMentionResults([]); setMentionLoading(false); return; }
      setMentionLoading(true);
      searchTimer.current = setTimeout(async () => {
        const users = await searchUsers(token);
        setMentionResults(users);
        setMentionLoading(false);
      }, 180);
    } else {
      setMentionOpen(false);
      setMentionResults([]);
    }
  }, []);

  const onChange = (e) => {
    setEmojiOpen(false);   // 打字时收起 emoji picker(避免与 @ 下拉叠加)
    setValue(e.target.value);
    detectMention(e.target.value, e.target.selectionStart);
  };

  const pickMention = (user) => {
    const ta = taRef.current;
    const caret = ta?.selectionStart ?? value.length;
    const atPos = anchorRef.current ?? value.lastIndexOf('@');
    const insert = `@${user.username} `;
    const next = value.slice(0, atPos) + insert + value.slice(caret);
    setValue(next);
    setMentions((prev) =>
      prev.some((x) => x.userId === user.id)
        ? prev
        : [...prev, { username: user.username, userId: user.id }]);
    setMentionOpen(false);
    setMentionResults([]);
    setCaret(atPos + insert.length);
  };

  const triggerAt = () => {
    insertAtCursor('@');
    // 插入后等 value 更新再 detect
    setTimeout(() => {
      const ta = taRef.current;
      if (ta) detectMention(ta.value, ta.selectionStart);
    }, 0);
  };

  const onKeyDown = (e) => {
    if (mentionOpen && mentionResults.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => (i + 1) % mentionResults.length); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx((i) => (i - 1 + mentionResults.length) % mentionResults.length); return; }
      if (e.key === 'Enter')     { e.preventDefault(); pickMention(mentionResults[activeIdx]); return; }
      if (e.key === 'Escape')    { e.preventDefault(); setMentionOpen(false); return; }
    }
  };

  const reset = () => { setValue(''); setMentions([]); setEmojiOpen(false); setMentionOpen(false); };

  const submit = async () => {
    const body = value.trim();
    if (!body || busy) return;
    try {
      await onSubmit?.(body, mentions);
      reset();
    } catch (err) {
      console.error('[CommentComposer] submit failed:', err);
    }
  };

  const rows = compact ? 2 : 3;

  return (
    <div ref={wrapRef} className="relative flex flex-col gap-2">
      {/* @ 提及下拉(浮在 textarea 上方) */}
      {mentionOpen && (mentionLoading || mentionResults.length > 0) && (
        <div className="absolute left-0 bottom-full mb-2 z-20 w-64 material-thick rounded-xl border border-white/10 shadow-xl overflow-hidden">
          {mentionLoading && mentionResults.length === 0 ? (
            <div className="px-3 py-3 flex items-center justify-center text-vision-tertiary">
              <CircleNotch size={16} className="animate-spin" />
            </div>
          ) : (
            <div className="max-h-[200px] overflow-y-auto py-1">
              {mentionResults.map((u, i) => (
                <button
                  key={u.id}
                  type="button"
                  onMouseDown={(ev) => { ev.preventDefault(); pickMention(u); }}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left cursor-pointer transition-colors ${
                    i === activeIdx ? 'bg-accent/15' : 'hover:bg-white/10'
                  }`}
                >
                  {u.avatarUrl
                    ? <img src={u.avatarUrl} alt="" className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
                    : <span className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-semibold text-white"
                            style={{ background: 'linear-gradient(135deg,#5B53FF,#8E86FF)' }}>
                        {(u.username || '?').charAt(0).toUpperCase()}
                      </span>}
                  <span className="text-sm text-vision-primary truncate">@{u.username}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Emoji picker(浮在工具栏上方) */}
      {emojiOpen && (
        <div className="absolute left-0 bottom-full mb-2 z-20">
          <EmojiPicker onPick={(e) => insertAtCursor(e)} />
        </div>
      )}

      <textarea
        ref={taRef}
        autoFocus={autoFocus}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        rows={rows}
        className="surface-sunken w-full rounded-2xl px-4 py-2.5 text-sm text-vision-primary placeholder:text-vision-tertiary resize-none focus:outline-none transition-colors"
        style={{ minHeight: compact ? 56 : 80 }}
      />

      <div className="flex items-center justify-between gap-2">
        {/* 左:emoji + @ */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => { setEmojiOpen((v) => !v); setMentionOpen(false); }}
            className="w-8 h-8 flex items-center justify-center rounded-full text-vision-secondary hover:text-vision-primary hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="Insert emoji"
          >
            <Smiley size={20} weight="regular" />
          </button>
          <button
            type="button"
            onClick={triggerAt}
            className="w-8 h-8 flex items-center justify-center rounded-full text-vision-secondary hover:text-vision-primary hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="Mention someone"
          >
            <At size={20} weight="regular" />
          </button>
        </div>
        {/* 右:Cancel + Send */}
        <div className="flex items-center gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={() => { reset(); onCancel(); }}
              className="px-4 h-8 rounded-full text-vision-secondary text-xs font-medium hover:text-vision-primary transition-colors cursor-pointer"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!value.trim() || busy}
            className="px-4 h-8 rounded-full bg-accent hover:bg-accent/90 text-white text-xs font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? `${submitLabel}…` : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
