type ModelChoice = { id: string; label: string; isDefault: boolean };

/** Compare provider-qualified and versioned aliases without changing the chosen model ID. */
export function modelKey(value: string): string {
  let id = value.trim().toLowerCase().replace(/^@[^:]+:/, '');
  id = id.slice(id.lastIndexOf('/') + 1);
  return id.replace(/-v\d+(?:\.\d+)?(?=-|$)/g, '');
}

/** Keep only the Codex models exposed by this Workbench. */
export function filterCodexModels<T extends ModelChoice>(choices: T[]): T[] {
  return choices.filter(choice => {
    const id = choice.id.trim().toLowerCase();
    const model = id.slice(id.lastIndexOf('/') + 1);
    return /^gpt(?:[-.]|$)/.test(model) || modelKey(id) === 'deepseek-flash';
  });
}

/** Resolve the profile's Hermes setting against the live Codex model catalog. */
export function applyProfileModel<T extends ModelChoice>(choices: T[], config: unknown): T[] {
  const model = (config as { model?: string | { default?: string } } | null)?.model;
  const configured = (typeof model === 'string' ? model : model?.default)?.trim();
  if (!configured) return choices;
  const exact = choices.find(choice => choice.id.toLowerCase() === configured.toLowerCase());
  const match = exact || choices.find(choice => modelKey(choice.id) === modelKey(configured));
  // A stale profile must not make the whole model picker unusable. Fall back to
  // the catalog default (or its first model) until the profile is updated.
  const fallback = choices.find(choice => choice.isDefault) || choices[0];
  const selected = match || fallback;
  if (!selected) return choices;
  return choices.map(choice => ({ ...choice, isDefault: choice.id === selected.id }));
}

type ChatModelChoice = ModelChoice & {
  efforts: string[]; defaultEffort: string; supportsFast: boolean; fastServiceTier?: string;
};
type ProfileConfig = {
  agent?: { reasoning_effort?: string; reasoning_overrides?: Record<string, string>; service_tier?: string };
};
const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

/** Pick the available effort closest to the profile preference, preferring higher on a tie. */
export function closestEffort(preferred: string, efforts: string[]): string {
  if (!efforts.length || efforts.includes(preferred)) return preferred;
  const target = EFFORT_ORDER.indexOf(preferred);
  if (target < 0) return efforts[0];
  return [...efforts].sort((left, right) => {
    const leftDistance = Math.abs(EFFORT_ORDER.indexOf(left) - target);
    const rightDistance = Math.abs(EFFORT_ORDER.indexOf(right) - target);
    return leftDistance - rightDistance || EFFORT_ORDER.indexOf(right) - EFFORT_ORDER.indexOf(left);
  })[0];
}

/** Apply this profile's reasoning and response priority to the live model catalog. */
export function applyProfileChatDefaults<T extends ChatModelChoice>(choices: T[], config: unknown) {
  const agent = (config as ProfileConfig | null)?.agent;
  return applyProfileModel(choices, config).map(choice => {
    const override = Object.entries(agent?.reasoning_overrides || {})
      .find(([name]) => modelKey(name) === modelKey(choice.id))?.[1];
    const preferred = override || agent?.reasoning_effort || choice.defaultEffort || choice.efforts[0] || 'medium';
    const effort = closestEffort(preferred, choice.efforts);
    const fast = ['priority', 'fast'].includes(agent?.service_tier || '');
    return { ...choice, defaultEffort: effort, defaultFast: fast && !!choice.fastServiceTier };
  });
}
