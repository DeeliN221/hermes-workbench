import { describe, expect, it, vi } from 'vitest';
import { shouldSubmitComposerMessage } from '../dashboard/src/composer-command';

describe('composer command dispatch', () => {
  it('submits ordinary messages after a non-command result', async () => {
    const runCommand = vi.fn(async () => false);
    await expect(shouldSubmitComposerMessage('Explain this change', runCommand)).resolves.toBe(true);
    expect(runCommand).toHaveBeenCalledWith('Explain this change');
  });

  it('waits for an asynchronous command before suppressing model submission', async () => {
    let finish: (consumed: boolean) => void = () => {};
    const running = shouldSubmitComposerMessage('/goal status', () => new Promise(resolve => { finish = resolve; }));
    await Promise.resolve();
    finish(true);
    await expect(running).resolves.toBe(false);
  });

  it('allows attachment-only submissions without invoking the command handler', async () => {
    const runCommand = vi.fn(async () => true);
    await expect(shouldSubmitComposerMessage('', runCommand)).resolves.toBe(true);
    expect(runCommand).not.toHaveBeenCalled();
  });
});
