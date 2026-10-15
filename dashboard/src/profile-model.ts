import { uiText as sourceText } from './ui-locale';
type ModelChoice = { id: string; label: string; isDefault: boolean };

/** Resolve the profile's Hermes setting against the live Codex model catalog. */
export function applyProfileModel<T extends ModelChoice>(choices: T[], config: unknown): T[] {
  const model = (config as { model?: string | { default?: string } } | null)?.model;
  const configured = (typeof model === 'string' ? model : model?.default)?.trim();
  if (!configured) return choices;
  const match = choices.find(choice => choice.id.toLowerCase() === configured.toLowerCase());
  if (!match) throw new Error(sourceText(`当前 profile 的默认模型 ${configured} 不在可用模型列表中`, `The current profile default model ${configured} is not in the available model list`));
  return choices.map(choice => ({ ...choice, isDefault: choice.id === match.id }));
}

type ChatModelChoice = ModelChoice & {
  efforts: string[]; defaultEffort: string; supportsFast: boolean; fastServiceTier?: string;
};
type ProfileConfig = {
  agent?: { reasoning_effort?: string; reasoning_overrides?: Record<string, string>; service_tier?: string };
};

/** Apply this profile's reasoning and response priority to the live model catalog. */
export function applyProfileChatDefaults<T extends ChatModelChoice>(choices: T[], config: unknown) {
  const agent = (config as ProfileConfig | null)?.agent;
  return applyProfileModel(choices, config).map(choice => {
    const override = Object.entries(agent?.reasoning_overrides || {})
      .find(([name]) => name.toLowerCase() === choice.id.toLowerCase())?.[1];
    const effort = override || agent?.reasoning_effort || choice.defaultEffort || choice.efforts[0] || 'medium';
    const fast = ['priority', 'fast'].includes(agent?.service_tier || '');
    if (choice.isDefault && choice.efforts.length && !choice.efforts.includes(effort)) {
      throw new Error(sourceText(`当前 profile 的思考深度 ${effort} 不适用于 ${choice.id}`, `The profile reasoning effort ${effort} is unavailable for ${choice.id}`));
    }
    if (choice.isDefault && fast && !choice.fastServiceTier) {
      throw new Error(sourceText(`当前 profile 要求优先响应，但 ${choice.id} 未提供此选项`, `The profile requests priority responses, but ${choice.id} does not offer this option`));
    }
    return { ...choice, defaultEffort: effort, defaultFast: fast && !!choice.fastServiceTier };
  });
}
