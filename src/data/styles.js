// §2026-05-25 fei v3 — 全面收敛到 9 个核心风格 + 1 自定义入口。
//
// 设计原则:
//   - 3 大方向 × 各 3 = 9 个 production-ready 风格,覆盖绝大多数用户场景。
//   - 用户自定义入口 (id='custom'):用户输入自己的风格提示词,
//     直接拼接到 GPT-image-2 prompt 里。
//
// Prompt 写法 (延续 v2 风格):
//   ✓ 具体的光线词汇 (Rembrandt / volumetric / golden-hour / chiaroscuro)
//   ✓ 具体的镜头/构图 (anamorphic 2.39:1 / handheld / hero framing)
//   ✓ 具体的渲染媒介 (cel-shaded / ink-wash / subsurface scattering)
//   ✓ 文化参照 (Ghibli / Spider-Verse / Final Fantasy / Pixar / Nolan)
//   ✗ 不堆叠 8K / masterpiece / ultra-detailed (那些 buzzword 已在 worker
//     buildStoryboardPrompt 的 qualityLock 黑名单里,GPT-image-2 不吃)
//
// 旧 id → 新 id 兼容映射 (旧 draft 里保存的 styleId 自动 fallthrough):
//   photoreal / cinematic-drama / golden-hour / noir / documentary
//     → hollywood-blockbuster (默认电影感) 或 documentary-handheld (纪实感)
//   anime-cel / ghibli-watercolor
//     → japan-anime-film
//   pixar-3d
//     → pixar-3d (id 保留,prompt 加强)
//   spider-verse / comic-book / arcane-painterly
//     → american-cartoon
//   ink-illustration / oil-painting / watercolor-dream
//     → chinese-animation (东方水墨融入) 或 custom (让用户写)
//   sci-fi-concept / fantasy-epic / dark-fantasy / cyberpunk-noir
//     → final-fantasy-3d (游戏感) 或 hollywood-blockbuster (电影感)
//   product-shot / editorial-fashion / food-photography
//     → hollywood-blockbuster (商业大片感) 或 custom

/* VIDEO_TYPE_STYLES — 用户选了 videoType 后,style 选择器优先 surface
 * 与该 genre 适配的几个风格。9 个风格里挑 6 个最合适的。
 * 当 videoType 为 null / 未匹配 → fall back to all 9 styles. */
export const VIDEO_TYPE_STYLES = {
  'trailer':     ['hollywood-blockbuster', 'final-fantasy-3d', 'japan-anime-film', 'american-cartoon', 'chinese-animation', 'cartoon-3d'],
  'mv':          ['hollywood-blockbuster', 'american-cartoon', 'japan-anime-film', 'final-fantasy-3d', 'chinese-animation', 'pixar-3d'],
  'vlog':        ['documentary-handheld', 'tv-series', 'hollywood-blockbuster', 'pixar-3d', 'cartoon-3d', 'american-cartoon'],
  'short-drama': ['tv-series', 'hollywood-blockbuster', 'documentary-handheld', 'japan-anime-film', 'chinese-animation', 'pixar-3d'],
  'art-film':    ['hollywood-blockbuster', 'japan-anime-film', 'chinese-animation', 'documentary-handheld', 'final-fantasy-3d', 'tv-series'],
  'product':     ['hollywood-blockbuster', 'tv-series', 'pixar-3d', 'cartoon-3d', 'final-fantasy-3d', 'documentary-handheld'],
};

export const STYLES = [
  // ═══════════════════════════════════════════════════════════════════
  // 一、🎬 真人 (Real / Live-action) × 3
  // ═══════════════════════════════════════════════════════════════════
  {
    id: 'hollywood-blockbuster',
    // §2026-05-27 fei — GPT-image-2 generated preview (same reference scene:
    // young woman by window, late-afternoon light). Batch ran 2026-05-27,
    // 9 styles × 1024×1024 medium, ~$0.38 total. R2: style-previews/<id>.png
    image: 'https://asset.uvera.ai/style-previews/hollywood-blockbuster.png',
    name: '好莱坞大片 · Hollywood Blockbuster',
    icon: '🎬',
    category: '真人',
    color: 'from-amber-700/30 to-stone-900/40',
    border: 'border-amber-700/30',
    description: '诺兰 / 维伦纽瓦式戏剧光,2.39:1 宽银幕,IMAX 级气场,teal-orange 调色,胶片质感。',
    feel: '史诗、宏大、戏剧',
    prompt: 'Hollywood blockbuster cinematography in the manner of Christopher Nolan and Denis Villeneuve, anamorphic 2.39:1 widescreen with IMAX-scale negative space, dramatic chiaroscuro key lighting with deep crushed shadows, 35mm Panavision film grain, premium DI color grade with teal-orange tension, anamorphic lens flares from primary key, atmospheric volumetric haze, photographic skin texture with subsurface warmth, shallow but legible depth of field',
    clothing: 'high-budget production wardrobe with hero-grade detailing, weathered tactical gear or signature character pieces with practical wear, layered fabrics with realistic weight'
  },
  {
    id: 'tv-series',
    image: 'https://asset.uvera.ai/style-previews/tv-series.png',
    name: '电视剧镜头 · Prestige TV',
    icon: '📺',
    category: '真人',
    color: 'from-blue-700/30 to-slate-800/40',
    border: 'border-blue-700/30',
    description: 'HBO / Netflix prestige 剧集质感,16:9,自然动机光,Arri Alexa 色调,亲密克制。',
    feel: '亲密、克制、真实',
    prompt: 'Prestige TV cinematography (HBO / Netflix premium drama), 16:9 frame with controlled handheld energy, naturalistic key-and-fill lighting motivated by practical sources (lamps, windows, phone screens), soft Arri Alexa color science with desaturated mids, intimate close-up framing, light Kodak 250D film emulation, restrained camera moves, character-first composition that reads as documentary realism',
    clothing: 'contemporary realistic wardrobe with authentic styling, mid-range fabric textures, lived-in character details that reveal psychology, costume choices appropriate to character economic class and emotional state'
  },
  {
    id: 'documentary-handheld',
    image: 'https://asset.uvera.ai/style-previews/documentary-handheld.png',
    name: '纪录片 / 手机拍摄 · Documentary Handheld',
    icon: '📱',
    category: '真人',
    color: 'from-zinc-500/30 to-stone-700/30',
    border: 'border-zinc-500/30',
    description: '手持纪实感,智能手机镜头视角,可用光,自动白平衡,真实生活质感。',
    feel: '真实、即兴、生活',
    prompt: 'Handheld documentary cinematography or smartphone-camera vibe, slight wide-angle lens distortion at edges, natural available light only (no professional rigging), authentic skin tones with mild auto-white-balance shift, casual eye-level framing, occasional unstabilized camera shake, cinéma vérité / vlog / news-reportage energy, real-environment depth-of-field (mostly deep)',
    clothing: 'everyday casual wear with no costume design, real fabrics with natural creases and wrinkles, jeans / t-shirts / sneakers / hoodies, hair and makeup untouched by stylists, age-appropriate ordinary clothing'
  },

  // ═══════════════════════════════════════════════════════════════════
  // 二、🎨 动漫 (Anime) × 3
  // ═══════════════════════════════════════════════════════════════════
  {
    id: 'japan-anime-film',
    image: 'https://asset.uvera.ai/style-previews/japan-anime-film.png',
    name: '日本动漫电影 · Japanese Anime Film',
    icon: '🌸',
    category: '动漫',
    color: 'from-pink-400/30 to-sky-400/30',
    border: 'border-pink-400/40',
    description: '宫崎骏 / 新海诚水彩背景,赛璐珞角色,体积光,天空丰富,治愈感色调。',
    feel: '诗意、治愈、空灵',
    prompt: 'Japanese cinematic anime in the tradition of Studio Ghibli and Makoto Shinkai, hand-painted watercolor backgrounds with brush-stroke depth, cel-shaded characters with confident black brush outlines, soft volumetric god rays piercing foliage, sky-heavy compositions with painted cloud volumes and atmospheric gradient, melancholic-yet-hopeful color palette (dawn pastels, warm interior amber light, deep night blues), 2D animation rendering throughout',
    clothing: 'anime-stylized wardrobe with simple but distinctive silhouettes, school sailor uniforms or fantasy travel cloaks or modern casual with cleanly-rendered fabric folds, simplified but expressive design'
  },
  {
    id: 'american-cartoon',
    image: 'https://asset.uvera.ai/style-previews/american-cartoon.png',
    name: '美式动漫 · American Animation',
    icon: '💥',
    category: '动漫',
    color: 'from-red-500/30 to-blue-600/30',
    border: 'border-red-500/40',
    description: 'Marvel / Spider-Verse 动画感,夸张比例,粗黑线条 + 平涂,网点纹理,饱和原色。',
    feel: '动感、张扬、漫画',
    prompt: 'American animation style in the manner of Spider-Verse and modern Marvel / DC animated series, bold flat-color cel shading with confident thick black outlines, dynamic exaggerated character proportions, halftone dot patterns layered over color blocks for comic-print texture, comic-book panel framing with motion-line emphasis, saturated primary palette (Kirby red / blue / yellow), action-pose compositions with kinetic energy lines',
    clothing: 'comic-book hero or stylized contemporary with bold solid color blocks and high-contrast trim, simplified geometric shapes that read at any scale, capes / jackets / battle suits with clean silhouettes'
  },
  {
    id: 'chinese-animation',
    image: 'https://asset.uvera.ai/style-previews/chinese-animation.png',
    name: '中国动漫 · Chinese Animation',
    icon: '🐉',
    category: '动漫',
    color: 'from-red-700/30 to-amber-600/30',
    border: 'border-red-700/40',
    description: '哪吒 / 白蛇 / 大鱼海棠风格,水墨背景,玉与朱砂色调,飘逸丝绸,东方意境。',
    feel: '飘逸、东方、磅礴',
    prompt: 'Chinese animation aesthetic in the tradition of Nezha, White Snake, and Big Fish & Begonia, ink-wash background painting with soft gradient mountain ranges and mist, jade-green and vermilion-red color palette with gold accents, flowing silk physics on character costumes with painterly fabric volumes, ornate embroidery and jewelry detail, traditional Chinese architecture (sloped roofs, lanterns, courtyards) as environmental anchors, wuxia / xianxia cinematic camera energy, 2D/3D hybrid rendering with painterly post-process',
    clothing: 'hanfu / qipao / wuxia robes with embroidered floral or dragon patterns, flowing silk fabric with visible weave texture, period-accurate Chinese costume design layered for movement (inner robe + outer wrap + waist sash), jade ornaments and tassels'
  },

  // ═══════════════════════════════════════════════════════════════════
  // 三、🎮 3D × 3
  // ═══════════════════════════════════════════════════════════════════
  {
    id: 'pixar-3d',
    image: 'https://asset.uvera.ai/style-previews/pixar-3d.png',
    name: '皮克斯 3D · Pixar',
    icon: '🧸',
    category: '3D',
    color: 'from-orange-400/30 to-amber-500/30',
    border: 'border-orange-400/40',
    description: 'Pixar / Disney RenderMan 质感,夸大表情,大眼角色,SSS 皮肤,温暖电影级布光。',
    feel: '温馨、亲和、童趣',
    prompt: 'Pixar / Disney 3D animation style with RenderMan-quality rendering, accurate subsurface scattering on skin and translucent materials, stylized character proportions with large expressive eyes and oversized hands, soft global illumination, warm cinematic key light with bounce fill, hero-quality material shading (cloth weave, leather grain, polished plastic), broad family-friendly appeal, whimsical character silhouette design',
    clothing: 'stylized 3D-animation wardrobe with simplified but recognizable silhouettes, soft cloth simulation with realistic gravity, character-defining color blocking, exaggerated accessory shapes (oversized buttons, chunky boots, fluffy collars)'
  },
  {
    id: 'final-fantasy-3d',
    image: 'https://asset.uvera.ai/style-previews/final-fantasy-3d.png',
    name: '美型游戏 · Final Fantasy / Genshin',
    icon: '⚔️',
    category: '3D',
    color: 'from-violet-600/30 to-indigo-700/30',
    border: 'border-violet-600/40',
    description: 'Final Fantasy / 原神 AAA 游戏 CG 感,美型角色设计,精致武器铠甲,魔法 VFX。',
    feel: '美型、华丽、奇幻',
    prompt: 'Final Fantasy / Genshin Impact AAA game cinematic style, hyper-detailed bishōnen / bishōjo character design with anime-influenced features rendered in 3D, polished physically-based rendering, ornate weapons and armor with intricate metalwork (filigree, embossed patterns, glowing runes), magical VFX (particle trails, glowing eyes, summoning circles), dramatic Square Enix-style framing with low-angle hero shots, painterly skin shaders blending realism and stylization',
    clothing: 'ornate fantasy game armor / mage robes / haute couture battle outfits with belt-and-buckle detail, glowing rune accents on fabric edges, designer-fashion silhouettes adapted to fantasy (asymmetric coats, oversized sleeves, layered chiffon)'
  },
  {
    id: 'cartoon-3d',
    image: 'https://asset.uvera.ai/style-previews/cartoon-3d.png',
    name: '3D 卡通 · 3D Cartoon',
    icon: '🎈',
    category: '3D',
    color: 'from-yellow-400/30 to-pink-400/30',
    border: 'border-yellow-400/40',
    description: 'DreamWorks / Sony 动画风,弹性夸张比例,塑料感高光,饱和原色,搞笑姿态。',
    feel: '搞笑、活泼、夸张',
    prompt: '3D cartoon style in the manner of DreamWorks (Trolls / Boss Baby) and Sony Pictures Animation (Hotel Transylvania), exaggerated stretchy proportions with squash-and-stretch poses, plastic-like surface highlights with strong specular, vibrant saturated primary colors, comedic acting beats frozen in pose, simplified facial features with oversized eyes and elastic mouths, family-friendly aesthetic balancing Pixar realism and full-anime stylization',
    clothing: 'cartoon-stylized everyday wear with blocky simplified shapes, single dominant colors per garment with one accent piece, exaggerated accessory silhouettes (huge bow, chunky sneakers, oversized hat)'
  },

  // ═══════════════════════════════════════════════════════════════════
  // 四、✏️ 自定义 (Custom user input)
  //
  //   When user picks this card, UI opens a textarea where they enter
  //   their own style prompt verbatim. StoryGeneratorPage threads it
  //   through as customStylePrompt → backend uses it as style.prompt.
  //   The `prompt` field below is a fallback for callers that don't
  //   know about customStylePrompt (legacy / robustness).
  // ═══════════════════════════════════════════════════════════════════
  {
    id: 'custom',
    image: null,
    name: '自定义风格 · Custom',
    icon: '✏️',
    category: '自定义',
    color: 'from-accent/20 to-violet-500/20',
    border: 'border-accent/40',
    description: '输入你自己的风格描述。可参照上面的写法:具体光线 + 镜头 + 渲染媒介 + 文化参照。',
    feel: '完全由你定义',
    prompt: 'User-defined visual style — see customStylePrompt passed alongside this option for the actual style description',
    clothing: 'wardrobe consistent with the user-defined style described above'
  },
];
