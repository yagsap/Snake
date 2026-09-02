# App Store listing copy

Paste-ready text for App Store Connect. Character limits are Apple's; the
counts in brackets are what these actually use.

## Name (30 max) — CHOSEN

```
Alphabet Snake
```
[14] — "Alphabite" was taken. This one is plainer but tests better: nobody who
reads it is confused for a second, and "alphabet" is a heavily-searched term.
Its one weakness is that it reads a little young, which undersells the
Japanese, Chinese and Korean depth — so the subtitle must carry that, and does.

## Subtitle (30 max)

```
Letters, numbers, first words
```
[29] — the audience is CHILDREN learning to read, so the subtitle names what a
parent is buying in plain words. The previous version, `Kana, hanzi, Greek &
Cyrillic`, was written for an adult self-studier: it reads as a linguistics
shelf, and a parent scanning the store does not know what a hanzi is. The
script names now live in the description, where there is room to say them
without being the first thing anyone sees.

## Promotional text (170 max, editable without review)

```
Hear a letter, eat the letter. Kids learn the alphabet, numbers 1 to 10 and their first words — in English, Japanese, Chinese, Russian, Hindi, Korean or Greek.
```
[159]

## Description (4000 max)

```
Snake, but the food is the alphabet.

Your child hears a letter. Five appear on the board. They eat the right one.

That one rule turns the oldest phone game into reading practice kids ask to
do again. Nothing to type, nothing to read first — if they can hear it and
steer, they can play it.

WHAT THEY LEARN
• Letters — capitals and small, one small group at a time
• Numbers — counting to five, then all ten
• First words — animals, fruit and veg, colours, spelled out letter by letter
• And six more writing systems when they are ready: Japanese kana, Chinese
  characters, Russian, Hindi, Korean and Greek

A LADDER, NOT A PILE
Levels go in order and unlock as they are cleared, so there is always exactly
one next thing to do. Every level shows the characters it teaches, and the
menu shows how far up the ladder they have climbed.

IT PAYS ATTENTION
The wrong answers are not random — they are the letters children genuinely mix
up: b against d, p against q, 6 against 9. Miss one and the letter you wanted
jumps up and waves so they see which it was. It remembers every letter they
miss and brings it back before they forget it, and it eases off the ones they
already know.

KIND BY DESIGN
No walls to crash into and no way to lose by fumbling a turn — the only thing
being tested is whether they know the letter. Play at a steady pace, or speed
it up when that gets easy.

FOR PARENTS
Fully offline. No account, no ads, no tracking, no data collected, nothing to
buy inside. A study chart shows exactly which letters they keep missing.
```

## Keywords (100 max, comma-separated, no spaces after commas)

```
kids,children,abc,alphabet,letters,numbers,counting,phonics,reading,preschool,kana,hangul,greek
```
[95] — leads with the words a parent types. The script names that will not fit
(hiragana, cyrillic, devanagari, hanzi) are all in the description, which is
indexed for search too.

Adult-learner variant, if the positioning ever changes back:
```
alphabet,kana,hiragana,katakana,cyrillic,hangul,greek,learn,letters,language,reading,phonics,abc
```
[99]

## Category

Primary: **Education**  ·  Secondary: **Games → Word**

## Age rating

All questionnaire answers "None" / "No" → **4+**

## Privacy

- Privacy Policy URL: `https://yagsap.github.io/Snake/privacy.html`
- App Privacy: **Data Not Collected** — everything is localStorage on device;
  no analytics, no network calls, no account.

## Support / marketing URL

```
https://yagsap.github.io/Snake/
```

## App Review notes

```
Fully offline educational game teaching character recognition across seven
writing systems: the English alphabet, Japanese kana, Chinese hanzi, Cyrillic,
Devanagari, Hangul and Greek. No account, no network use, no data collected.
Audio: character pronunciations via the system text-to-speech engine
(AVSpeechSynthesizer). The game is bundled in the app; nothing is loaded from
a remote URL.
```

## Screenshots — DONE

Five finished 1320x2868 PNGs (the 6.9-inch set, the only one App Store
Connect requires — smaller sizes are scaled from it) are in
`store-screenshots/`, captions already baked in. Upload in this order:

| File | Caption |
|---|---|
| `1-gameplay.png` | Hear a letter. / Eat the letter. |
| `3-phonics.png` | b is for ball. / Sounds, not just names. |
| `2-menu-ladder.png` | Always one / clear next step. |
| `4-levels.png` | Letters, numbers, / and first words. |
| `5-chart.png` | It knows what / they keep missing. |

Gameplay leads because it shows the rule in one glance. Phonics is second
because it is the strongest claim for the audience this listing is written
for — most alphabet apps drill letter NAMES, and names do not help a child
decode a word.

Captured at 440x956 CSS pixels at 3x, which IS an iPhone 16 Pro Max, so the
layout is the one a real phone renders rather than a desktop page scaled up.
Verified against the same screens in the iOS Simulator.

Note for a future pass: the app leaves a wide empty band above and below the
menu card on a 6.9-inch phone — real, not a capture artefact, and confirmed
in the Simulator. The screenshots hang the screen below a caption so the band
reads as intentional padding, but the layout itself would be worth tightening
for the largest phones.
