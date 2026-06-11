/**
 * §2026-06-10 — EmojiPicker:轻量 emoji 选择 popover(零依赖)。
 *
 * 一组常用 emoji 网格,点击 onPick(emoji) 插入到 composer 光标处。
 * 不引第三方库(避免 bundle 膨胀);系统输入法本就能打全量 emoji,这里只做
 * 快捷常用集。父组件负责定位 + 外点关闭。
 */

import React from 'react';

const EMOJIS = [
  '😀','😂','🤣','😊','😍','🥰','😘','😎','🤩','🥳',
  '😅','😉','🙂','😇','🤔','🤗','😴','😭','😢','😡',
  '😱','🥺','😏','😬','🙄','😜','🤪','😋','🤤','🤯',
  '👍','👎','👏','🙌','🙏','💪','👌','✌️','🤝','🫶',
  '❤️','🔥','✨','🎉','💯','⭐','🌟','💖','💔','💕',
  '👀','🎬','🎥','🍿','🎶','🎵','📌','💬','🚀','🌈',
];

export default function EmojiPicker({ onPick }) {
  return (
    <div className="material-thick rounded-2xl p-2 shadow-xl border border-white/10"
         style={{ width: 280 }}>
      <div className="grid grid-cols-8 gap-0.5 max-h-[180px] overflow-y-auto">
        {EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            onMouseDown={(ev) => { ev.preventDefault(); onPick(e); }}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-lg hover:bg-white/10 transition-colors cursor-pointer"
            aria-label={`Insert ${e}`}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
