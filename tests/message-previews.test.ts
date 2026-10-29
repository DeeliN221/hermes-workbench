import { describe, expect, it } from 'vitest';

import { applyMessagePreviews } from '../dashboard/src/message-previews';

describe('local message previews', () => {
  it('carries thumbnails from an optimistic request to its native snapshot', () => {
    const previous = [{ id: 'request', clientRequestId: 'request', attachments: [{ src: 'blob:preview' }] }];
    const incoming = [{ id: 'native', clientId: 'request', role: 'user' }];

    expect(applyMessagePreviews(previous, incoming)).toEqual([
      { id: 'native', clientId: 'request', role: 'user', attachments: [{ src: 'blob:preview' }] },
    ]);
  });

  it('leaves snapshots untouched when no local preview exists', () => {
    const incoming = [{ id: 'native', role: 'user' }];
    expect(applyMessagePreviews([], incoming)).toBe(incoming);
  });

  it('does not copy previews to unrelated messages', () => {
    const previous = [{ id: 'request', attachments: [{ src: 'blob:preview' }] }];
    const incoming = [{ id: 'other', role: 'user' }, { id: 'request', role: 'user' }];

    expect(applyMessagePreviews(previous, incoming)).toEqual([
      { id: 'other', role: 'user' },
      { id: 'request', role: 'user', attachments: [{ src: 'blob:preview' }] },
    ]);
  });
});
