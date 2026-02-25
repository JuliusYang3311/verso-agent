import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const IMAGE_SIGNATURES = {
  JPG: [0xff, 0xd8, 0xff],
  PNG: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
} as const;

const MAX_IMAGE_SIZE = 2 * 1024 * 1024;

function detectImageFormat(buffer: Buffer): string {
  if (buffer.length >= IMAGE_SIGNATURES.PNG.length) {
    if (IMAGE_SIGNATURES.PNG.every((b, i) => buffer[i] === b)) return "PNG";
  }
  if (buffer.length >= IMAGE_SIGNATURES.JPG.length) {
    if (IMAGE_SIGNATURES.JPG.every((b, i) => buffer[i] === b)) return "JPG";
  }
  throw new Error("Unsupported image format. Only JPG and PNG are supported.");
}

export async function prepareImageForMsgItem(filePath: string): Promise<{
  base64: string;
  md5: string;
  format: string;
  size: number;
}> {
  const buffer = await readFile(filePath);
  if (buffer.length > MAX_IMAGE_SIZE) {
    throw new Error(`Image size ${(buffer.length / 1024 / 1024).toFixed(2)}MB exceeds 2MB limit`);
  }
  const format = detectImageFormat(buffer);
  return {
    base64: buffer.toString("base64"),
    md5: createHash("md5").update(buffer).digest("hex"),
    format,
    size: buffer.length,
  };
}
