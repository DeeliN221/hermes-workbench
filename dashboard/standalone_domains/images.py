"""Bounded raster structure validation for canonical inline DSH image inputs."""

from __future__ import annotations

import struct
import zlib

from .core import fail
from .files import raster

MAX_IMAGE = 8 * 1024 * 1024
MAX_IMAGE_TOTAL = 16 * 1024 * 1024
MAX_IMAGES = 4


def image_media(data):
    mime = raster(data)
    if mime is None:
        fail(415, "Unsupported raster image; SVG and image impersonation are rejected")
    valid = False
    if mime == "image/png":
        position, header, pixels, ended = 8, False, False, False
        while position + 12 <= len(data):
            size = int.from_bytes(data[position : position + 4], "big")
            end = position + 12 + size
            if end > len(data):
                break
            kind = data[position + 4 : position + 8]
            value = data[position + 8 : position + 8 + size]
            crc = int.from_bytes(data[end - 4 : end], "big")
            if zlib.crc32(kind + value) & 0xFFFFFFFF != crc:
                break
            if not header:
                if kind != b"IHDR" or size != 13:
                    break
                width, height = struct.unpack(">II", value[:8])
                if (
                    not 0 < width <= 32768
                    or not 0 < height <= 32768
                    or width * height > 40_000_000
                ):
                    break
                header = True
            if kind == b"IDAT" and size:
                pixels = True
            position = end
            if kind == b"IEND":
                ended = size == 0 and end == len(data)
                break
        valid = header and pixels and ended
    elif mime == "image/jpeg":
        # Verify marker lengths, a bounded frame, a scan and end-of-image marker.
        pos, frame = 2, False
        while pos + 4 <= len(data) and data[pos] == 0xFF:
            marker = data[pos + 1]
            if marker == 0xDA:
                valid = frame and data.endswith(b"\xff\xd9")
                break
            size = int.from_bytes(data[pos + 2 : pos + 4], "big")
            if size < 2 or pos + 2 + size > len(data):
                break
            if marker in (0xC0, 0xC1, 0xC2):
                if size < 8:
                    break
                height, width = struct.unpack(">HH", data[pos + 5 : pos + 9])
                frame = 0 < width * height <= 40_000_000
            pos += 2 + size
    elif mime == "image/gif":
        if len(data) >= 14:
            width, height = struct.unpack("<HH", data[6:10])
            valid = (
                0 < width * height <= 40_000_000
                and b"\x2c" in data[13:]
                and data.endswith(b";")
            )
    elif mime == "image/webp":
        valid = (
            len(data) >= 30
            and int.from_bytes(data[4:8], "little") == len(data) - 8
            and data[12:16] in (b"VP8 ", b"VP8L", b"VP8X")
        )
    if not valid:
        fail(415, "Malformed raster image")
    return mime
