import { generateImage } from "../intelligence/ai";
import type { StoryDraft } from "../types";

export interface CoverArtifact {
  reference: string;
  mimeType: "image/png";
  bytes: ArrayBuffer;
}

/**
 * Create a cover in memory. AI image bytes are uploaded directly to Telegram;
 * the deterministic PNG is the fail-closed fallback and needs no object storage.
 */
export async function createCover(env: Env, story: StoryDraft): Promise<CoverArtifact> {
  const prompt = `Editorial illustration, not documentary photography. Radar news identity. Category: ${story.category}. Concept: ${story.coverConcept}. No readable text. Symbolic, restrained, high contrast, Persian news channel cover.`;
  const generated = await generateImage(env, prompt);
  if (generated) {
    return {
      reference: `ai-generated:events/${story.eventId}/v${story.eventVersion}`,
      mimeType: "image/png",
      bytes: generated
    };
  }
  return createDeterministicCover(story);
}

export function createDeterministicCover(story: StoryDraft): CoverArtifact {
  return {
    reference: `deterministic-png:events/${story.eventId}/v${story.eventVersion}`,
    mimeType: "image/png",
    bytes: brandedPng(story)
  };
}

function brandedPng(story: StoryDraft): ArrayBuffer {
  const width = 640;
  const height = 360;
  const pixels = new Uint8Array(height * (width * 4 + 1));
  const categorySeed = Array.from(story.category).reduce((sum, character) => sum + character.charCodeAt(0), 0);
  let offset = 0;

  for (let y = 0; y < height; y += 1) {
    pixels[offset++] = 0;
    for (let x = 0; x < width; x += 1) {
      const diagonal = (x + y * 2 + categorySeed) % 180 < 3;
      const grid = x % 80 === 0 || y % 60 === 0;
      const dx = x - 508;
      const dy = y - 88;
      const radius = Math.sqrt(dx * dx + dy * dy);
      const ring = Math.abs(radius - 118) < 2 || Math.abs(radius - 154) < 2 || Math.abs(radius - 190) < 2;
      const wave = y > 245 && y < 330 && ((x + y * 3) % 127 < 4);
      if (ring || diagonal) {
        pixels[offset++] = 111; pixels[offset++] = 140; pixels[offset++] = 255; pixels[offset++] = 220;
      } else if (wave) {
        pixels[offset++] = 120; pixels[offset++] = 214; pixels[offset++] = 165; pixels[offset++] = 210;
      } else if (grid) {
        pixels[offset++] = 43; pixels[offset++] = 54; pixels[offset++] = 65; pixels[offset++] = 150;
      } else {
        pixels[offset++] = 11; pixels[offset++] = 16; pixels[offset++] = 22; pixels[offset++] = 255;
      }
    }
  }

  const compressed = deflateStored(pixels);
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = new Uint8Array(13);
  writeUint32(header, 0, width);
  writeUint32(header, 4, height);
  header[8] = 8;
  header[9] = 6;
  const chunks = [pngChunk("IHDR", header), pngChunk("IDAT", compressed), pngChunk("IEND", new Uint8Array())];
  const totalLength = signature.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(totalLength);
  output.set(signature, 0);
  let outputOffset = signature.length;
  for (const chunk of chunks) {
    output.set(chunk, outputOffset);
    outputOffset += chunk.length;
  }
  return output.buffer;
}

function deflateStored(data: Uint8Array): Uint8Array {
  const blockCount = Math.ceil(data.length / 65_535);
  const output = new Uint8Array(2 + data.length + blockCount * 5 + 4);
  output[0] = 0x78;
  output[1] = 0x01;
  let outputOffset = 2;
  for (let block = 0; block < blockCount; block += 1) {
    const start = block * 65_535;
    const length = Math.min(65_535, data.length - start);
    const finalBlock = block === blockCount - 1;
    output[outputOffset++] = finalBlock ? 1 : 0;
    output[outputOffset++] = length & 0xff;
    output[outputOffset++] = (length >>> 8) & 0xff;
    const inverse = (~length) & 0xffff;
    output[outputOffset++] = inverse & 0xff;
    output[outputOffset++] = (inverse >>> 8) & 0xff;
    output.set(data.subarray(start, start + length), outputOffset);
    outputOffset += length;
  }
  writeUint32(output, outputOffset, adler32(data));
  return output;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const output = new Uint8Array(12 + data.length);
  writeUint32(output, 0, data.length);
  for (let index = 0; index < 4; index += 1) output[4 + index] = type.charCodeAt(index);
  output.set(data, 8);
  writeUint32(output, 8 + data.length, crc32(output.subarray(4, 8 + data.length)));
  return output;
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65_521;
    b = (b + a) % 65_521;
  }
  return ((b << 16) | a) >>> 0;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
