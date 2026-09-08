const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 3 * 1024 * 1024;

async function convertToWebp(input, { sharpImpl } = {}) {
  if (!Buffer.isBuffer(input) || input.length === 0) throw new TypeError('image body is required');
  if (input.length > MAX_SOURCE_BYTES) throw new RangeError('source image is too large');
  const sharp = sharpImpl || require('sharp');
  const output = await sharp(input, { limitInputPixels: 40_000_000, sequentialRead: true })
    .rotate()
    .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();
  if (!Buffer.isBuffer(output) || output.length === 0) throw new Error('WebP conversion returned an empty image');
  if (output.length > MAX_OUTPUT_BYTES) throw new RangeError('converted WebP image is too large');
  return output;
}

module.exports = { convertToWebp, MAX_SOURCE_BYTES, MAX_OUTPUT_BYTES };
