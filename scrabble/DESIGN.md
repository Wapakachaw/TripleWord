# Triple Word — design handoff

Built to the brief in `UI-DESIGNER.md`: a token-based design system, light and dark themes, WCAG 2.1 AA contrast, keyboard and screen-reader support, responsive from 360px phones to desktop, and restrained motion.

## Direction

The tiles are the one expressive element: maple-wood tiles with a faint grain and slab-serif letters that press into the board. Everything around them is quiet — sage paper background, slate-teal board felt, muted jewel-tone bonus squares — so the words on the board carry the screen.

## Tokens (`public/styles.css`, `:root`)

| Group | Tokens | Light | Dark |
|---|---|---|---|
| Surface | `--bg` `--surface` `--surface-2` `--line` | #E6EAE4 #F7F8F5 #EEF1EC #CBD3CC | #172220 #1F2D2A #26362F #344641 |
| Ink | `--ink` `--ink-muted` | #1E2A28 #51605B | #E8EEEA #A3B4AE |
| Board | `--felt` `--cell` | #2F4A46 #DCE3DC | #0F1A18 #2A3B37 |
| Bonus squares | `--tw` `--dw` `--tl` `--dl` | #B8323A #E9A9AC #2D5C9E #AFCFE8 | #C2434B #8C4553 #3A6BB3 #34607D |
| Tiles | `--tile` `--tile-hi` `--tile-edge` `--tile-ink` | #EBD2A2 #F6E5C3 #B48A4A #2A1E10 | tiles stay light in dark mode |
| Players | `--p0` `--p1` `--p2` | amber #B86E00, teal #0E8070, violet #7346BD | #F0A53A #3CC2AE #A889E6 |
| Action | `--primary` `--focus` `--danger` `--ok` | #2F4A46 #1F6FEB #A8262E #1D7A45 | #7FC4B6 #79B0FF #FF8A8F #6FD39A |

Spacing `--s1…--s6` (4–32px), radius `--r-sm/md/lg` (6/10/16px), motion `--t-fast` 120ms and `--t-med` 220ms with `--ease-out`.

Type: **Rubik** for the interface (400–700), **Zilla Slab** 700 for tile letters and scores.

## Components

- **Tile** — `.tile`, sized by `--t`. States: rack, `.selected` (lifted, blue ring), `.swap-selected` (red ring), `.pending` (brighter, blue ring, press-in animation), `.last` (ring in the colour of the player who just played), `.is-blank`.
- **Board cell** — `.cell` + `.sq-TW/DW/TL/DL`, `.center`, `.drop-target`. Labels read 3W/2W/3L/2L; each cell has a full `aria-label` ("Row 8, column 8, centre star, double word").
- **Player card** — colour bar, name, score; `.is-turn` outlines it in the player's colour.
- **Move log**, **toasts** (polite live region), **dialogs** (blank letter picker, confirm pass, game over, help), **toggle**.

## Interaction

- Tap a rack tile then a square, or drag it (pointer events — works with mouse, touch and pen). Tap a placed tile to take it back; drag it to the rack to reorder.
- Keyboard: arrow keys move around the board, typing places letters (blanks are used automatically when you don't have the letter), Space or a second click switches across/down, Backspace takes back, Enter plays.
- Live score preview on the Play button and a one-line hint explaining any problem before you submit.
- On phones: sticky rack and actions, and a Zoom button that enlarges the board inside a scrollable frame.

## Accessibility

- Contrast checked for all text on bonus squares and buttons in both themes (AA, 4.5:1 for text).
- Visible 3px focus rings, skip link, roving tab index on the board grid, `aria-pressed` on tiles and toggles, live regions for turn changes and moves.
- `prefers-reduced-motion` removes animation; `prefers-color-scheme` sets the default theme, with a manual toggle saved per device.
- Minimum 44px touch targets for buttons and rack tiles.
