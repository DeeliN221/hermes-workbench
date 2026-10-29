/** Subscription allowance captured when one response completed. */
export interface ResponseQuota {
  kind: 'openai' | 'google';
  label: string;
  subscription?: boolean;
  fiveHourRemaining?: number;
  weeklyRemaining?: number;
  fiveHourResetAt?: number;
  weeklyResetAt?: number;
  model?: string;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function normalizeResponseQuota(value: unknown): ResponseQuota | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>, kind = row.kind;
  if (kind !== 'openai' && kind !== 'google') return undefined;
  const label = typeof row.label === 'string' && row.label.trim() ? row.label.trim() : kind === 'google' ? 'Google' : 'Codex';
  return {
    kind, label, subscription: row.subscription !== false,
    fiveHourRemaining: finiteNumber(row.fiveHourRemaining),
    weeklyRemaining: finiteNumber(row.weeklyRemaining),
    fiveHourResetAt: finiteNumber(row.fiveHourResetAt),
    weeklyResetAt: finiteNumber(row.weeklyResetAt),
    model: typeof row.model === 'string' && row.model.trim() ? row.model.trim() : undefined,
  };
}
