Regression inputs, not application art. The user supplied these four scans on
2026-11-14:

- `arasta.png`: Arasta of the Endless Web, MAR 32; opaque scanned corner shadows.
- `fireball.png`: Fireball, LEB 150; aged black borders and white print dots.
- `hit-it.png`: Hit It!, TRK 476; black top/bottom and partial side borders.
- `elas-il-kor.png`: Elas il-Kor, Sadistic Pilgrim, SLD 2733; detailed monochrome
  full art and a black footer. Dark artwork must not become flat black bleed.

`white-border-lightning-bolt.png`: Lightning Bolt, Revised Edition (3ED) 162.
Downloaded 2026-11-14 using Scryfall's public card API; `border_color: white`.
Source: https://scryfall.com/card/3ed/162/lightning-bolt
Image: https://cards.scryfall.io/png/front/c/b/cb9b9a9d-ae4c-4e04-bf9d-cae48f01292c.png

`mpc-simple-lotus.png`: actual 827 × 1122 MPC cardback fixture from MPC Autofill's
upstream desktop-tool tests, downloaded 2026-11-14. It includes its supplied
print bleed and is used to verify exact preservation when extending to 5 mm.
Source: https://github.com/chilli-axe/mpc-autofill/blob/master/desktop-tool/tests/cards/Simple%20Lotus.png

Tests inspect the actual renderer, preview and embedded PDF image. Controlled
synthetic fixtures separately establish geometry, safe-donor exclusion, exact
interior preservation, cream/aged border tones and nuisance-color invariance.
There is no ground-truth artwork for a real scan's missing corners.
