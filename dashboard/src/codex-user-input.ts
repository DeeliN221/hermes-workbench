import { uiText } from './ui-locale';

export type UserQuestion = {
  id: string; header: string; question: string; isOther?: boolean; isSecret?: boolean;
  options?: Array<{ label: string; description?: string }> | null;
};
export type UserAnswers = Record<string, { answers: string[] }>;

export function createCodexUserInput(sdk: any) {
  const h = sdk.React.createElement;
  return function CodexUserInput({ questions, busy, onSubmit }: {
    questions: UserQuestion[]; busy: boolean; onSubmit: (answers: UserAnswers) => void;
  }) {
    const [values, setValues] = sdk.hooks.useState({} as Record<string, string>);
    const [custom, setCustom] = sdk.hooks.useState({} as Record<string, boolean>);
    const setAnswer = (id: string, value: string) => setValues((before: Record<string, string>) => ({ ...before, [id]: value }));
    const ready = questions.length > 0 && questions.every(q => values[q.id]?.trim());
    return h('form', { className: 'codex-user-input', 'aria-label': uiText('回答 Agent 的问题', 'Answer the agent’s questions'),
      onSubmit: (event: Event) => {
        event.preventDefault();
        if (busy || !ready) return;
        onSubmit(Object.fromEntries(questions.map(q => [q.id, { answers: [values[q.id]] }])));
      },
    }, h('div', { className: 'codex-user-input-heading' }, h('span', { className: 'codex-user-input-mark', 'aria-hidden': true }, '?'), h('strong', null, uiText('需要你的回答', 'Your answer is needed')), h('small', null, uiText('选择一项，或填写自己的回答', 'Choose an option or write your own answer'))),
    ...questions.map(q => h('fieldset', { key: q.id, disabled: busy },
      h('legend', null, q.header || q.question),
      q.header ? h('p', null, q.question) : null,
      ...(q.options || []).map((option, index) => h('label', { key: index, className: `codex-user-input-option${!custom[q.id] && values[q.id] === option.label ? ' is-selected' : ''}` },
        h('input', { type: 'radio', name: q.id, value: option.label, checked: !custom[q.id] && values[q.id] === option.label,
          onChange: () => { setCustom((before: Record<string, boolean>) => ({ ...before, [q.id]: false })); setAnswer(q.id, option.label); },
        }), h('span', null, h('strong', null, option.label), option.description && option.description.trim() !== option.label.trim() ? h('small', null, option.description) : null))),
      q.isOther || !q.options?.length ? h('label', { className: 'codex-user-input-free' },
        h('span', null, uiText('填写回答', 'Write an answer')),
        h('input', { type: q.isSecret ? 'password' : 'text', name: `${q.id}-answer`, autoComplete: 'off',
          value: custom[q.id] ? values[q.id] || '' : '',
          onChange: (event: any) => { setCustom((before: Record<string, boolean>) => ({ ...before, [q.id]: true })); setAnswer(q.id, event.target.value); },
        })) : null)),
    h('div', { className: 'codex-user-input-footer' }, h('small', { role: 'status' }, uiText(`已回答 ${questions.filter(q => values[q.id]?.trim()).length} / ${questions.length}`, `${questions.filter(q => values[q.id]?.trim()).length} / ${questions.length} answered`)), h('button', { type: 'submit', disabled: busy || !ready }, busy ? uiText('提交中…', 'Submitting…') : uiText('提交回答', 'Submit answers'))));
  };
}

/** Async app-server questions are message items, answered by a normal turn or steer. */
export function pendingAsyncQuestions(messages: Array<{ id: string; role?: string; status?: string; delivery?: string; questions?: unknown }>): { id: string; questions: UserQuestion[] } | null {
  const pending: UserQuestion[] = [];
  const ids: string[] = [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === 'user' && message.status !== 'failed') break;
    if (message.role !== 'assistant' || !Array.isArray(message.questions)) continue;
    const questions = message.questions.flatMap((value: any, number: number) => {
      if (!value || typeof value.title !== 'string' || !value.title.trim()) return [];
      return [{ id: `${message.id}:${number}`, header: '', question: value.title, isOther: true,
        options: Array.isArray(value.options) ? value.options.filter((option: unknown) => typeof option === 'string').map((label: string) => ({ label })) : null }];
    });
    if (questions.length) { pending.unshift(...questions); ids.unshift(message.id); }
  }
  return pending.length ? { id: ids.join('|'), questions: pending } : null;
}

export function formatQuestionAnswers(questions: UserQuestion[], answers: UserAnswers): string {
  return questions.map(q => `${q.question}\n${answers[q.id].answers.join('\n')}`).join('\n\n');
}

/** Display-only projection: retain the original question/answer payload for the agent. */
export function questionTranscript<T extends { id: string; role?: string; status?: string; content?: string; questions?: unknown }>(messages: T[]): T[] {
  const pending = new Set(pendingAsyncQuestions(messages)?.id.split('|') || []);
  let previousQuestions: UserQuestion[] = [];
  return messages.flatMap(message => {
    const structured = pendingAsyncQuestions([message]);
    if (structured) {
      previousQuestions.push(...structured.questions);
      let remainder = message.content || '';
      for (const q of structured.questions) {
        remainder = remainder.replace(q.question, '');
        const labels = new Set(q.options?.map(option => option.label.trim()) || []);
        remainder = remainder.split('\n').filter(line => !labels.has(line.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, ''))).join('\n');
      }
      remainder = remainder.trim();
      if (pending.has(message.id)) return remainder ? [{ ...message, content: remainder }] : [];
      // Preserve surrounding explanations; only remove known duplicate question/option text.
      return [{ ...message, content: [remainder, ...structured.questions.map(q => q.question)].filter(Boolean).join('\n\n') }];
    }
    if (message.role !== 'user') return [message];
    let content = message.content || '';
    // Only remove exact prefixes emitted by formatQuestionAnswers, never arbitrary prose.
    for (const q of previousQuestions) {
      const prefix = `${q.question}\n`;
      if (content.startsWith(prefix)) content = content.slice(prefix.length);
      else content = content.replace(`\n\n${prefix}`, '\n\n');
    }
    if (message.status !== 'failed') previousQuestions = [];
    return [{ ...message, content }];
  });
}
