#!/usr/bin/env node
/**
 * Vertical 9:16 (1080x1920 @ 60fps) TikTok ad renderer for make.fun.
 *
 * Uses official make.fun press pack assets fetched outside this repository:
 * - Official brand colours (#191419 ink, #c41c83 magenta, #ffffff white)
 * - Unmodified mascot illustrations and dark-mode site screenshots
 * - Official 9:16 brand badge overlay from frame 0 until the referral end card
 * - Official 9:16 transparent VP9 referral end card with Gaussian blur + desaturation
 *   and the entrant's 8-character referral code in JetBrains Mono Bold (#191419)
 * - Original 48kHz stereo soundtrack synthesized by ad/synth-audio.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_ASSETS_DIR,
  REPO_ROOT,
  checkEnvironment,
  ensurePressPack,
  getBrandSpec,
} from './press-pack.mjs';
import { synthesizeAdAudio } from './synth-audio.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_OUT_DIR = resolve(REPO_ROOT, '..', 'out-video');
const REF_CODE_REGEX = /^[0-9a-hjkmnpqrstvwxyz]{8}$/;

function parseArgs(argv) {
  const opts = {
    refCode: process.env.MAKEFUN_REFERRAL_CODE ?? '',
    allowPreview: false,
    outFile: resolve(DEFAULT_OUT_DIR, 'ad.mp4'),
    assetsDir: DEFAULT_ASSETS_DIR,
    scriptPath: resolve(__dirname, 'script.json'),
    inspectFrames: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ref-code' && argv[i + 1]) {
      opts.refCode = argv[++i].trim().toLowerCase();
    } else if (a === '--out' && argv[i + 1]) {
      opts.outFile = resolve(argv[++i]);
    } else if (a === '--assets-dir' && argv[i + 1]) {
      opts.assetsDir = resolve(argv[++i]);
    } else if (a === '--script' && argv[i + 1]) {
      opts.scriptPath = resolve(argv[++i]);
    } else if (a === '--allow-preview') {
      opts.allowPreview = true;
    } else if (a === '--no-inspect') {
      opts.inspectFrames = false;
    }
  }
  return opts;
}

function escapeDrawtext(text) {
  return String(text)
    .replaceAll('\\', '\\\\')
    .replaceAll(':', '\\:')
    .replaceAll("'", "\\'")
    .replaceAll('%', '\\%');
}

function escapeFilterPath(filePath) {
  return filePath.replaceAll('\\', '/').replaceAll(':', '\\:').replaceAll("'", "\\'");
}

function runFfmpeg(args, label) {
  const res = spawnSync('ffmpeg', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (res.status !== 0) {
    const tail = (res.stderr || res.stdout || '').split('\n').slice(-25).join('\n');
    throw new Error(`ffmpeg failed during ${label} (exit ${res.status}):\n${tail}`);
  }
}

function probeMedia(filePath) {
  const res = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filePath],
    { encoding: 'utf8' },
  );
  if (res.status !== 0) {
    throw new Error(`ffprobe failed on ${filePath}: ${res.stderr}`);
  }
  return JSON.parse(res.stdout);
}

/**
 * Build a single 1080x1920 60fps scene segment with kinetic typography inside
 * the TikTok/Reels safe zone and clear of the top-left brand badge (y >= 436).
 */
function renderSceneClip(scene, durationSec, env, pack, spec, outPath) {
  const W = spec.frame.width;
  const H = spec.frame.height;
  const fps = 60;

  const inkHex = spec.colours.ink.replace('#', '0x');
  const magentaHex = spec.colours.magenta.replace('#', '0x');
  const whiteHex = spec.colours.white.replace('#', '0x');

  const monoBold = escapeFilterPath(env.fonts.monoBold);
  const monoExtra = escapeFilterPath(env.fonts.monoExtraBold);
  const sansBold = escapeFilterPath(env.fonts.sansBold);

  const inputs = [];
  const chains = [];
  let inputIdx = 0;

  // Base 1080x1920 dark ink canvas
  inputs.push('-f', 'lavfi', '-i', `color=c=${inkHex}:s=${W}x${H}:r=${fps}:d=${durationSec}`);
  let baseLabel = `[${inputIdx}:v]format=rgba[bg0]`;
  chains.push(baseLabel);
  let cur = 'bg0';
  inputIdx++;

  // Optional atmospheric official press-pack background (softly dimmed to keep high text contrast)
  if (scene.background_asset && pack.assets[scene.background_asset]) {
    inputs.push('-framerate', String(fps), '-loop', '1', '-t', String(durationSec), '-i', pack.assets[scene.background_asset].path);
    const bgIdx = inputIdx++;
    chains.push(
      `[${bgIdx}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,eq=brightness=-0.34:saturation=0.85,format=rgba[envbg]`,
      `[${cur}][envbg]overlay=0:0[bg1]`,
      // Subtle dark scrim across text safe zone for ultra-crisp readability
      `[bg1]drawbox=x=0:y=0:w=${W}:h=${H}:color=${inkHex}@0.42:t=fill[bg2]`,
    );
    cur = 'bg2';
  }

  // Subtle magenta brand accent rail on the left margin inside the safe zone (x=120, y=444..780)
  chains.push(
    `[${cur}]drawbox=x=120:y=444:w=8:h=340:color=${magentaHex}:t=fill[accent0]`,
  );
  cur = 'accent0';

  // Official site screenshot framed cleanly inside safe zone (unmodified aspect ratio)
  if (scene.screenshot_asset && pack.assets[scene.screenshot_asset]) {
    inputs.push('-framerate', String(fps), '-loop', '1', '-t', String(durationSec), '-i', pack.assets[scene.screenshot_asset].path);
    const shotIdx = inputIdx++;
    const shotW = 656;
    const shotH = 410; // exact 2880x1800 -> 16:10 ratio = 656x410
    const shotX = 120;
    const shotY = 795;
    chains.push(
      `[${cur}]drawbox=x=${shotX - 5}:y=${shotY - 5}:w=${shotW + 10}:h=${shotH + 10}:color=${magentaHex}:t=fill[framebg]`,
      `[${shotIdx}:v]scale=${shotW}:${shotH}:flags=lanczos,format=rgba[shot]`,
      `[framebg][shot]overlay=x=${shotX}:y=${shotY}[withshot]`,
    );
    cur = 'withshot';
  }

  // Official mascot illustration (aspect ratio strictly preserved via scale=W:-1 or -1:H, never cropped or recoloured)
  if (scene.mascot_asset && pack.assets[scene.mascot_asset]) {
    inputs.push('-framerate', String(fps), '-loop', '1', '-t', String(durationSec), '-i', pack.assets[scene.mascot_asset].path);
    const mascotIdx = inputIdx++;

    let scaleExpr;
    let xExpr;
    let yExpr;
    if (scene.screenshot_asset) {
      // Companion mascot beside the lower-right corner of the screenshot, inside safe zone width
      scaleExpr = 'scale=220:-1:flags=lanczos';
      xExpr = '728';
      yExpr = '985+8*sin(2*PI*t/1.8)';
    } else if (scene.cta_pill) {
      // Hero celebratory ghost pile under CTA button
      scaleExpr = 'scale=-1:470:flags=lanczos';
      xExpr = '(W-w)/2';
      yExpr = '975+10*sin(2*PI*t/2.0)';
    } else {
      // Opening hero mascot centered clearly below headline
      scaleExpr = 'scale=500:-1:flags=lanczos';
      xExpr = '(W-w)/2';
      yExpr = '810+12*sin(2*PI*t/1.7)';
    }

    chains.push(
      `[${mascotIdx}:v]${scaleExpr},format=rgba[mascot]`,
      `[${cur}][mascot]overlay=x='${xExpr}':y='${yExpr}':shortest=1[withmascot]`,
    );
    cur = 'withmascot';
  }

  // Build kinetic text filters inside safe zone (x=148..950, y=444..1240, >= 44px below badge bottom y=400)
  const textOps = [];

  // Kicker pill (magenta fill + white mono bold label)
  if (scene.kicker) {
    const pillW = Math.min(540, Math.max(260, scene.kicker.length * 19 + 44));
    textOps.push(
      `drawbox=x=148:y=444:w=${pillW}:h=48:color=${magentaHex}:t=fill`,
      `drawtext=fontfile='${monoBold}':text='${escapeDrawtext(scene.kicker)}':fontsize=25:fontcolor=${whiteHex}:x=170:y=456`,
    );
  }

  // Headline lines (show full opening hook on frame 0 for strong TikTok cover thumbnail; stagger later scenes)
  const isOpeningScene = scene.start_s === 0;
  const headlineLines = scene.headline ?? [];
  headlineLines.forEach((line, idx) => {
    const yPos = 512 + idx * 74;
    const appear = isOpeningScene ? '0.00' : (idx * 0.12).toFixed(2);
    textOps.push(
      `drawtext=fontfile='${monoExtra}':text='${escapeDrawtext(line)}':fontsize=60:fontcolor=${whiteHex}:shadowcolor=${inkHex}@0.85:shadowx=3:shadowy=4:x=148:y=${yPos}:enable='gte(t,${appear})'`,
    );
  });

  // Subline lines (clear, high-contrast explanation of make.fun)
  const sublineLines = scene.subline ?? [];
  const subBaseY = 512 + headlineLines.length * 74 + 16;
  sublineLines.forEach((line, idx) => {
    const yPos = subBaseY + idx * 44;
    const appear = (isOpeningScene ? 0.16 + idx * 0.12 : 0.24 + idx * 0.12).toFixed(2);
    textOps.push(
      `drawtext=fontfile='${sansBold}':text='${escapeDrawtext(line)}':fontsize=33:fontcolor=${whiteHex}:shadowcolor=${inkHex}@0.8:shadowx=2:shadowy=3:x=148:y=${yPos}:enable='gte(t,${appear})'`,
    );
  });

  // Prominent CTA pill on the closing action scene
  if (scene.cta_pill) {
    const ctaX = 120;
    const ctaY = 815;
    const ctaW = 840;
    const ctaH = 98;
    textOps.push(
      `drawbox=x=${ctaX}:y=${ctaY}:w=${ctaW}:h=${ctaH}:color=${magentaHex}:t=fill:enable='gte(t,0.30)'`,
      `drawbox=x=${ctaX}:y=${ctaY}:w=${ctaW}:h=${ctaH}:color=${whiteHex}:t=4:enable='gte(t,0.30)'`,
      `drawtext=fontfile='${monoBold}':text='${escapeDrawtext(scene.cta_pill)}':fontsize=35:fontcolor=${whiteHex}:x=${ctaX}+(${ctaW}-text_w)/2:y=${ctaY}+(${ctaH}-text_h)/2:enable='gte(t,0.30)'`,
    );
  }

  // Safe-zone footer tag naming make.fun cleanly inside y <= 1248 on non-CTA scenes
  if (!scene.cta_pill) {
    textOps.push(
      `drawtext=fontfile='${monoBold}':text='make.fun  //  real bounties for AI agents':fontsize=22:fontcolor=${whiteHex}@0.90:x=120:y=1222`,
    );
  }

  chains.push(`[${cur}]${textOps.join(',')},format=yuv420p[vout]`);

  const exactFrames = Math.round(durationSec * fps);
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    ...inputs,
    '-filter_complex',
    chains.join(';'),
    '-map',
    '[vout]',
    '-frames:v',
    String(exactFrames),
    '-r',
    String(fps),
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-bf',
    '0',
    '-g',
    '60',
    '-crf',
    '16',
    '-pix_fmt',
    'yuv420p',
    outPath,
  ];
  runFfmpeg(args, `scene:${scene.id}`);
}

export async function renderAd(opts) {
  const env = checkEnvironment();
  const pack = await ensurePressPack(opts.assetsDir);
  const spec = getBrandSpec(pack.manifest);
  const script = JSON.parse(readFileSync(opts.scriptPath, 'utf8'));

  let refCode = opts.refCode;
  let isPreviewCode = false;
  if (!refCode) {
    if (opts.allowPreview) {
      refCode = '7k9m2p4x';
      isPreviewCode = true;
    } else {
      throw new Error(
        'Missing referral code. Pass --ref-code <8char> (or set MAKEFUN_REFERRAL_CODE) from https://make.fun/profile?tab=referrals, or pass --allow-preview for a local preview render.',
      );
    }
  }
  if (!REF_CODE_REGEX.test(refCode)) {
    throw new Error(
      `Invalid referral code "${refCode}": must be 8 characters from 0-9 and a-z excluding i, l, o, u.`,
    );
  }

  const workDir = resolve(opts.assetsDir, '..', 'render-tmp');
  mkdirSync(workDir, { recursive: true });
  mkdirSync(dirname(opts.outFile), { recursive: true });

  // 1. Synthesize original soundtrack WAV timed to the exact script
  const audioPath = resolve(workDir, 'soundtrack.wav');
  synthesizeAdAudio(script, audioPath);

  // 2. Render each scene clip at 1080x1920 60fps
  const sceneFiles = [];
  for (let i = 0; i < script.scenes.length; i++) {
    const scene = script.scenes[i];
    const isLast = i === script.scenes.length - 1;
    // Extend final scene's visual bed by end_card_duration_s so the transparent card blurs over live motion
    const segDur = isLast
      ? Number((scene.end_s - scene.start_s + spec.cardDurationSec).toFixed(3))
      : Number((scene.end_s - scene.start_s).toFixed(3));
    const segPath = resolve(workDir, `scene-${i}-${scene.id}.mp4`);
    renderSceneClip(scene, segDur, env, pack, spec, segPath);
    sceneFiles.push(segPath);
  }

  // 3. Concatenate scenes into clean base video track
  const concatListPath = resolve(workDir, 'concat.txt');
  writeFileSync(
    concatListPath,
    sceneFiles.map((p) => `file '${p.replaceAll("'", "'\\''")}'`).join('\n') + '\n',
  );
  const baseClipPath = resolve(workDir, 'base-clip.mp4');
  runFfmpeg(
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatListPath,
      '-c',
      'copy',
      baseClipPath,
    ],
    'concat-scenes',
  );

  // 4. Composite official 9:16 brand badge (from frame 0 until T) + official 9:16 transparent
  //    VP9 referral end card (from T to end) + blur/desat ease-in + JetBrains Mono Bold referral code
  //    following https://make.fun/press/llms.txt verbatim.
  const baseInfo = probeMedia(baseClipPath);
  const totalDur = Number.parseFloat(baseInfo.format.duration);
  const cardLen = spec.cardDurationSec;
  const cardRest = spec.cardRestSec;
  const T = Number((totalDur - cardLen).toFixed(3));
  const codeStart = Number((T + cardRest).toFixed(3));

  const badgePath = pack.assets['brand-badge/9x16/makefun-badge-9x16.png'].path;
  const cardPath = pack.assets['referral-card/9x16/makefun-card-9x16-transparent.webm'].path;
  const monoBold = escapeFilterPath(env.fonts.monoBold);

  const W = spec.frame.width;
  const H = spec.frame.height;
  const cover = spec.code.cover;
  const codeBox = spec.code.box;
  const centreY = spec.code.centre_y;
  const fontSize = spec.code.font_size_px;
  const codeColor = spec.code.colour.replace('#', '0x');

  const filterComplex = [
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=60[base]`,
    `[base][2:v]overlay=enable='lt(t,${T})',format=yuva420p,split[clip][soft]`,
    `[soft]gblur=sigma=28,eq=saturation=0.35,fade=t=in:st=${T}:d=0.8:alpha=1[soft]`,
    `[clip][soft]overlay[bg]`,
    `[1:v]format=yuva420p,setpts=PTS-STARTPTS+${T}/TB[card]`,
    `[bg][card]overlay=eof_action=pass,` +
      `drawbox=x=${cover.x}:y=${cover.y}:w=${cover.width}:h=${cover.height}:color=white:t=fill:enable='gte(t,${codeStart})',` +
      `drawtext=fontfile='${monoBold}':text='${escapeDrawtext(refCode)}':fontsize=${fontSize}:fontcolor=${codeColor}:x=${codeBox.x}:y=${centreY}-(ascent-descent)/2:enable='gte(t,${codeStart})'[v]`,
  ].join(';');

  runFfmpeg(
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      baseClipPath,
      '-c:v',
      'libvpx-vp9',
      '-i',
      cardPath,
      '-i',
      badgePath,
      '-i',
      audioPath,
      '-filter_complex',
      filterComplex,
      '-map',
      '[v]',
      '-map',
      '3:a',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '18',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-shortest',
      '-movflags',
      '+faststart',
      opts.outFile,
    ],
    'final-composite',
  );

  // 5. Extract inspection frames (first, scenes, last) for visual QA
  const framesDir = resolve(dirname(opts.outFile), 'inspect');
  const extractedFrames = {};
  if (opts.inspectFrames) {
    mkdirSync(framesDir, { recursive: true });
    const firstPng = resolve(framesDir, 'first.png');
    const lastPng = resolve(framesDir, 'last.png');
    runFfmpeg(
      ['-y', '-hide_banner', '-loglevel', 'error', '-i', opts.outFile, '-frames:v', '1', firstPng],
      'extract-first',
    );
    runFfmpeg(
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-sseof',
        '-0.1',
        '-i',
        opts.outFile,
        '-frames:v',
        '1',
        lastPng,
      ],
      'extract-last',
    );
    extractedFrames.first = firstPng;
    extractedFrames.last = lastPng;

    for (const scene of script.scenes) {
      const midT = Number(((scene.start_s + scene.end_s) / 2).toFixed(2));
      const p = resolve(framesDir, `scene-${scene.id}.png`);
      runFfmpeg(
        [
          '-y',
          '-hide_banner',
          '-loglevel',
          'error',
          '-ss',
          String(midT),
          '-i',
          opts.outFile,
          '-frames:v',
          '1',
          p,
        ],
        `extract-${scene.id}`,
      );
      extractedFrames[scene.id] = p;
    }
  }

  const finalProbe = probeMedia(opts.outFile);
  const vStream = finalProbe.streams.find((s) => s.codec_type === 'video');
  const aStream = finalProbe.streams.find((s) => s.codec_type === 'audio');

  return {
    status: 'ok',
    output_file: opts.outFile,
    referral_code: refCode,
    is_preview_code: isPreviewCode,
    press_pack_edition: pack.edition,
    card_start_s: T,
    code_reveal_s: codeStart,
    video: {
      codec: vStream?.codec_name,
      width: vStream?.width,
      height: vStream?.height,
      fps: vStream?.r_frame_rate,
      pix_fmt: vStream?.pix_fmt,
      duration_s: Number.parseFloat(finalProbe.format.duration),
      size_bytes: Number.parseInt(finalProbe.format.size, 10),
    },
    audio: {
      codec: aStream?.codec_name,
      sample_rate: Number.parseInt(aStream?.sample_rate ?? '0', 10),
      channels: aStream?.channels,
    },
    extracted_frames: extractedFrames,
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  const result = await renderAd(opts);
  if (result.is_preview_code) {
    console.error(
      '[WARNING] Rendered with preview referral code. Before posting to TikTok, re-render with your real make.fun referral code:\n' +
        '  node ad/render.mjs --ref-code <YOUR_8_CHAR_CODE>',
    );
  }
  console.log(JSON.stringify(result, null, 2));
}
