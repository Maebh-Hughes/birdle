# BIRDLE valid-guess dictionary: source and license

`guesses.txt` holds every 4- to 11-letter word from the **ENABLE2K** word list
(Enhanced North American Benchmark LExicon, "WORD.LST", 2000 edition),
compiled by Alan Beale and Mendel Cooper. It is **not** derived from the
New York Times Wordle lists.

## Source

- Word list file: https://raw.githubusercontent.com/BartMassey/wordlists/af52415c13af809bd8757a40f17f46e79d09583c/enable2k.txt.gz
  - sha256 (gz): `2c1093669cd16439bdb0a693a0058626c9c9f82e59244c9b0bde89515d44d3ad`
  - 173,528 lines, LF endings, all lowercase a-z (this matches the "173,528" count stated in the official README)
- Official ENABLE2K README (license text): https://raw.githubusercontent.com/BartMassey/wordlists/af52415c13af809bd8757a40f17f46e79d09583c/README-enable2k.txt
  - sha256: `ce998d561ba84df4aea9840a8e729218fa61cf5de5d8480e3efc9965a9a22751`
  - A copy is saved next to this file as `README-enable2k.txt`.
- Repository: https://github.com/BartMassey/wordlists (commit `af52415c13af809bd8757a40f17f46e79d09583c`)
- Original distribution (Internet Archive, as cited by the repo README):
  https://web.archive.org/web/20090122025747/http://personal.riverusers.com/~thegrendel/enable2k.zip
- npm package: none (fetched directly from GitHub).

## License

**Public Domain.** This is the verbatim release statement from the
official ENABLE2K README:

> The ENABLE master word list, WORD.LST, is herewith formally released
> into the Public Domain. Anyone is free to use it or distribute it in
> any manner they see fit. No fee or registration is required for its
> use nor are "contributions" solicited (if you feel you absolutely
> must contribute something for your own peace of mind, the authors of
> the ENABLE list ask that you make a donation on their behalf to your
> favorite charity). This word list is our gift to the Scrabble community,
> as an alternate to "official" word lists. Game designers may feel free
> to incorporate the WORD.LST into their games. Please mention the source
> and credit us as originators of the list. Note that if you, as a game
> designer, use the WORD.LST in your product, you may still copyright and
> protect your product, but you may *not* legally copyright or in any way
> restrict redistribution of the WORD.LST portion of your product. This
> *may* under law restrict your rights to restrict your users' rights,
> but that is only fair.

What this means for BIRDLE:
- No license text has to be included. The authors ask for credit
  ("Please mention the source and credit us as originators of the list").
- BIRDLE's own code can be under any license, but the word-list portion
  cannot be restricted from redistribution.

### Attribution to include (README / credits / about command)

> Valid-guess dictionary: words from the ENABLE2K word list
> (Enhanced North American Benchmark LExicon) by Alan Beale and Mendel
> Cooper, released into the Public Domain.

### Note on the hosting repository

The BartMassey/wordlists repository is under the MIT License
("Copyright © 2025 Bart Massey"). That covers the repo's own work, meaning
its packaging and scripts. Its README states that the ENABLE 2K list "was
placed in the Public Domain by its creators". We use only the unmodified
word data, so the MIT terms do not reach our copy. Crediting the repo is
optional.

## Processing

```sh
gunzip -k enable2k.txt.gz
tr -d '\r' < enable2k.txt | grep -E '^[a-z]{5}$' | LC_ALL=C sort -u > guesses.txt
```

Result: 140,643 words (4-11 letters), lowercase a-z only, sorted (C locale), unique, LF endings.
sha256 of `guesses.txt`: `8d221de26e1d43f079325a1916f6ccbdf58d90e3487d62f87e525385678d7132`

## Caveats

- ENABLE is a Scrabble-style list with no filtering. It contains
  profanity and slurs. That is fine for a list of accepted guesses, but
  never draw answers from it. Use a separate, curated answer list.
- It has obscure but valid entries such as `crwth`, `phpht`, `xylyl` and
  `typps`. There are no abbreviations, proper nouns or capitalized entries.
- It is US-leaning and misses some bird names (e.g. `twite`, `potoo`, `munia`,
  `shama`, `pitta`). BIRDLE's server therefore accepts every word in
  `birds.json` as a valid guess in addition to this list.
