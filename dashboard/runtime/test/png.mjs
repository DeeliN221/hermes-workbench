import {deflateSync} from 'node:zlib';
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1)); }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]); const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const check = Buffer.alloc(4); check.writeUInt32BE(crc(body)); return Buffer.concat([size, body, check]);
}
export function solidPng(red = 255, green = 0, blue = 0, size = 32) {
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  const raw = Buffer.alloc(size * (1 + 3 * size));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const at = y * (1 + 3 * size) + 1 + 3 * x; raw[at] = red; raw[at+1] = green; raw[at+2] = blue;
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
