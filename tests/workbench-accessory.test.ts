import { describe, expect, it } from 'vitest';
import {
  accessoryKind,
  accessoryPanelOpen,
  withAccessoryPanel,
  withoutAccessoryPanel,
} from '../dashboard/src/workbench-accessory';

describe('floating Workbench tabs', () => {
  it('opens only marked routes and keeps settings sub-pages in the same panel', () => {
    expect(accessoryPanelOpen('?panel=1')).toBe(true);
    expect(accessoryPanelOpen('?workbench=terminal')).toBe(false);
    expect(accessoryKind('/config', '?panel=1')).toBe('settings');
    expect(accessoryKind('/profiles', '?panel=1')).toBe('settings');
    expect(accessoryKind('/models', '?panel=1')).toBe('settings');
    expect(accessoryKind('/kanban', '?panel=1')).toBe('kanban');
    expect(accessoryKind('/cron', '?panel=1')).toBe('cron');
    expect(accessoryKind('/achievements', '?panel=1')).toBe('achievements');
    expect(accessoryKind('/chat', '?workbench=terminal&panel=1')).toBe('terminal');
    expect(accessoryKind('/chat', '?panel=1')).toBe('');
    expect(accessoryKind('/sessions', '?panel=1')).toBe('');
    expect(accessoryKind('/kanban', '')).toBe('');
  });

  it('preserves profile and session parameters when toggling the panel marker', () => {
    expect(withAccessoryPanel('/chat?session=abc&profile=writer'))
      .toBe('/chat?session=abc&profile=writer&panel=1');
    expect(withAccessoryPanel('/config?workbench=shortcuts&profile=default#general'))
      .toBe('/config?workbench=shortcuts&profile=default&panel=1#general');
    expect(withoutAccessoryPanel('/cron?panel=1&profile=default'))
      .toBe('/cron?profile=default');
    expect(withoutAccessoryPanel('/chat')).toBe('/chat');
  });
});
