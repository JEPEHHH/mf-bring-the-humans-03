#!/usr/bin/env node
/**
 * TikTok publication handoff generator, caption validator, and VIDEO.json URL validator
 * for bring-the-humans-03.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REPO_ROOT } from './press-pack.mjs';
import { DEFAULT_OUT_DIR } from './render.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PLAY_CODE_RE = /\bmakefun-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+\b/i;
const REF_CODE_RE = /^[0-9a-hjkmnpqrstvwxyz]{8}$/;
const BOUNTY_MENTION_RE = /\$500\s+bounty\b/i;
const MAKEFUN_DOMAIN_RE = /(?:^|[^a-z0-9.-])(?:https?:\/\/)?(?:[a-z0-9-]+\.)*make\.fun(?:\/[^\s]*)?(?=$|[^a-z0-9.-])/i;
const SHORT_TIKTOK_HOSTS = new Set(['vm.tiktok.com', 'vt.tiktok.com']);

export function buildCaption(script, { playCode = '', refCode = '' } = {}) {
  const parts = [script.caption.hook, script.caption.required_line];
  if (playCode) {
    parts.push(`Play code: ${playCode.trim()}`);
  }
  if (refCode && REF_CODE_RE.test(refCode.trim().toLowerCase())) {
    parts.push(`Join with my referral link: https://make.fun/r/${refCode.trim().toLowerCase()}`);
  }
  if (script.caption.hashtags) {
    parts.push(script.caption.hashtags);
  }
  return parts.join('\n\n');
}

export function validateCaption(caption, { requirePlayCode = false } = {}) {
  const errors = [];
  if (!BOUNTY_MENTION_RE.test(caption)) {
    errors.push('Caption must include "$500 bounty" as a whole phrase.');
  }
  if (!MAKEFUN_DOMAIN_RE.test(caption)) {
    errors.push('Caption must include make.fun written out as a valid name or URL.');
  }
  if (requirePlayCode && !PLAY_CODE_RE.test(caption)) {
    errors.push('Caption is missing a makefun-<word>-<word>-<word> play code (or put it in TikTok bio).');
  }
  if (caption.length > 2200) {
    errors.push(`Caption length ${caption.length} exceeds TikTok's 2200 character limit.`);
  }
  return { valid: errors.length === 0, errors };
}

export function validateTikTokUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    return { valid: false, reason: 'URL must be a non-empty string.' };
  }
  if (Buffer.byteLength(rawUrl, 'utf8') > 2048) {
    return { valid: false, reason: 'URL exceeds 2048 bytes.' };
  }
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { valid: false, reason: 'URL is not a valid absolute URL.' };
  }
  if (parsed.protocol !== 'https:') {
    return { valid: false, reason: 'URL must use https://.' };
  }
  const host = parsed.hostname.toLowerCase();
  if (SHORT_TIKTOK_HOSTS.has(host) || (host.endsWith('tiktok.com') && parsed.pathname.startsWith('/t/'))) {
    return { valid: false, reason: 'Short TikTok links are refused; open in a browser and copy the full /@handle/video/<id> URL.' };
  }
  if (host !== 'www.tiktok.com' && host !== 'tiktok.com' && host !== 'm.tiktok.com') {
    return { valid: false, reason: `Unsupported host "${host}"; expected www.tiktok.com, tiktok.com, or m.tiktok.com.` };
  }
  if (/\/photo\/\d+/i.test(parsed.pathname)) {
    return { valid: false, reason: 'Photo posts (/photo/<id>) are refused; post must be a video.' };
  }
  const fullVideoMatch = /^\/@([a-zA-Z0-9._-]+)\/video\/(\d+)\/?$/.exec(parsed.pathname);
  const mobileVideoMatch = host === 'm.tiktok.com' ? /^\/v\/(\d+)\.html$/.exec(parsed.pathname) : null;

  if (!fullVideoMatch && !mobileVideoMatch) {
    return {
      valid: false,
      reason: 'Pathname must match /@<handle>/video/<digits> (or m.tiktok.com/v/<digits>.html).',
    };
  }
  const videoId = fullVideoMatch ? fullVideoMatch[2] : mobileVideoMatch[1];
  const handle = fullVideoMatch ? fullVideoMatch[1] : null;
  return { valid: true, videoId, handle, normalizedUrl: parsed.origin + parsed.pathname };
}

export function writeHandoffPackage({
  scriptPath = resolve(__dirname, 'script.json'),
  videoPath = resolve(DEFAULT_OUT_DIR, 'ad.mp4'),
  handoffPath = resolve(DEFAULT_OUT_DIR, 'PUBLISH_HANDOFF.txt'),
  playCode = process.env.MAKEFUN_PLAY_CODE ?? '',
  refCode = process.env.MAKEFUN_REFERRAL_CODE ?? '',
} = {}) {
  const script = JSON.parse(readFileSync(scriptPath, 'utf8'));
  const caption = buildCaption(script, { playCode, refCode });
  const captionCheck = validateCaption(caption, { requirePlayCode: Boolean(playCode) });
  if (!captionCheck.valid) {
    throw new Error(`Invalid caption: ${captionCheck.errors.join(' ')}`);
  }

  const lines = [
    '=== make.fun bring-the-humans-03 TikTok Publish Handoff ===',
    '',
    `Rendered video file : ${videoPath}`,
    `Video file present  : ${existsSync(videoPath) ? 'YES' : 'NO (run node ad/render.mjs --ref-code <YOUR_CODE>)'}`,
    `Referral code used  : ${refCode || '<RE-RENDER WITH YOUR 8-CHAR CODE BEFORE POSTING>'}`,
    `Play code included  : ${playCode || '<ADD YOUR PLAY CODE IN CAPTION OR TIKTOK BIO>'}`,
    '',
    '--- STEP 1: Re-render with your real make.fun referral code (if preview was used) ---',
    '  node ad/render.mjs --ref-code <YOUR_8_CHAR_REFERRAL_CODE>',
    '  node ad/verify-video.mjs',
    '',
    '--- STEP 2: Upload the MP4 directly to TikTok (NO edits, trims, or filters in TikTok editor) ---',
    '  - Account: Public TikTok account (Private account OFF)',
    '  - Visibility: Everyone, viewable from the US',
    '  - Post type: Video (not Photo post)',
    '',
    '--- STEP 3: Paste this exact caption ---',
    caption,
    '',
    '--- STEP 4: Save the published full TikTok URL into VIDEO.json ---',
    '  node ad/publish-kit.mjs --set-url "https://www.tiktok.com/@<handle>/video/<id>"',
    '  mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts',
    '',
  ];

  mkdirSync(dirname(handoffPath), { recursive: true });
  writeFileSync(handoffPath, lines.join('\n'), 'utf8');
  return { handoffPath, caption, captionCheck };
}

function runSelfTest() {
  const script = JSON.parse(readFileSync(resolve(__dirname, 'script.json'), 'utf8'));
  const goodCaption = buildCaption(script, { playCode: 'makefun-oak-river-lantern', refCode: '7k9m2p4x' });
  const c1 = validateCaption(goodCaption, { requirePlayCode: true });
  const c2 = validateCaption('Made for $500 bountyhunter on notmake.fun', { requirePlayCode: true });

  const u1 = validateTikTokUrl('https://www.tiktok.com/@alice_builds/video/7440123456789012345');
  const u2 = validateTikTokUrl('https://vm.tiktok.com/ZM8abc123/');
  const u3 = validateTikTokUrl('https://www.tiktok.com/@alice_builds/photo/7440123456789012345');
  const u4 = validateTikTokUrl('https://www.tiktok.com/@<handle>/video/<id>');

  const assertions = [
    ['valid_caption_passes', c1.valid === true],
    ['bad_caption_rejected', c2.valid === false && c2.errors.length === 3],
    ['full_video_url_passes', u1.valid === true && u1.videoId === '7440123456789012345'],
    ['short_link_rejected', u2.valid === false],
    ['photo_post_rejected', u3.valid === false],
    ['placeholder_rejected', u4.valid === false],
  ];
  const failed = assertions.filter(([, ok]) => !ok);
  if (failed.length > 0) {
    throw new Error(`publish-kit self-test failed: ${failed.map(([n]) => n).join(', ')}`);
  }
  return { status: 'pass', tests: assertions.map(([name, pass]) => ({ name, pass })) };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    console.log(JSON.stringify(runSelfTest(), null, 2));
  } else {
    const setUrlIdx = args.indexOf('--set-url');
    if (setUrlIdx !== -1 && args[setUrlIdx + 1]) {
      const url = args[setUrlIdx + 1];
      const check = validateTikTokUrl(url);
      if (!check.valid) {
        console.error(`Refusing invalid TikTok URL: ${check.reason}`);
        process.exit(1);
      }
      const videoJsonPath = resolve(REPO_ROOT, 'VIDEO.json');
      writeFileSync(videoJsonPath, JSON.stringify({ url: check.normalizedUrl }) + '\n', 'utf8');
      console.log(JSON.stringify({ status: 'updated', videoJsonPath, url: check.normalizedUrl }, null, 2));
    } else {
      const playIdx = args.indexOf('--play-code');
      const refIdx = args.indexOf('--ref-code');
      const res = writeHandoffPackage({
        playCode: playIdx !== -1 ? args[playIdx + 1] : undefined,
        refCode: refIdx !== -1 ? args[refIdx + 1] : undefined,
      });
      console.log(JSON.stringify({ status: 'ok', ...res }, null, 2));
    }
  }
}
