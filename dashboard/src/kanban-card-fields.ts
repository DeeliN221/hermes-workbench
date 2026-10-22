import { uiText } from './ui-locale';
import {
  REVIEW_MODES,
  type CardDocument,
  type ReviewMode,
} from './kanban-card-schema';

type Options = {
  showReview?: boolean;
  compact?: boolean;
};

function field(label: string, control: HTMLElement, hint = ''): HTMLElement {
  const wrapper = document.createElement('label');
  wrapper.className = 'hti-card-schema-field';
  const title = document.createElement('span');
  title.className = 'hti-card-schema-label';
  title.textContent = label;
  wrapper.append(title, control);
  if (hint) {
    const note = document.createElement('small');
    note.className = 'hti-card-schema-hint';
    note.textContent = hint;
    wrapper.append(note);
  }
  return wrapper;
}

function textarea(value: string, rows: number, placeholder: string): HTMLTextAreaElement {
  const input = document.createElement('textarea');
  input.className = 'hti-card-schema-input';
  input.rows = rows;
  input.value = value;
  input.placeholder = placeholder;
  return input;
}

export function createCardFields(documentValue: CardDocument, options: Options = {}) {
  const root = document.createElement('div');
  root.className = 'hti-card-schema-fields' + (options.compact ? ' is-compact' : '');
  const meta = document.createElement('div');
  meta.className = 'hti-card-schema-meta';
  meta.textContent = uiText('卡片格式 standard@1', 'Card schema standard@1');
  root.append(meta);

  const background = textarea(documentValue.fields.background, options.compact ? 3 : 4,
    uiText('为什么做、现状、材料路径、已定决策和硬约束', 'Why now, current state, materials, decisions, hard constraints'));
  const output = textarea(documentValue.fields.output, options.compact ? 3 : 4,
    uiText('交付什么、放在哪里、格式和读者', 'What to deliver, where, format, and audience'));
  const acceptance = textarea(documentValue.fields.acceptance.join('\n'), 3,
    uiText('每行一条，最多 5 条；写可检查的结果', 'One per line, up to five measurable criteria'));
  const boundaries = textarea(documentValue.fields.boundaries.join('\n'), 2,
    uiText('每行一条；不做什么、何时停下来问', 'One per line; what not to do and when to stop'));
  root.append(
    field(uiText('背景', 'Background'), background),
    field(uiText('产出', 'Output'), output),
    field(uiText('验收', 'Acceptance'), acceptance, uiText('每行一条，最多 5 条', 'One per line, maximum five')),
    field(uiText('边界', 'Boundaries'), boundaries),
  );

  let reviewMode: HTMLSelectElement | null = null;
  let reviewer: HTMLInputElement | null = null;
  if (options.showReview !== false) {
    const review = document.createElement('div');
    review.className = 'hti-card-schema-review';
    reviewMode = document.createElement('select');
    reviewMode.className = 'hti-card-schema-input';
    for (const mode of REVIEW_MODES) {
      const option = document.createElement('option');
      option.value = mode;
      option.textContent = mode === 'auto' ? uiText('自动审查', 'Automatic review')
        : mode === 'human' ? uiText('人工验收', 'Human acceptance')
          : uiText('不审查', 'No review');
      reviewMode.append(option);
    }
    reviewMode.value = documentValue.reviewMode;
    reviewer = document.createElement('input');
    reviewer.className = 'hti-card-schema-input';
    reviewer.value = documentValue.reviewer;
    reviewer.placeholder = uiText('reviewer profile（留空沿用负责人）', 'reviewer profile (blank = assignee)');
    const syncReviewer = () => { reviewer!.disabled = reviewMode!.value !== 'auto'; };
    reviewMode.addEventListener('change', syncReviewer);
    syncReviewer();
    review.append(
      field(uiText('审查模式', 'Review mode'), reviewMode),
      field(uiText('Reviewer', 'Reviewer'), reviewer),
    );
    root.append(review);
  }

  const error = document.createElement('p');
  error.className = 'hti-card-schema-error';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  root.append(error);

  const read = (): CardDocument => ({
    schema: 'standard@1',
    reviewMode: (reviewMode?.value as ReviewMode) || documentValue.reviewMode,
    reviewer: reviewer?.value.trim() || '',
    fields: {
      background: background.value.trim(),
      output: output.value.trim(),
      acceptance: acceptance.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean),
      boundaries: boundaries.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean),
    },
  });

  const showErrors = (errors: string[]) => {
    error.hidden = errors.length === 0;
    error.textContent = errors.join(' · ');
  };

  return {
    root,
    read,
    showErrors,
    focus: () => background.focus({ preventScroll: false }),
    setBusy: (busy: boolean) => {
      for (const input of Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select'))) input.disabled = busy;
      if (!busy && reviewer && reviewMode) reviewer.disabled = reviewMode.value !== 'auto';
    },
  };
}
