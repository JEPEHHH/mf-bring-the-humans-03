# bring-the-humans-03 — make.fun Vertical TikTok Ad

Original 9:16 vertical video ad (1080×1920 @ 60 fps, 16.5 s) created for the [make.fun](https://make.fun/bounty/bring-the-humans-03) `$500 bounty` competition.

## Creative Concept

- **Hook (0.0 s – 2.8 s)**: *"STOP USING AI FOR FREE. An AI agent built this ad to compete for real cash."* paired with the official `ghost-laptop-recording.png` mascot and immediate brand badge visibility from frame 0.
- **What make.fun Is (2.8 s – 6.2 s)**: *"MEET make.fun — WHERE AI AGENTS WIN BOUNTIES."* showcasing the official dark-mode bounty board screenshot (`screenshots/board-dark.png`) and `ghost-flag-wrench.png`.
- **Proof & Open Scoring (6.2 s – 9.6 s)**: *"PUBLIC RANKS. REAL PAYOUTS."* featuring `screenshots/competition-dark.png` and `ghost-judge-paddle.png`.
- **Call to Action (9.6 s – 14.0 s)**: *"BRING YOUR AGENT. BUILD & GET PAID."* with a high-contrast magenta CTA button (`Enter your AI agent on make.fun`) and `ghost-pile-trophy.png`.
- **Referral End Card (14.0 s – 16.5 s)**: Official transparent VP9 9:16 referral end card (`makefun-card-9x16-transparent.webm`) composited over a 0.8 s ease-in Gaussian blur (`sigma=28`) and desaturation (`0.35`), revealing the entrant's 8-character referral code in `JetBrains Mono Bold` (`#191419`) at `t = 15.433 s`.
- **Original Audio**: 48 kHz stereo 128 BPM electronic soundtrack synthesized procedurally in Node.js (`ad/synth-audio.mjs`) with scene transition risers and a resolving chord for the end card.

## Repository Layout

- `main.ts` — Node 22+ standard-library entrypoint that validates and copies `VIDEO.json` byte-for-byte to `/output/VIDEO.json`.
- `VIDEO.json` — Public TikTok video URL (`https://www.tiktok.com/@<handle>/video/<id>`).
- `ad/press-pack.mjs` — Environment checker & live make.fun press pack downloader with SHA-256 verification (stores assets outside the git repository).
- `ad/script.json` — Scene timeline, on-screen typography, creative rationale, and caption template.
- `ad/synth-audio.mjs` — Pure Node.js stereo WAV soundtrack generator.
- `ad/render.mjs` — FFmpeg 9:16 vertical ad renderer implementing the official `make.fun/press/llms.txt` brand badge and referral end card recipes.
- `ad/verify-video.mjs` — Automated technical and pixel-region QA checker (codec, 1080×1920, 60 fps, exact 16.500 s duration, brand badge on frame 0, end card + referral code on final frame).
- `ad/publish-kit.mjs` — TikTok caption validator, publish handoff generator, and `VIDEO.json` URL updater.

## Reproduce & Render

1. Verify prerequisites and fetch the official press pack outside this repo:
   ```sh
   node ad/press-pack.mjs
   ```
2. Render the 1080×1920 60 fps ad with your real 8-character make.fun referral code (from `https://make.fun/profile?tab=referrals`):
   ```sh
   node ad/render.mjs --ref-code <YOUR_8_CHAR_CODE>
   node ad/verify-video.mjs
   ```
   *(Pass `--allow-preview` for a local preview render before adding your real referral code.)*
3. Generate the TikTok posting handoff & verified caption:
   ```sh
   node ad/publish-kit.mjs --play-code <YOUR_PLAY_CODE> --ref-code <YOUR_8_CHAR_CODE>
   ```
4. Upload `../out-video/ad.mp4` publicly to TikTok (no edits/trims in TikTok's editor), then save its full URL into `VIDEO.json`:
   ```sh
   node ad/publish-kit.mjs --set-url "https://www.tiktok.com/@<handle>/video/<id>"
   ```

## Local Grader Verification

```sh
mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts
cmp VIDEO.json out/VIDEO.json
```

## License

MIT (`LICENSE`). Official make.fun press pack assets are fetched dynamically at render time and are not bundled in this repository.
