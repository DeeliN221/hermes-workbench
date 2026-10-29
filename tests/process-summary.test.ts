import { describe, expect, it } from 'vitest';
import { ProcessSummary } from '../dashboard/src/process-summary';
import type { ProcessTiming } from '../dashboard/src/chat-process-messages';

const React = {
  createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => ({ type, props, children }),
  useState: <T,>(value: T): [T, (update: (value: T) => T) => void] => [value, () => undefined],
  useEffect: () => undefined,
};

function render(timing: ProcessTiming): unknown {
  return ProcessSummary({ React: React as never, timing });
}

function text(node: unknown): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(text);
  const row = node as { children?: unknown[] };
  return (row.children || []).flatMap(text);
}

function byClass(node: unknown, className: string): unknown[] {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return [];
  const row = node as { props?: { className?: string }; children?: unknown[] };
  return [
    ...(row.props?.className === className ? [node] : []),
    ...(row.children || []).flatMap(child => byClass(child, className)),
  ];
}

describe('response allowance summary', () => {
  it('shows only the remaining number for subscriptions, preferring the five-hour window', () => {
    const tree = render({ running: false, duration: 1000, completedAt: 1800000000000,
      quota: { kind: 'google', label: 'Claude', subscription: true, fiveHourRemaining: 0, weeklyRemaining: 47.2 } });
    expect(text(tree).join(' ')).toContain('0%');
    expect(text(tree).join(' ')).not.toContain('5h');
    expect(text(tree).join(' ')).not.toContain('Weekly');
  });

  it('shows the weekly remaining percentage when no five-hour window exists', () => {
    const tree = render({ running: false, duration: 1000, completedAt: 1800000000000,
      quota: { kind: 'google', label: 'Claude', subscription: true, weeklyRemaining: 47.2 } });
    expect(text(tree).join(' ')).toContain('47.2%');
    expect(text(tree).join(' ')).not.toContain('Weekly');
  });

  it('draws a simple dash for non-subscription models', () => {
    const tree = render({ running: false, duration: 1000, completedAt: 1800000000000 });
    expect(text(tree).join(' ')).toContain('—');
  });

  it('keeps the legacy weekly number for pre-upgrade turns', () => {
    const tree = render({ running: false, duration: 1000, completedAt: 1800000000000, weeklyRemainingPercent: 73 });
    expect(text(tree).join(' ')).toContain('73%');
    expect(text(tree).join(' ')).not.toContain('Weekly');
  });
});
