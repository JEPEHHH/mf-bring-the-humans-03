#!/usr/bin/env node
/**
 * Automated quality & brand-compliance verifier for the rendered 9:16 TikTok ad.
 * Checks technical video/audio specs via ffprobe and samples pixel regions on
 * frame 0 (first.png) and the final frame (last.png) to confirm:
 * - Exact 1080x1920 60fps H.264 yuv420p video + 48kHz stereo AAC audio
 * - Brand badge magenta pill present in the official 9:16 box on frame 0
 * - Referral end card magenta wash + white referral field + dark ink referral text on last frame
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_OUT_DIR } from './render.mjs';

function ffprobeJson(videoPath) {
  const res = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', videoPath],
    { encoding: 'utf8' },
  );
  if (res.status !== 0) {
    throw new Error(`ffprobe failed: ${res.stderr}`);
  }
  return JSON.parse(res.stdout);
}

/**
 * Sample average RGB inside a rectangular region of an image using ffmpeg rawvideo rgb24.
 */
function sampleRegionRgb(imagePath, x, y, w, h) {
  const res = spawnSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      imagePath,
      '-vf',
      `crop=${w}:${h}:${x}:${y}`,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    ],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  if (res.status !== 0) {
    throw new Error(`ffmpeg crop failed on ${imagePath}: ${res.stderr?.toString()}`);
  }
  const buf = res.stdout;
  const pixels = buf.length / 3;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let darkPixels = 0;
  let magentaPixels = 0;
  let whitePixels = 0;

  for (let i = 0; i < buf.length; i += 3) {
    const r = buf[i];
    const g = buf[i + 1];
    const b = buf[i + 2];
    rSum += r;
    gSum += g;
    bSum += b;
    if (r < 65 && g < 65 && b < 65) darkPixels++;
    if (r > 150 && g < 75 && b > 90) magentaPixels++;
    if (r > 235 && g > 235 && b > 235) whitePixels++;
  }

  return {
    pixels,
    avgRgb: [Math.round(rSum / pixels), Math.round(gSum / pixels), Math.round(bSum / pixels)],
    darkShare: Number((darkPixels / pixels).toFixed(4)),
    magentaShare: Number((magentaPixels / pixels).toFixed(4)),
    whiteShare: Number((whitePixels / pixels).toFixed(4)),
  };
}

export function verifyRenderedVideo(videoPath) {
  if (!existsSync(videoPath)) {
    throw new Error(`Rendered video not found at ${videoPath}`);
  }
  const inspectDir = resolve(videoPath, '..', 'inspect');
  const firstPng = resolve(inspectDir, 'first.png');
  const lastPng = resolve(inspectDir, 'last.png');
  if (!existsSync(firstPng) || !existsSync(lastPng)) {
    throw new Error(`Missing inspection frames first.png / last.png in ${inspectDir}`);
  }

  const probe = ffprobeJson(videoPath);
  const v = probe.streams.find((s) => s.codec_type === 'video');
  const a = probe.streams.find((s) => s.codec_type === 'audio');
  const duration = Number.parseFloat(probe.format.duration);

  const checks = [];
  const addCheck = (name, ok, detail) => checks.push({ name, pass: Boolean(ok), detail });

  addCheck('video_codec', v?.codec_name === 'h264', `codec=${v?.codec_name}`);
  addCheck('video_resolution_9x16', v?.width === 1080 && v?.height === 1920, `${v?.width}x${v?.height}`);
  addCheck('video_fps_60', v?.r_frame_rate === '60/1', `fps=${v?.r_frame_rate}`);
  addCheck('video_pix_fmt', v?.pix_fmt === 'yuv420p', `pix_fmt=${v?.pix_fmt}`);
  addCheck('duration_exact', duration >= 16.45 && duration <= 16.55, `duration=${duration.toFixed(3)}s`);
  addCheck(
    'audio_aac_stereo_48k',
    a?.codec_name === 'aac' && Number(a?.sample_rate) === 48000 && a?.channels === 2,
    `${a?.codec_name} ${a?.sample_rate}Hz ch=${a?.channels}`,
  );

  // Frame 0: official brand badge sits at x=120, y=272, w=330, h=128
  const firstBadge = sampleRegionRgb(firstPng, 120, 272, 330, 128);
  addCheck(
    'first_frame_brand_badge_present',
    firstBadge.magentaShare >= 0.45 && firstBadge.whiteShare >= 0.12,
    `magentaShare=${firstBadge.magentaShare}, whiteShare=${firstBadge.whiteShare}`,
  );

  // Last frame: top-left badge region should now be magenta wash (no white pill border), not the badge
  const lastTopCorner = sampleRegionRgb(lastPng, 120, 272, 330, 128);
  addCheck(
    'last_frame_brand_badge_hidden',
    lastTopCorner.magentaShare >= 0.85 && lastTopCorner.whiteShare < 0.02,
    `magentaShare=${lastTopCorner.magentaShare}, whiteShare=${lastTopCorner.whiteShare}`,
  );

  // Last frame: referral code box (x=210, y=1232, w=320, h=78) should be white field with dark ink glyphs
  const lastCodeBox = sampleRegionRgb(lastPng, 210, 1232, 320, 78);
  addCheck(
    'last_frame_referral_code_rendered',
    lastCodeBox.whiteShare >= 0.65 && lastCodeBox.darkShare >= 0.06,
    `whiteShare=${lastCodeBox.whiteShare}, darkShare=${lastCodeBox.darkShare}`,
  );

  const allPassed = checks.every((c) => c.pass);
  return {
    status: allPassed ? 'pass' : 'fail',
    videoPath,
    checks,
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const target = process.argv[2] ? resolve(process.argv[2]) : resolve(DEFAULT_OUT_DIR, 'ad.mp4');
  const report = verifyRenderedVideo(target);
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'pass') {
    process.exit(1);
  }
}
