const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 3 * 1024 * 1024;
const MIN_IMAGE_DIMENSION = 80;

async function convertToWebp(input, { sharpImpl } = {}) {
  if (!Buffer.isBuffer(input) || input.length === 0) throw new TypeError('image body is required');
  if (input.length > MAX_SOURCE_BYTES) throw new RangeError('source image is too large');
  const sharp = sharpImpl || require('sharp');
  const image = sharp(input, { limitInputPixels: 40_000_000, sequentialRead: true });
  const metadata = await image.metadata();
  if (!Number.isSafeInteger(metadata.width) || !Number.isSafeInteger(metadata.height)
    || metadata.width < MIN_IMAGE_DIMENSION || metadata.height < MIN_IMAGE_DIMENSION) {
    throw Object.assign(new Error(`image dimensions must be at least ${MIN_IMAGE_DIMENSION}x${MIN_IMAGE_DIMENSION}`), {
      code: 'image_too_small',
    });
  }
  const output = await image
    .rotate()
    .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();
  if (!Buffer.isBuffer(output) || output.length === 0) throw new Error('WebP conversion returned an empty image');
  if (output.length > MAX_OUTPUT_BYTES) throw new RangeError('converted WebP image is too large');
  return output;
}

module.exports = { convertToWebp, MAX_SOURCE_BYTES, MAX_OUTPUT_BYTES, MIN_IMAGE_DIMENSION };
