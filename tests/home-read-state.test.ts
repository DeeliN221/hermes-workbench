// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activityVersion, cardIdentity, cardWasRead, markCardRead, readMarkers } from '../dashboard/src/home-read-state';
import { recentSessions } from '../dashboard/src/recent-home';

beforeEach(() => localStorage.clear());
const session = () => recentSessions([{ id: 'one', updatedAt: 100, lastCompletedSeq: 12 }], [], 'writer')[0];
describe('home read acknowledgement', () => {
  it('persists only the displayed activity and sends its exact profile and completed cursor', async () => {
    const row = session();
    const fetchJSON = vi.fn().mockResolvedValue({ readSeq: 12 });
    const markers = await markCardRead(fetchJSON, row);
    expect(fetchJSON).toHaveBeenCalledWith('/api/plugins/workbench/codex/session/read?profile=writer&session_id=one', expect.objectContaining({ method: 'POST', body: '{"readSeq":12}' }));
    expect(cardWasRead(row, readMarkers('writer'))).toBe(true);
    expect(cardWasRead({ ...row, completedSeq: 13 }, markers)).toBe(false);
    expect(cardWasRead({ ...row, updated: 101000 }, markers)).toBe(true);
    expect(cardWasRead({ ...row, profile: 'default' }, markers)).toBe(false);
    expect(markers[cardIdentity(row)]).toBe(activityVersion(row));
  });
  it('keeps legacy acknowledgements after metadata refresh and restores server reads', () => {
    const row = session();
    const markers = { [cardIdentity(row)]: JSON.stringify([row.updated, row.completedSeq, row.messageCount]) };
    expect(cardWasRead({ ...row, updated: row.updated + 1000 }, markers)).toBe(true);
    expect(cardWasRead({ ...row, completedSeq: 13 }, markers)).toBe(false);
    expect(cardWasRead({ ...row, readSeq: 12 }, {})).toBe(true);
    expect(cardWasRead({ ...row, readSeq: 12, completedSeq: 13 }, {})).toBe(false);
    expect(cardWasRead({ ...row, readSeq: 12, status: 'running' }, {})).toBe(false);
    expect(cardWasRead({ ...row, completedSeq: 0, readSeq: 0 }, {})).toBe(false);
  });
  it('keeps a failed acknowledgement visible and does not persist success', async () => {
    const row = session();
    await expect(markCardRead(vi.fn().mockRejectedValue(new Error('offline')), row)).rejects.toThrow('offline');
    expect(cardWasRead(row, readMarkers('writer'))).toBe(false);
  });
  it('persists Hermes read state without invoking the Codex endpoint', async () => {
    const row = recentSessions([], [{ id: 'history', updated_at: 100, message_count: 2 }], 'writer')[0];
    const fetchJSON = vi.fn();
    const markers = await markCardRead(fetchJSON, row);
    expect(fetchJSON).not.toHaveBeenCalled();
    expect(cardWasRead({ ...row, updated: row.updated + 5000 }, readMarkers('writer'))).toBe(true);
    expect(cardWasRead({ ...row, messageCount: 3 }, markers)).toBe(false);
  });
  it('omits non-openable Codex projections while retaining ordinary history', () => {
    const rows = recentSessions([{ id: 'same' }], [
      { id: 'same', source: 'codex' },
      { id: 'same', source: 'codex', profile: 'writer' },
      { id: 'ordinary', title: 'Same text' },
    ]);
    expect(rows.map(row => `${row.profile}:${row.source}:${row.id}`)).toEqual(expect.arrayContaining(['default:Codex:same', 'default:Hermes:ordinary']));
    expect(rows).toHaveLength(2);
  });
});
