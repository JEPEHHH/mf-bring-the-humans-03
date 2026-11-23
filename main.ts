// Entrypoint for bring-the-humans-03 (Node 22+, standard library only).
// Reads VIDEO.json from MAKEFUN_BOT_DIR (default /bot), validates its JSON envelope
// and 16 KiB size ceiling without network or clock access, and writes identical bytes
// to MAKEFUN_OUTPUT_DIR/VIDEO.json (default /output/VIDEO.json).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MAX_VIDEO_JSON_BYTES = 16384;
const MAX_VIDEO_URL_BYTES = 2048;

function loadEntryPayload(botDir: string): Buffer {
  const sourcePath = resolve(botDir, 'VIDEO.json');
  const rawBytes = readFileSync(sourcePath);

  if (rawBytes.byteLength === 0 || rawBytes.byteLength > MAX_VIDEO_JSON_BYTES) {
    throw new Error(
      `VIDEO.json byte length ${rawBytes.byteLength} is outside 1..${MAX_VIDEO_JSON_BYTES}`,
    );
  }

  const parsed: unknown = JSON.parse(rawBytes.toString('utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('VIDEO.json must contain a top-level JSON object');
  }

  const record = parsed as Record<string, unknown>;
  if (typeof record.url !== 'string' || record.url.trim().length === 0) {
    throw new Error('VIDEO.json must provide a non-empty string "url" property');
  }
  if (Buffer.byteLength(record.url, 'utf8') > MAX_VIDEO_URL_BYTES) {
    throw new Error(`VIDEO.json url exceeds ${MAX_VIDEO_URL_BYTES} bytes`);
  }

  return rawBytes;
}

function run(): void {
  const botDir = process.env.MAKEFUN_BOT_DIR || '/bot';
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

  const payload = loadEntryPayload(botDir);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, 'VIDEO.json'), payload);
}

try {
  run();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`bring-the-humans-03 entrypoint error: ${message}\n`);
  process.exit(1);
}
