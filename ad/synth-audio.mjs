#!/usr/bin/env node
/**
 * Original PCM WAV soundtrack synthesizer for the make.fun vertical TikTok ad.
 * Zero external dependencies — generates an energetic 128 BPM electronic groove
 * with kick, snare, hi-hat, warm synth bass, bright arpeggio, scene transition
 * risers, and an uplifting resolve chord timed to the referral end card.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE_RATE = 48000;
const CHANNELS = 2;

function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Deterministic PRNG (Mulberry32) so audio rendering is 100% reproducible
function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function softClip(x) {
  return Math.tanh(x * 1.15);
}

function encodeWavStereo16(left, right, sampleRate = SAMPLE_RATE) {
  const numFrames = left.length;
  const dataBytes = numFrames * CHANNELS * 2;
  const buf = Buffer.alloc(44 + dataBytes);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20);  // PCM format
  buf.writeUInt16LE(CHANNELS, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * CHANNELS * 2, 28);
  buf.writeUInt16LE(CHANNELS * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    const l = Math.max(-1, Math.min(1, softClip(left[i])));
    const r = Math.max(-1, Math.min(1, softClip(right[i])));
    buf.writeInt16LE(Math.round(l * 32767), offset);
    buf.writeInt16LE(Math.round(r * 32767), offset + 2);
    offset += 4;
  }
  return buf;
}

export function synthesizeAdAudio(script, outputPath) {
  const durationSec = script.total_duration_s ?? 16.5;
  const bpm = script.bpm ?? 128;
  const beatSec = 60 / bpm;
  const stepSec = beatSec / 4; // 16th-note grid
  const totalFrames = Math.ceil(durationSec * SAMPLE_RATE);

  const left = new Float32Array(totalFrames);
  const right = new Float32Array(totalFrames);
  const rng = makeRng(20261123);

  // Progression in F# minor / A major (energetic upbeat tech vibe): F#m -> D -> A -> E
  const chords = [
    { bass: 42, notes: [54, 57, 61, 66] }, // F#m
    { bass: 38, notes: [50, 54, 57, 62] }, // D
    { bass: 45, notes: [57, 61, 64, 69] }, // A
    { bass: 40, notes: [52, 56, 59, 64] }, // E
  ];

  const transitionTimes = (script.scenes ?? [])
    .slice(1)
    .map((s) => s.start_s)
    .concat([script.content_duration_s ?? 14.0]);

  const endCardStart = script.content_duration_s ?? 14.0;

  // 1. Add punchy drums, bass, and melodic arpeggio across 16th-note steps
  const totalSteps = Math.floor(durationSec / stepSec);
  for (let step = 0; step < totalSteps; step++) {
    const t0 = step * stepSec;
    if (t0 >= durationSec) break;
    const bar = Math.floor(step / 16);
    const stepInBar = step % 16;
    const chord = chords[bar % chords.length];
    const inEndCard = t0 >= endCardStart;

    // Four-on-the-floor kick (stops cleanly on end card resolve except beat 0 hit)
    if (stepInBar % 4 === 0 && (!inEndCard || Math.abs(t0 - endCardStart) < stepSec)) {
      const kickDur = 0.22;
      const startIdx = Math.floor(t0 * SAMPLE_RATE);
      const len = Math.min(Math.floor(kickDur * SAMPLE_RATE), totalFrames - startIdx);
      let phase = 0;
      for (let i = 0; i < len; i++) {
        const dt = i / SAMPLE_RATE;
        const freq = 48 + 130 * Math.exp(-dt * 34);
        phase += (2 * Math.PI * freq) / SAMPLE_RATE;
        const env = Math.exp(-dt * 15) * (1 - Math.exp(-dt * 800));
        const sample = Math.sin(phase) * env * 0.42;
        left[startIdx + i] += sample;
        right[startIdx + i] += sample;
      }
    }

    // Crisp clap/snare on beats 2 and 4 during main ad
    if (!inEndCard && (stepInBar === 4 || stepInBar === 12)) {
      const snareDur = 0.14;
      const startIdx = Math.floor(t0 * SAMPLE_RATE);
      const len = Math.min(Math.floor(snareDur * SAMPLE_RATE), totalFrames - startIdx);
      for (let i = 0; i < len; i++) {
        const dt = i / SAMPLE_RATE;
        const env = Math.exp(-dt * 26);
        const body = Math.sin(2 * Math.PI * 195 * dt) * Math.exp(-dt * 42) * 0.18;
        const noise = (rng() * 2 - 1) * env * 0.18;
        left[startIdx + i] += (body + noise) * 0.95;
        right[startIdx + i] += (body + noise) * 1.05;
      }
    }

    // Off-beat hi-hat shimmer during main ad
    if (!inEndCard && stepInBar % 2 === 1) {
      const hatDur = stepInBar % 4 === 2 ? 0.075 : 0.04;
      const startIdx = Math.floor(t0 * SAMPLE_RATE);
      const len = Math.min(Math.floor(hatDur * SAMPLE_RATE), totalFrames - startIdx);
      const pan = stepInBar % 4 === 1 ? 0.35 : 0.65;
      let prev = 0;
      for (let i = 0; i < len; i++) {
        const dt = i / SAMPLE_RATE;
        const raw = rng() * 2 - 1;
        const hp = raw - prev * 0.85;
        prev = raw;
        const env = Math.exp(-dt * 55) * 0.085;
        left[startIdx + i] += hp * env * (1 - pan);
        right[startIdx + i] += hp * env * pan;
      }
    }

    // Driving octave synth bass on active groove steps
    const bassPattern = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 0];
    if (!inEndCard && bassPattern[stepInBar]) {
      const noteMidi = stepInBar % 8 === 6 ? chord.bass + 12 : chord.bass;
      const freq = midiToHz(noteMidi);
      const noteDur = stepSec * 1.45;
      const startIdx = Math.floor(t0 * SAMPLE_RATE);
      const len = Math.min(Math.floor(noteDur * SAMPLE_RATE), totalFrames - startIdx);
      for (let i = 0; i < len; i++) {
        const dt = i / SAMPLE_RATE;
        const env = Math.min(1, dt / 0.008) * Math.exp(-dt * 7.5);
        const saw = 2 * ((freq * dt) % 1) - 1;
        const sub = Math.sin(2 * Math.PI * freq * dt);
        const val = (sub * 0.65 + saw * 0.22) * env * 0.24;
        left[startIdx + i] += val;
        right[startIdx + i] += val;
      }
    }

    // Bright stereo arpeggio pluck
    if (!inEndCard && stepInBar % 2 === 0) {
      const arpIdx = (stepInBar / 2) % chord.notes.length;
      const octaveBoost = stepInBar >= 8 ? 12 : 0;
      const freq = midiToHz(chord.notes[arpIdx] + octaveBoost);
      const arpDur = stepSec * 1.8;
      const startIdx = Math.floor(t0 * SAMPLE_RATE);
      const len = Math.min(Math.floor(arpDur * SAMPLE_RATE), totalFrames - startIdx);
      const pan = 0.25 + 0.5 * ((stepInBar / 2) % 2);
      for (let i = 0; i < len; i++) {
        const dt = i / SAMPLE_RATE;
        const env = Math.min(1, dt / 0.004) * Math.exp(-dt * 9.5);
        const tone =
          Math.sin(2 * Math.PI * freq * dt) * 0.7 +
          Math.sin(2 * Math.PI * freq * 2 * dt) * 0.22 +
          Math.sin(2 * Math.PI * freq * 3 * dt) * 0.08;
        const val = tone * env * 0.14;
        left[startIdx + i] += val * (1 - pan * 0.5);
        right[startIdx + i] += val * (0.5 + pan * 0.5);
      }
    }
  }

  // 2. Scene transition risers + impact chimes
  for (const hitTime of transitionTimes) {
    const riserDur = 0.35;
    const riserStart = Math.max(0, hitTime - riserDur);
    const startIdx = Math.floor(riserStart * SAMPLE_RATE);
    const len = Math.min(Math.floor(riserDur * SAMPLE_RATE), totalFrames - startIdx);
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const u = i / Math.max(1, len - 1);
      const freq = 260 + 1100 * u * u;
      phase += (2 * Math.PI * freq) / SAMPLE_RATE;
      const env = u * u * 0.09;
      const val = (Math.sin(phase) * 0.6 + (rng() * 2 - 1) * 0.25) * env;
      left[startIdx + i] += val;
      right[startIdx + i] += val;
    }

    // Crisp bright accent chime right on the scene cut
    const chimeStart = Math.floor(hitTime * SAMPLE_RATE);
    const chimeLen = Math.min(Math.floor(0.45 * SAMPLE_RATE), totalFrames - chimeStart);
    const chimeFreq = hitTime >= endCardStart ? midiToHz(69) : midiToHz(73);
    for (let i = 0; i < chimeLen; i++) {
      const dt = i / SAMPLE_RATE;
      const env = Math.min(1, dt / 0.005) * Math.exp(-dt * 8.0);
      const sig =
        (Math.sin(2 * Math.PI * chimeFreq * dt) * 0.65 +
          Math.sin(2 * Math.PI * chimeFreq * 1.5 * dt) * 0.35) *
        env *
        0.16;
      left[chimeStart + i] += sig;
      right[chimeStart + i] += sig;
    }
  }

  // 3. Warm shimmering A-major resolve pad during the 2.5s referral end card
  const padStart = Math.floor(endCardStart * SAMPLE_RATE);
  const padNotes = [57, 61, 64, 69, 73];
  for (let i = padStart; i < totalFrames; i++) {
    const dt = (i - padStart) / SAMPLE_RATE;
    const rem = (totalFrames - i) / SAMPLE_RATE;
    const fadeIn = Math.min(1, dt / 0.18);
    const fadeOut = Math.min(1, rem / 0.45);
    const env = fadeIn * fadeOut * 0.12;
    let sumL = 0;
    let sumR = 0;
    for (let n = 0; n < padNotes.length; n++) {
      const f = midiToHz(padNotes[n]);
      sumL += Math.sin(2 * Math.PI * (f - 0.35) * dt);
      sumR += Math.sin(2 * Math.PI * (f + 0.35) * dt);
    }
    left[i] += (sumL / padNotes.length) * env;
    right[i] += (sumR / padNotes.length) * env;
  }

  // 4. Master fade-in (0.04s) and fade-out (0.25s) to prevent any click
  const fiFrames = Math.floor(0.04 * SAMPLE_RATE);
  const foFrames = Math.floor(0.25 * SAMPLE_RATE);
  for (let i = 0; i < fiFrames && i < totalFrames; i++) {
    const g = i / fiFrames;
    left[i] *= g;
    right[i] *= g;
  }
  for (let i = 0; i < foFrames && i < totalFrames; i++) {
    const idx = totalFrames - 1 - i;
    const g = i / foFrames;
    left[idx] *= g;
    right[idx] *= g;
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, encodeWavStereo16(left, right, SAMPLE_RATE));
  return { outputPath, durationSec, sampleRate: SAMPLE_RATE, channels: CHANNELS };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const scriptPath = resolve(__dirname, 'script.json');
  const script = JSON.parse(readFileSync(scriptPath, 'utf8'));
  const outWav = process.argv[2]
    ? resolve(process.argv[2])
    : resolve(__dirname, '..', '..', 'work-assets', 'audio', 'soundtrack.wav');
  const info = synthesizeAdAudio(script, outWav);
  console.log(JSON.stringify({ status: 'ok', ...info }, null, 2));
}
