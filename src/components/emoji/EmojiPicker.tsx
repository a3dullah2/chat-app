"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

/** 8 quick reactions shown in the message action bar (spec FR-04 AC9). */
export const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥", "🎉"] as const;

const CATEGORIES: { label: string; emojis: string[] }[] = [
  {
    label: "Smileys & People",
    emojis: [
      "😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊","😇","🥰","😍","🤩",
      "😘","😗","😚","😙","🥲","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","🤐",
      "😐","😑","😶","😏","😒","🙄","😬","😮‍💨","🤥","😌","😔","😪","🤤","😴","😷","🤒",
      "🤕","🤢","🤮","🥵","🥶","🥴","😵","🤯","🤠","🥳","🥸","😎","🤓","🧐","😕","😟",
      "🙁","😮","😯","😲","😳","🥺","😦","😧","😨","😰","😥","😢","😭","😱","😖","😣",
      "😞","😓","😩","😫","🥱","😤","😡","😠","🤬","😈","👿","💀","💩","🤡","👻","👽",
    ],
  },
  {
    label: "Gestures",
    emojis: [
      "👋","🤚","🖐️","✋","🖖","👌","🤌","🤏","✌️","🤞","🤟","🤘","🤙","👈","👉","👆",
      "👇","☝️","👍","👎","✊","👊","🤛","🤜","👏","🙌","👐","🤲","🤝","🙏","💪","🦾",
    ],
  },
  {
    label: "Hearts & Symbols",
    emojis: [
      "❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖",
      "💘","💝","✨","⭐","🌟","💫","⚡","🔥","💥","💯","✅","❌","❓","❗","💤","🎉",
      "🎊","🎈","🎁","🏆","🥇","🎯","🎮","🎲","🎵","🎶","fmt_",
    ],
  },
  {
    label: "Animals & Nature",
    emojis: [
      "🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🙈",
      "🐦","🐧","🦅","🦉","🦇","🐺","🐗","🐴","🦄","🐝","🐛","🦋","🐌","🐞","🐢","🐍",
      "🌵","🌲","🌳","🌴","🌱","🌿","☘️","🍀","🌸","🌺","🌻","🌼","🌷","🌙","☀️","🌈",
    ],
  },
  {
    label: "Food & Drink",
    emojis: [
      "🍏","🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍒","🍑","🥭","🍍","🥥","🥝",
      "🍅","🥑","🥦","🥬","🌽","🥕","🧄","🧅","🥔","🍠","🥐","🍞","🥖","🧀","🥚","🍳",
      "🥓","🍔","🍟","🍕","🌭","🥪","🌮","🌯","🥗","🍝","🍜","🍲","🍣","🍱","🍤","🍚",
      "🍦","🍩","🍪","🎂","🍰","🧁","🍫","🍬","☕","🍵","🧃","🍺","🍻","🥤","🥂","🍾",
    ],
  },
  {
    label: "Travel & Objects",
    emojis: [
      "🚗","🚕","🚙","🚌","🏎️","🚓","🚑","🚒","🚚","🚜","🛴","🚲","🛵","✈️","🚀","🛸",
      "⛵","🏝️","🏖️","⛰️","🌋","🏰","🗼","🗽","⛲","🌃","🏙️","🌅","🌄","🌠","🎇","🎆",
      "⌚","📱","💻","⌨️","🖥️","🖨️","📷","📹","🎥","📞","☎️","📻","🎙️","⏰","⏳","🔋",
      "💡","🔦","📚","📖","📝","✏️","📎","✂️","🔒","🔑","🔨","🛠️","💊","💰","💎","🧲",
    ],
  },
];

// Remove the accidental placeholder token if present.
CATEGORIES[2].emojis = CATEGORIES[2].emojis.filter((e) => !e.startsWith("fmt_"));

export function EmojiGrid({ onPick }: { onPick: (emoji: string) => void }) {
  const [category, setCategory] = useState(0);
  const emojis = CATEGORIES[category].emojis;

  return (
    <div className="w-[288px]" role="region" aria-label="Emoji picker">
      <div className="flex gap-1 overflow-x-auto scrollbar-thin pb-1 mb-1" role="tablist" aria-label="Emoji categories">
        {CATEGORIES.map((c, i) => (
          <button
            key={c.label}
            type="button"
            role="tab"
            aria-selected={category === i}
            onClick={() => setCategory(i)}
            className={cn(
              "shrink-0 rounded-md px-2 py-1 text-[11px] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-ring",
              category === i ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {c.label.split(" ")[0]}
          </button>
        ))}
      </div>
      <div className="max-h-56 overflow-y-auto scrollbar-thin">
        <div className="grid grid-cols-8 gap-0.5">
          {emojis.map((emoji, i) => (
            <button
              key={`${emoji}-${i}`}
              type="button"
              onClick={() => onPick(emoji)}
              className="h-9 w-9 rounded-md flex items-center justify-center text-xl hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              aria-label={`Insert ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
