import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ACCEPTED = new Set(['jpeg', 'png', 'webp', 'gif', 'avif']);
const MAX_EDGE = 1600;
const TARGET_BYTES = 150 * 1024;
const MIN_EDGE = 200;
const MAX_PIXELS = 24_000_000;

// Small server: one libvips thread, no operation cache (memory is held per cached image).
sharp.concurrency(1);
sharp.cache(false);

export class UnsupportedImageError extends Error {}
export class ImageTooLargeError extends Error {}

export interface UploadResult {
  url: string;
  width: number;
  height: number;
  bytes: number;
}

/**
 * Re-encodes an image as WebP (longest edge ≤ 1600, ≤ 150 KB: quality 80→50, then smaller dimensions; metadata stripped)
 * and stores it under uploadsDir by content hash. The type is taken from the decoded data, not the file name.
 */
export async function storeImage(uploadsDir: string, input: Buffer): Promise<UploadResult> {
  let format: string | undefined;
  let pixels = 0;
  try {
    // metadata() reads only the header. It throws on the pixel limit for most formats; the explicit check covers the rest.
    const meta = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata();
    pixels = (meta.width ?? 0) * (meta.height ?? 0);
    // libvips reports AVIF as heif; the compression tells AVIF apart from HEIC.
    format = meta.format === 'heif' ? (meta.compression === 'av1' ? 'avif' : 'heic') : meta.format;
  } catch (err) {
    if (err instanceof Error && /pixel limit/i.test(err.message)) throw new ImageTooLargeError();
    throw new UnsupportedImageError();
  }
  if (!format || !ACCEPTED.has(format)) throw new UnsupportedImageError();
  if (pixels > MAX_PIXELS) throw new ImageTooLargeError();

  // rotate() bakes EXIF orientation in; sharp drops all metadata unless keepMetadata/withMetadata is used.
  const encode = (edge: number, quality: number) =>
    sharp(input, { limitInputPixels: MAX_PIXELS, animated: false })
      .rotate()
      .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
      .webp({ quality, effort: 4 })
      .toBuffer({ resolveWithObject: true })
      .catch(() => {
        throw new UnsupportedImageError();
      });
  let { data, info } = await encode(MAX_EDGE, 80);
  for (let q = 70; q >= 50 && data.length > TARGET_BYTES; q -= 10) ({ data, info } = await encode(MAX_EDGE, q));
  // Very detailed images can stay over budget at quality 50; shrink them until they fit.
  for (let edge = Math.round(Math.max(info.width, info.height) * 0.8); edge >= MIN_EDGE && data.length > TARGET_BYTES; edge = Math.round(edge * 0.8)) {
    ({ data, info } = await encode(edge, 50));
  }

  const name = `${crypto.createHash('sha256').update(data).digest('hex').slice(0, 16)}.webp`;
  await fs.mkdir(uploadsDir, { recursive: true, mode: 0o755 });
  await fs.chmod(uploadsDir, 0o755);
  const file = path.join(uploadsDir, name);
  const exists = await fs.stat(file).then(
    () => true,
    () => false,
  );
  if (!exists) {
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(tmp, data, { mode: 0o644 });
    await fs.chmod(tmp, 0o644);
    await fs.rename(tmp, file);
  }
  return { url: `/uploads/${name}`, width: info.width, height: info.height, bytes: data.length };
}
