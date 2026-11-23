#!/usr/bin/env node
/**
 * Prerequisite verification & official make.fun press pack downloader.
 * Keeps all press pack files in an external working directory (outside the git repo)
 * and verifies every downloaded asset's SHA-256 digest against manifest.json.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '..');
export const DEFAULT_ASSETS_DIR = resolve(REPO_ROOT, '..', 'work-assets', 'press-pack');

export const MANIFEST_URL = 'https://make.fun/press/manifest.json';
export const LLMS_TXT_URL = 'https://make.fun/press/llms.txt';

export const REQUIRED_ASSET_PATHS = [
  'brand-badge/9x16/makefun-badge-9x16.png',
  'referral-card/9x16/makefun-card-9x16-transparent.webm',
  'illustrations/ghost-pile-trophy.png',
  'illustrations/ghost-laptop-recording.png',
  'illustrations/ghost-flag-wrench.png',
  'illustrations/ghost-judge-paddle.png',
  'screenshots/board-dark.png',
  'screenshots/competition-dark.png',
  'discord/invite-night-sky-1920x1080.jpg',
  'discord/invite-crew-magenta-1920x1080.jpg',
];

function runCapture(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function parseNodeVersion(raw) {
  const clean = raw.replace(/^v/, '');
  const [major, minor, patch] = clean.split('.').map((n) => Number.parseInt(n, 10));
  return { major, minor, patch, raw };
}

export function findFontFile(family, fallbackPaths = []) {
  for (const candidate of fallbackPaths) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  try {
    const out = runCapture('fc-match', ['-f', '%{file}', family]);
    if (out && existsSync(out)) {
      return out;
    }
  } catch {
    // fc-match may be unavailable; handled by fallback error below
  }
  throw new Error(`Required font not found for "${family}"`);
}

export function checkEnvironment() {
  const nodeVer = parseNodeVersion(process.version);
  const nodeOk = nodeVer.major > 22 || (nodeVer.major === 22 && nodeVer.minor >= 18);
  if (!nodeOk) {
    throw new Error(`Node.js >= 22.18 required, found ${nodeVer.raw}`);
  }

  const ffmpegVersion = runCapture('ffmpeg', ['-version']).split('\n')[0];
  const ffprobeVersion = runCapture('ffprobe', ['-version']).split('\n')[0];
  const filters = runCapture('ffmpeg', ['-hide_banner', '-filters']);
  const decoders = runCapture('ffmpeg', ['-hide_banner', '-decoders']);

  const hasDrawtext = /\bdrawtext\b/.test(filters);
  const hasOverlay = /\boverlay\b/.test(filters);
  const hasVp9 = /\blibvpx-vp9\b/.test(decoders);

  if (!hasDrawtext) throw new Error('ffmpeg is missing the drawtext filter');
  if (!hasOverlay) throw new Error('ffmpeg is missing the overlay filter');
  if (!hasVp9) throw new Error('ffmpeg is missing the libvpx-vp9 decoder');

  const monoBoldFont = findFontFile('JetBrains Mono:style=Bold', [
    '/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Bold.ttf',
  ]);
  const monoExtraBoldFont = findFontFile('JetBrains Mono:style=ExtraBold', [
    '/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-ExtraBold.ttf',
    monoBoldFont,
  ]);
  const sansBoldFont = findFontFile('DejaVu Sans:style=Bold', [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    monoExtraBoldFont,
  ]);

  return {
    node: nodeVer.raw,
    ffmpeg: ffmpegVersion,
    ffprobe: ffprobeVersion,
    hasDrawtext,
    hasOverlay,
    hasVp9,
    fonts: {
      monoBold: monoBoldFont,
      monoExtraBold: monoExtraBoldFont,
      sansBold: sansBoldFont,
    },
  };
}

export function sha256Buffer(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function sha256File(filePath) {
  return sha256Buffer(readFileSync(filePath));
}

async function fetchBuffer(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'bring-the-humans-03-agent/1.0' },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export function indexManifestAssets(manifest) {
  const byPath = new Map();
  const buckets = [
    manifest.brand_badge?.files ?? [],
    manifest.referral_card?.files ?? [],
    manifest.files ?? [],
  ];
  for (const list of buckets) {
    for (const item of list) {
      if (item?.path) {
        byPath.set(item.path, item);
      }
    }
  }
  return byPath;
}

export async function ensurePressPack(assetsDir = DEFAULT_ASSETS_DIR, assetPaths = REQUIRED_ASSET_PATHS) {
  mkdirSync(assetsDir, { recursive: true });

  const manifestPath = resolve(assetsDir, 'manifest.json');
  const llmsPath = resolve(assetsDir, 'llms.txt');

  const [manifestBuf, llmsBuf] = await Promise.all([
    fetchBuffer(MANIFEST_URL),
    fetchBuffer(LLMS_TXT_URL),
  ]);
  writeFileSync(manifestPath, manifestBuf);
  writeFileSync(llmsPath, llmsBuf);

  const manifest = JSON.parse(manifestBuf.toString('utf8'));
  const assetIndex = indexManifestAssets(manifest);

  const downloaded = {};
  for (const relPath of assetPaths) {
    const entry = assetIndex.get(relPath);
    if (!entry) {
      throw new Error(`Asset "${relPath}" not found in manifest.json (edition ${manifest.edition})`);
    }
    const localPath = resolve(assetsDir, relPath);
    mkdirSync(dirname(localPath), { recursive: true });

    let validCache = false;
    if (existsSync(localPath)) {
      const st = statSync(localPath);
      if (st.size === entry.bytes && sha256File(localPath) === entry.sha256) {
        validCache = true;
      }
    }

    if (!validCache) {
      const buf = await fetchBuffer(entry.url);
      const digest = sha256Buffer(buf);
      if (digest !== entry.sha256) {
        throw new Error(`SHA-256 mismatch for ${relPath}: expected ${entry.sha256}, got ${digest}`);
      }
      if (entry.bytes != null && buf.length !== entry.bytes) {
        throw new Error(`Size mismatch for ${relPath}: expected ${entry.bytes}, got ${buf.length}`);
      }
      writeFileSync(localPath, buf);
    }

    downloaded[relPath] = {
      path: localPath,
      url: entry.url,
      sha256: entry.sha256,
      bytes: entry.bytes,
      width: entry.width ?? null,
      height: entry.height ?? null,
      cached: validCache,
    };
  }

  return {
    edition: manifest.edition,
    assetsDir,
    manifestPath,
    llmsPath,
    manifest,
    assets: downloaded,
  };
}

export function getBrandSpec(manifest) {
  const badge9x16 = manifest.brand_badge?.aspects?.['9:16'];
  const card9x16 = manifest.referral_card?.fields?.['9:16'];
  const cardMeta = (manifest.referral_card?.files ?? []).find(
    (f) => f.path === 'referral-card/9x16/makefun-card-9x16-transparent.webm',
  );
  if (!badge9x16 || !card9x16 || !cardMeta) {
    throw new Error('Manifest is missing required 9:16 brand_badge or referral_card metadata');
  }
  const colours = Object.fromEntries(
    (manifest.brand?.colours ?? []).map((c) => [c.name.toLowerCase(), c.hex]),
  );
  return {
    edition: manifest.edition,
    frame: card9x16.frame,
    safeZone: badge9x16.safe_zone.box,
    badgeBox: badge9x16.badge,
    clearSpacePx: manifest.brand_badge.clear_space_px,
    cardDurationSec: cardMeta.duration_s,
    cardRestSec: card9x16.rest_s,
    caret: card9x16.caret,
    code: card9x16.code,
    colours: {
      magenta: colours['make.fun magenta'] ?? '#c41c83',
      ink: colours.ink ?? '#191419',
      white: colours.white ?? '#ffffff',
    },
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const env = checkEnvironment();
  const pack = await ensurePressPack();
  const spec = getBrandSpec(pack.manifest);
  console.log(
    JSON.stringify(
      {
        status: 'ok',
        environment: env,
        press_pack_edition: pack.edition,
        assets_dir: pack.assetsDir,
        verified_assets: Object.keys(pack.assets).length,
        brand_spec: spec,
      },
      null,
      2,
    ),
  );
}
