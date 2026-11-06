import {RuntimeError} from './errors.mjs';
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_TOTAL_BYTES = 16 * 1024 * 1024;
export const MAX_HTTP_BYTES = 24 * 1024 * 1024;
const invalid = message => { throw new RuntimeError(400, 'runtime/invalid-image', message); };
export function imageParts(attachments) {
  if (attachments === undefined) return [];
  if (!Array.isArray(attachments) || attachments.length > 4) invalid('attachments must contain at most four images');
  let total = 0;
  return attachments.map(a => {
    if (!a || typeof a !== 'object' || !['image', undefined].includes(a.type))
      throw new RuntimeError(415, 'runtime/files-unsupported', 'Arbitrary files require native upload receipts and are unsupported');
    const mediaType = a.media_type ?? a.mediaType ?? a.mime_type;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mediaType)) invalid('Unsupported image media type');
    const data = a.data ?? a.base64;
    if (typeof data !== 'string' || !data.length || data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data))
      invalid('Image data must be canonical base64 without a data URL prefix');
    const bytes = Buffer.from(data, 'base64'); total += bytes.length;
    if (bytes.length > MAX_IMAGE_BYTES || total > MAX_IMAGE_TOTAL_BYTES)
      throw new RuntimeError(413, 'runtime/image-too-large', 'Images exceed the bridge size limit');
    const matches = mediaType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : mediaType === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : mediaType === 'image/gif' ? /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))
      : bytes.subarray(0,4).toString('ascii') === 'RIFF' && bytes.subarray(8,12).toString('ascii') === 'WEBP';
    if (!matches || bytes.toString('base64') !== data) invalid('Image signature or base64 encoding is invalid');
    if (a.name !== undefined && (typeof a.name !== 'string' || a.name.length > 200 || /[/\\\x00-\x1f]/.test(a.name))) invalid('Image name must be a safe filename');
    return {type: 'image', mediaType, data, ...(a.name ? {name: a.name} : {})};
  });
}
export function safeAttachments(content) {
  return (content ?? []).filter(p => p?.type === 'image').map(p => {
    // Native DSH owns image bytes. Return only its opaque, nonsecret references.
    const ref = p.attachment ?? p.image ?? p;
    return {type: 'image', ...Object.fromEntries(['attachmentId', 'mediaType', 'bytes', 'width', 'height', 'name']
      .filter(k => ref[k] !== undefined).map(k => [k, ref[k]]))};
  });
}
