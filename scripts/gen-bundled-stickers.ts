/**
 * Generates bundled sticker assets as 256×256 WebP files.
 *
 * We can't download open-licensed sticker art from the internet in this sandbox,
 * so we generate simple, on-brand Material-3-tonal geometric stickers server-side
 * with sharp. Each sticker is a flat-color rounded-square background with a
 * simple emoji-style shape drawn on top (using SVG → WebP via sharp).
 *
 * Three packs:
 *   - emojis: 12 reaction faces (😀 😂 😍 😎 🤔 😭 😡 😴 🤯 🥳 👀 🙏)
 *   - cats:   8 cartoon cat faces
 *   - hearts: 6 pixel-art hearts in different colors
 *
 * Run:  bun run scripts/gen-bundled-stickers.ts
 */

import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const SIZE = 256;
const ROOT = `${import.meta.dir}/../public/stickers`;

// Material 3 surface tones (from Stoat's tonal scheme)
const BG = {
  light: "#e9e7ef",
  surface: "#fef7ff",
  primary: "#5470ec",
  primaryContainer: "#dde1ff",
  secondary: "#5c5d72",
  secondaryContainer: "#e1e0f9",
  tertiary: "#705274",
  tertiaryContainer: "#fad8fd",
  error: "#ba1a1a",
  errorContainer: "#ffdad6",
  success: "#3abf7e",
  warning: "#ffb74d",
  pink: "#ec407a",
  purple: "#8e44ad",
  teal: "#14b8a6",
};

interface StickerSpec {
  /** Output filename, e.g. "smile" → "smile.webp" */
  name: string;
  /** Background color */
  bg: string;
  /** SVG body (the inner drawing, will be wrapped in 256×256 viewBox) */
  art: string;
  /** Emoji character used in the DB for this sticker */
  emoji: string;
}

const EMOJIS: StickerSpec[] = [
  // 😀 Happy
  { name: "happy", bg: BG.warning, emoji: "😀", art: `
    <circle cx="128" cy="128" r="100" fill="#FFD580"/>
    <circle cx="92" cy="108" r="9" fill="#222"/>
    <circle cx="164" cy="108" r="9" fill="#222"/>
    <path d="M 88 158 Q 128 188 168 158" stroke="#222" stroke-width="9" fill="none" stroke-linecap="round"/>
  ` },
  // 😂 Laugh
  { name: "laugh", bg: BG.warning, emoji: "😂", art: `
    <circle cx="128" cy="128" r="100" fill="#FFD580"/>
    <path d="M 76 102 Q 92 90 108 102" stroke="#222" stroke-width="7" fill="none" stroke-linecap="round"/>
    <path d="M 148 102 Q 164 90 180 102" stroke="#222" stroke-width="7" fill="none" stroke-linecap="round"/>
    <path d="M 86 158 Q 128 198 170 158 Q 128 178 86 158 Z" fill="#222"/>
    <path d="M 128 168 L 124 188 L 132 188 Z" fill="#7dd3fc"/>
  ` },
  // 😍 Heart-eyes
  { name: "heart_eyes", bg: BG.pink, emoji: "😍", art: `
    <circle cx="128" cy="128" r="100" fill="#FFD580"/>
    <path d="M 92 116 C 84 100 64 100 64 116 C 64 132 92 140 92 140 C 92 140 120 132 120 116 C 120 100 100 100 92 116 Z" fill="#ec407a"/>
    <path d="M 164 116 C 156 100 136 100 136 116 C 136 132 164 140 164 140 C 164 140 192 132 192 116 C 192 100 172 100 164 116 Z" fill="#ec407a"/>
    <path d="M 88 170 Q 128 195 168 170" stroke="#222" stroke-width="8" fill="none" stroke-linecap="round"/>
  ` },
  // 😎 Cool
  { name: "cool", bg: BG.primary, emoji: "😎", art: `
    <circle cx="128" cy="128" r="100" fill="#FFD580"/>
    <rect x="60" y="98" width="64" height="32" rx="14" fill="#222"/>
    <rect x="132" y="98" width="64" height="32" rx="14" fill="#222"/>
    <rect x="118" y="108" width="20" height="6" fill="#222"/>
    <path d="M 92 168 Q 128 188 164 168" stroke="#222" stroke-width="8" fill="none" stroke-linecap="round"/>
  ` },
  // 🤔 Think
  { name: "think", bg: BG.tertiaryContainer, emoji: "🤔", art: `
    <circle cx="128" cy="128" r="100" fill="#FFD580"/>
    <circle cx="100" cy="108" r="9" fill="#222"/>
    <circle cx="156" cy="108" r="9" fill="#222"/>
    <path d="M 90 160 Q 110 150 130 162" stroke="#222" stroke-width="8" fill="none" stroke-linecap="round"/>
    <rect x="170" y="160" width="22" height="14" rx="6" fill="#ec407a" transform="rotate(-15 181 167)"/>
  ` },
  // 😭 Cry
  { name: "cry", bg: BG.errorContainer, emoji: "😭", art: `
    <circle cx="128" cy="128" r="100" fill="#FFD580"/>
    <path d="M 84 110 Q 92 100 100 110" stroke="#222" stroke-width="7" fill="none" stroke-linecap="round"/>
    <path d="M 156 110 Q 164 100 172 110" stroke="#222" stroke-width="7" fill="none" stroke-linecap="round"/>
    <path d="M 100 168 Q 128 152 156 168" stroke="#222" stroke-width="8" fill="none" stroke-linecap="round"/>
    <path d="M 92 122 Q 88 168 96 168 Q 100 168 100 162 L 100 124 Z" fill="#38bdf8"/>
  ` },
  // 😡 Angry
  { name: "angry", bg: BG.errorContainer, emoji: "😡", art: `
    <circle cx="128" cy="128" r="100" fill="#FF6B6B"/>
    <path d="M 76 96 L 116 110" stroke="#222" stroke-width="8" fill="none" stroke-linecap="round"/>
    <path d="M 180 96 L 140 110" stroke="#222" stroke-width="8" fill="none" stroke-linecap="round"/>
    <circle cx="100" cy="116" r="8" fill="#222"/>
    <circle cx="156" cy="116" r="8" fill="#222"/>
    <path d="M 96 168 Q 128 152 160 168" stroke="#222" stroke-width="8" fill="none" stroke-linecap="round"/>
  ` },
  // 😴 Sleep
  { name: "sleep", bg: BG.secondaryContainer, emoji: "😴", art: `
    <circle cx="128" cy="128" r="100" fill="#FFD580"/>
    <path d="M 88 108 Q 100 100 112 108" stroke="#222" stroke-width="7" fill="none" stroke-linecap="round"/>
    <path d="M 144 108 Q 156 100 168 108" stroke="#222" stroke-width="7" fill="none" stroke-linecap="round"/>
    <ellipse cx="128" cy="168" rx="20" ry="6" fill="#222"/>
    <text x="180" y="80" font-size="32" fill="#64748b" font-family="sans-serif">z</text>
    <text x="190" y="60" font-size="22" fill="#94a3b8" font-family="sans-serif">z</text>
  ` },
  // 🤯 Mind-blown
  { name: "mind_blown", bg: BG.warning, emoji: "🤯", art: `
    <circle cx="128" cy="128" r="100" fill="#FFD580"/>
    <circle cx="100" cy="108" r="12" fill="#fff"/>
    <circle cx="100" cy="108" r="6" fill="#222"/>
    <circle cx="156" cy="108" r="12" fill="#fff"/>
    <circle cx="156" cy="108" r="6" fill="#222"/>
    <path d="M 96 160 Q 128 140 160 160" stroke="#222" stroke-width="8" fill="none" stroke-linecap="round"/>
    <path d="M 128 30 Q 110 60 128 70 Q 146 60 128 30" fill="#ec407a"/>
    <path d="M 60 50 Q 80 80 70 90 Q 60 80 60 50" fill="#ec407a"/>
    <path d="M 196 50 Q 176 80 186 90 Q 196 80 196 50" fill="#ec407a"/>
  ` },
  // 🥳 Party
  { name: "party", bg: BG.tertiaryContainer, emoji: "🥳", art: `
    <circle cx="128" cy="128" r="100" fill="#FFD580"/>
    <path d="M 76 96 L 180 96 L 180 100 L 76 100 Z" fill="#ec407a"/>
    <circle cx="100" cy="120" r="8" fill="#222"/>
    <circle cx="156" cy="120" r="8" fill="#222"/>
    <path d="M 96 168 Q 128 188 160 168" stroke="#222" stroke-width="8" fill="none" stroke-linecap="round"/>
    <path d="M 50 30 L 60 50 L 80 56 L 60 62 L 50 80 L 40 62 L 20 56 L 40 50 Z" fill="#fbbf24"/>
  ` },
  // 👀 Eyes
  { name: "eyes", bg: BG.secondaryContainer, emoji: "👀", art: `
    <ellipse cx="92" cy="128" rx="40" ry="26" fill="#fff" stroke="#222" stroke-width="6"/>
    <ellipse cx="164" cy="128" rx="40" ry="26" fill="#fff" stroke="#222" stroke-width="6"/>
    <circle cx="92" cy="128" r="14" fill="#222"/>
    <circle cx="164" cy="128" r="14" fill="#222"/>
    <circle cx="96" cy="124" r="4" fill="#fff"/>
    <circle cx="168" cy="124" r="4" fill="#fff"/>
  ` },
  // 🙏 Pray
  { name: "pray", bg: BG.primaryContainer, emoji: "🙏", art: `
    <rect x="64" y="60" width="40" height="120" rx="20" fill="#FFD580" stroke="#222" stroke-width="4" transform="rotate(-10 84 120)"/>
    <rect x="152" y="60" width="40" height="120" rx="20" fill="#FFD580" stroke="#222" stroke-width="4" transform="rotate(10 172 120)"/>
    <rect x="108" y="60" width="40" height="120" rx="20" fill="#FFD580" stroke="#222" stroke-width="4"/>
    <rect x="80" y="100" width="96" height="14" rx="6" fill="#ec407a"/>
  ` },
];

const CATS: StickerSpec[] = [
  { name: "happy_cat", bg: BG.warning, emoji: "😺", art: `
    <path d="M 64 200 L 64 96 Q 64 60 100 60 L 116 100 Q 128 80 140 100 L 156 60 Q 192 60 192 96 L 192 200 Z" fill="#fbbf24" stroke="#222" stroke-width="5"/>
    <circle cx="100" cy="140" r="9" fill="#222"/>
    <circle cx="156" cy="140" r="9" fill="#222"/>
    <path d="M 124 168 L 128 178 L 132 168" fill="#ec407a" stroke="#222" stroke-width="3"/>
    <path d="M 100 188 Q 128 200 156 188" stroke="#222" stroke-width="5" fill="none" stroke-linecap="round"/>
  ` },
  { name: "grumpy_cat", bg: BG.secondaryContainer, emoji: "😾", art: `
    <path d="M 64 200 L 64 96 Q 64 60 100 60 L 116 100 Q 128 80 140 100 L 156 60 Q 192 60 192 96 L 192 200 Z" fill="#9ca3af" stroke="#222" stroke-width="5"/>
    <path d="M 84 130 L 116 142" stroke="#222" stroke-width="6" stroke-linecap="round"/>
    <path d="M 140 142 L 172 130" stroke="#222" stroke-width="6" stroke-linecap="round"/>
    <circle cx="100" cy="142" r="8" fill="#222"/>
    <circle cx="156" cy="142" r="8" fill="#222"/>
    <path d="M 96 184 Q 128 174 160 184" stroke="#222" stroke-width="5" fill="none" stroke-linecap="round"/>
  ` },
  { name: "love_cat", bg: BG.pink, emoji: "😻", art: `
    <path d="M 64 200 L 64 96 Q 64 60 100 60 L 116 100 Q 128 80 140 100 L 156 60 Q 192 60 192 96 L 192 200 Z" fill="#fbbf24" stroke="#222" stroke-width="5"/>
    <path d="M 100 140 C 90 128 70 128 70 144 C 70 156 100 168 100 168 C 100 168 130 156 130 144 C 130 128 110 128 100 140 Z" fill="#ec407a"/>
    <path d="M 156 140 C 146 128 126 128 126 144 C 126 156 156 168 156 168 C 156 168 186 156 186 144 C 186 128 166 128 156 140 Z" fill="#ec407a"/>
    <path d="M 100 188 Q 128 200 156 188" stroke="#222" stroke-width="5" fill="none" stroke-linecap="round"/>
  ` },
  { name: "sleepy_cat", bg: BG.secondaryContainer, emoji: "😴", art: `
    <path d="M 64 200 L 64 96 Q 64 60 100 60 L 116 100 Q 128 80 140 100 L 156 60 Q 192 60 192 96 L 192 200 Z" fill="#a78bfa" stroke="#222" stroke-width="5"/>
    <path d="M 84 142 Q 100 132 116 142" stroke="#222" stroke-width="6" fill="none" stroke-linecap="round"/>
    <path d="M 140 142 Q 156 132 172 142" stroke="#222" stroke-width="6" fill="none" stroke-linecap="round"/>
    <path d="M 124 178 L 132 178" stroke="#222" stroke-width="5" stroke-linecap="round"/>
    <text x="190" y="80" font-size="24" fill="#94a3b8" font-family="sans-serif">z</text>
  ` },
  { name: "wink_cat", bg: BG.warning, emoji: "😼", art: `
    <path d="M 64 200 L 64 96 Q 64 60 100 60 L 116 100 Q 128 80 140 100 L 156 60 Q 192 60 192 96 L 192 200 Z" fill="#fbbf24" stroke="#222" stroke-width="5"/>
    <path d="M 84 138 Q 100 130 116 138" stroke="#222" stroke-width="6" fill="none" stroke-linecap="round"/>
    <circle cx="156" cy="142" r="9" fill="#222"/>
    <path d="M 120 178 L 128 188 L 136 178" fill="#ec407a" stroke="#222" stroke-width="3"/>
    <path d="M 100 192 Q 128 204 156 192" stroke="#222" stroke-width="5" fill="none" stroke-linecap="round"/>
  ` },
  { name: "shocked_cat", bg: BG.errorContainer, emoji: "🙀", art: `
    <path d="M 64 200 L 64 96 Q 64 60 100 60 L 116 100 Q 128 80 140 100 L 156 60 Q 192 60 192 96 L 192 200 Z" fill="#fbbf24" stroke="#222" stroke-width="5"/>
    <circle cx="100" cy="142" r="14" fill="#fff" stroke="#222" stroke-width="3"/>
    <circle cx="100" cy="142" r="6" fill="#222"/>
    <circle cx="156" cy="142" r="14" fill="#fff" stroke="#222" stroke-width="3"/>
    <circle cx="156" cy="142" r="6" fill="#222"/>
    <ellipse cx="128" cy="184" rx="14" ry="10" fill="#222"/>
  ` },
  { name: "sad_cat", bg: BG.secondaryContainer, emoji: "😿", art: `
    <path d="M 64 200 L 64 96 Q 64 60 100 60 L 116 100 Q 128 80 140 100 L 156 60 Q 192 60 192 96 L 192 200 Z" fill="#9ca3af" stroke="#222" stroke-width="5"/>
    <circle cx="100" cy="142" r="9" fill="#222"/>
    <circle cx="156" cy="142" r="9" fill="#222"/>
    <path d="M 128 178 L 124 188 L 132 188 Z" fill="#38bdf8"/>
    <path d="M 100 192 Q 128 178 156 192" stroke="#222" stroke-width="5" fill="none" stroke-linecap="round"/>
  ` },
  { name: "nerd_cat", bg: BG.primaryContainer, emoji: "🤓", art: `
    <path d="M 64 200 L 64 96 Q 64 60 100 60 L 116 100 Q 128 80 140 100 L 156 60 Q 192 60 192 96 L 192 200 Z" fill="#fbbf24" stroke="#222" stroke-width="5"/>
    <circle cx="100" cy="142" r="20" fill="none" stroke="#222" stroke-width="4"/>
    <circle cx="156" cy="142" r="20" fill="none" stroke="#222" stroke-width="4"/>
    <line x1="120" y1="142" x2="136" y2="142" stroke="#222" stroke-width="4"/>
    <circle cx="100" cy="142" r="6" fill="#222"/>
    <circle cx="156" cy="142" r="6" fill="#222"/>
    <path d="M 120 178 L 128 188 L 136 178" fill="#ec407a" stroke="#222" stroke-width="3"/>
  ` },
];

const HEARTS: StickerSpec[] = [
  { name: "red_heart", bg: BG.errorContainer, emoji: "❤️", art: `
    <path d="M 128 220 C 80 180 40 140 40 100 C 40 70 64 50 88 50 C 110 50 128 70 128 80 C 128 70 146 50 168 50 C 192 50 216 70 216 100 C 216 140 176 180 128 220 Z" fill="#ef4444" stroke="#222" stroke-width="5"/>
  ` },
  { name: "pink_heart", bg: BG.tertiaryContainer, emoji: "💕", art: `
    <path d="M 128 220 C 80 180 40 140 40 100 C 40 70 64 50 88 50 C 110 50 128 70 128 80 C 128 70 146 50 168 50 C 192 50 216 70 216 100 C 216 140 176 180 128 220 Z" fill="#ec4899" stroke="#222" stroke-width="5"/>
  ` },
  { name: "purple_heart", bg: BG.tertiaryContainer, emoji: "💜", art: `
    <path d="M 128 220 C 80 180 40 140 40 100 C 40 70 64 50 88 50 C 110 50 128 70 128 80 C 128 70 146 50 168 50 C 192 50 216 70 216 100 C 216 140 176 180 128 220 Z" fill="#a855f7" stroke="#222" stroke-width="5"/>
  ` },
  { name: "blue_heart", bg: BG.primaryContainer, emoji: "💙", art: `
    <path d="M 128 220 C 80 180 40 140 40 100 C 40 70 64 50 88 50 C 110 50 128 70 128 80 C 128 70 146 50 168 50 C 192 50 216 70 216 100 C 216 140 176 180 128 220 Z" fill="#3b82f6" stroke="#222" stroke-width="5"/>
  ` },
  { name: "green_heart", bg: BG.success, emoji: "💚", art: `
    <path d="M 128 220 C 80 180 40 140 40 100 C 40 70 64 50 88 50 C 110 50 128 70 128 80 C 128 70 146 50 168 50 C 192 50 216 70 216 100 C 216 140 176 180 128 220 Z" fill="#10b981" stroke="#222" stroke-width="5"/>
  ` },
  { name: "broken_heart", bg: BG.errorContainer, emoji: "💔", art: `
    <path d="M 128 220 C 80 180 40 140 40 100 C 40 70 64 50 88 50 C 110 50 128 70 128 80 L 110 110 L 140 130 L 116 150 L 146 170 L 128 180 C 128 70 146 50 168 50 C 192 50 216 70 216 100 C 216 140 176 180 128 220 Z" fill="#6b7280" stroke="#222" stroke-width="5"/>
    <path d="M 124 80 L 110 110 L 140 130 L 116 150 L 146 170 L 132 188" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round"/>
  ` },
];

const PACKS: { dir: string; spec: StickerSpec[] }[] = [
  { dir: "emojis", spec: EMOJIS },
  { dir: "cats", spec: CATS },
  { dir: "hearts", spec: HEARTS },
];

function wrap(art: string, bg: string): string {
  return `<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${SIZE}" height="${SIZE}" rx="48" fill="${bg}"/>
    ${art}
  </svg>`;
}

async function renderSticker(spec: StickerSpec, dir: string): Promise<{ name: string; emoji: string; file: string }> {
  const svg = wrap(spec.art, spec.bg);
  const file = `${spec.name}.webp`;
  await sharp(Buffer.from(svg))
    .resize(SIZE, SIZE, { fit: "contain" })
    .webp({ quality: 90 })
    .toFile(`${ROOT}/${dir}/${file}`);
  return { name: spec.name, emoji: spec.emoji, file };
}

async function main() {
  await mkdir(ROOT, { recursive: true });
  for (const pack of PACKS) {
    await mkdir(`${ROOT}/${pack.dir}`, { recursive: true });
    console.log(`Rendering ${pack.dir} pack (${pack.spec.length} stickers)…`);
    for (const s of pack.spec) {
      await renderSticker(s, pack.dir);
      process.stdout.write(".");
    }
    process.stdout.write("\n");
  }
  console.log("Done. Bundled stickers written to public/stickers/");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
