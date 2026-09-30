# Public website images

Original PNG screenshots and compositions. The public pages use optimized copies
in `frontend/public/assets/seo/` and `frontend/public/assets/og/`.

| Source | Public pages |
| --- | --- |
| `portada.png` | Home, how-to guide, ways to play, default social preview |
| `gameplay.png` | Play Commander/EDH, free play, simulator, webcam-free play, SpellTable alternative, Table Assistant |
| `room.png` | Create a room, play with friends |
| `decklist_base.png` | Import a deck |
| `decklist.png` | Deck builder |

`analisis.png` and `spoiler_deck.png` remain available as source images for future
sections. FAQ and 404 already have their own artwork and are unchanged.

Hero exports are 960 × 504 WebP (quality 85). Social previews are 1200 × 630 PNG.
Fit the entire source image inside the export, preserving its proportions, with
`#10100e` padding where needed. Keep the existing public filenames so localized
pages, preload links and social metadata use the same assets.
