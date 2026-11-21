# Slot Machine Source Notes

Reference: [nuxy/slot-machine-gen](https://github.com/nuxy/slot-machine-gen), including `src/slot-machine.js`, `src/slot-machine.scss`, its README, and MIT license.

## Reel and symbol configuration

Each reel is configured as an object with an image source and an ordered `symbols` array. A symbol has a `title`, a pixel `position` for its center in the strip, and a relative `weight`. The source sums weights and selects one symbol by subtracting weights from an RNG-derived number. It repeats that selection independently for each reel. The strip is divided into 24 equal segments; the selected symbol's position is translated into a background-image offset for every segment.

## 3D spin and stop

The source creates 24 absolutely positioned strip segments, each rotated by 15 degrees and translated along Z to form a faux cylinder with `transform-style: preserve-3d`. Its `.spin` animation continuously rotates the strip through 360 degrees. A per-reel timer changes `.spin` to `.stop`; the stop animation eases back to the resting angle. The source chooses timer delays randomly, so reel order and duration are not tied to an outcome protocol.

## RNG and callback

The default `rngFunc` is `Math.random()`. Weighted selection happens in the browser. After each reel's timer ends, the selected symbol is appended to a callback array; after every reel has stopped, the callback receives those symbols for client-side scoring or display. Neither the selection nor callback verifies a server result.

## Keep and replace

Useful ideas are per-reel configuration, explicit symbol weights, transform-based motion, and waiting for all reel stops before presenting a completed result. Fetan Bet replaces browser selection, client-side scoring, random stop timing, image strips, and arbitrary click-to-spin behavior. Its API determines all five stop indices and evaluates the resulting 5-by-3 grid; the browser animates to those stops in order. Symbols are original HTML/SVG/CSS artwork. No source code, demo images, or sounds are copied or adapted, so no third-party source notice is required.

## Lucky Royale paylines

Rows are numbered top-to-bottom as 0, 1, 2 in code (top, middle, bottom). Reels are numbered left-to-right 0 through 4. Each entry below lists the row used on reels 0, 1, 2, 3, 4:

| Line | Reel row coordinates |
|---|---|
| 1 | 1, 1, 1, 1, 1 |
| 2 | 0, 0, 0, 0, 0 |
| 3 | 2, 2, 2, 2, 2 |
| 4 | 0, 1, 2, 1, 0 |
| 5 | 2, 1, 0, 1, 2 |
| 6 | 0, 0, 1, 2, 2 |
| 7 | 2, 2, 1, 0, 0 |
| 8 | 1, 0, 0, 0, 1 |
| 9 | 1, 2, 2, 2, 1 |
| 10 | 0, 1, 1, 1, 2 |

The server evaluates these fixed paths from left to right. The first non-wild symbol sets the match; wild substitutes for it, and three or more matches use the integer multiplier in `slot-config.js`.
