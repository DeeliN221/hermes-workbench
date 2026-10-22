import { uiText } from './ui-locale';

export type ReviewMode = 'none' | 'auto' | 'human';

export type CardFields = {
  background: string;
  output: string;
  acceptance: string[];
  boundaries: string[];
};

export type CardDocument = {
  schema: 'standard@1';
  reviewMode: ReviewMode;
  reviewer: string;
  fields: CardFields;
};

export const CARD_SCHEMA_ID = 'standard@1';
export const REVIEW_MODES: ReviewMode[] = ['auto', 'human', 'none'];

const MARKER = /^<!--\s*workbench-card:\s*(\{.*\})\s*-->\s*$/i;
const HEADINGS = {
  background: ['背景', 'Background'],
  output: ['产出', 'Output', 'Deliverable'],
  acceptance: ['验收', 'Acceptance'],
  boundaries: ['边界', 'Boundaries'],
} as const;

function emptyFields(): CardFields {
  return { background: '', output: '', acceptance: [], boundaries: [] };
}

export function emptyCardDocument(): CardDocument {
  return { schema: CARD_SCHEMA_ID, reviewMode: 'auto', reviewer: '', fields: emptyFields() };
}

function lines(value: string): string[] {
  return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function headingKey(value: string): keyof CardFields | null {
  const text = value.trim();
  for (const [key, names] of Object.entries(HEADINGS) as Array<[keyof CardFields, readonly string[]]>) {
    if (names.includes(text)) return key;
  }
  return null;
}

/** Parse the canonical Workbench card body; legacy freeform text returns null. */
export function parseCardDocument(body: string): CardDocument | null {
  const source = String(body || '').replace(/\r\n/g, '\n');
  const rows = source.split('\n');
  const markerIndex = rows.findIndex(row => MARKER.test(row.trim()));
  if (markerIndex < 0) return null;
  let meta: any;
  try {
    meta = JSON.parse(rows[markerIndex].trim().match(MARKER)?.[1] || '{}');
  } catch {
    return null;
  }
  if (meta.schema !== CARD_SCHEMA_ID) return null;
  const reviewMode: ReviewMode = REVIEW_MODES.includes(meta.review_mode) ? meta.review_mode : 'auto';
  const sections: Partial<Record<keyof CardFields, string[]>> = {};
  let current: keyof CardFields | null = null;
  for (const row of rows.slice(markerIndex + 1)) {
    const heading = row.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = headingKey(heading[1]);
      if (current) sections[current] = [];
      continue;
    }
    if (current) sections[current]!.push(row);
  }
  const section = (key: keyof CardFields) => (sections[key] || []).join('\n').trim();
  const list = (key: 'acceptance' | 'boundaries') => lines(section(key)).map(line =>
    line.replace(/^[-*]\s*(?:\[\s*[xX ]\s*\]\s*)?/, '').trim()).filter(Boolean);
  return {
    schema: CARD_SCHEMA_ID,
    reviewMode,
    reviewer: typeof meta.reviewer === 'string' ? meta.reviewer.trim() : '',
    fields: {
      background: section('background'),
      output: section('output'),
      acceptance: list('acceptance'),
      boundaries: list('boundaries'),
    },
  };
}

/** Read a card for editing; legacy text is preserved as background until saved. */
export function cardDocumentFromBody(body: string): CardDocument {
  return parseCardDocument(body) || {
    ...emptyCardDocument(),
    fields: { ...emptyFields(), background: String(body || '').trim() },
  };
}

function reviewLine(doc: CardDocument): string {
  if (doc.reviewMode === 'none') {
    return uiText(
      '> 审查策略：none。实现完成后直接完成，不请求自动审查。',
      '> Review policy: none. Complete directly after implementation; do not request review.',
    );
  }
  if (doc.reviewMode === 'human') {
    return uiText(
      '> 审查策略：human。实现完成后以 needs_input 阻塞，等待人工验收；不要请求自动审查。',
      '> Review policy: human. After implementation, block with kind=needs_input for human acceptance; do not request automatic review.',
    );
  }
  const reviewer = doc.reviewer || uiText('当前负责人', 'current assignee');
  return uiText(
    `> 审查策略：auto；reviewer：${reviewer}。实现完成后请求同卡审查。`,
    `> Review policy: auto; reviewer: ${reviewer}. Request same-card review after implementation.`,
  );
}

export function renderCardDocument(doc: CardDocument): string {
  const marker = JSON.stringify({ schema: CARD_SCHEMA_ID, review_mode: doc.reviewMode, reviewer: doc.reviewer });
  const h = (zh: string, en: string) => `## ${uiText(zh, en)}`;
  const list = (items: string[], checkbox = false) => items.map(item => checkbox ? `- [ ] ${item}` : `- ${item}`).join('\n');
  return [
    `<!-- workbench-card: ${marker} -->`,
    reviewLine(doc),
    h('背景', 'Background'),
    doc.fields.background.trim(),
    h('产出', 'Output'),
    doc.fields.output.trim(),
    h('验收', 'Acceptance'),
    list(doc.fields.acceptance, true),
    h('边界', 'Boundaries'),
    list(doc.fields.boundaries),
  ].join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function validateCardDocument(doc: CardDocument): string[] {
  const errors: string[] = [];
  if (!doc.fields.background.trim()) errors.push(uiText('请填写背景', 'Background is required'));
  if (!doc.fields.output.trim()) errors.push(uiText('请填写产出', 'Output is required'));
  if (!doc.fields.acceptance.length) errors.push(uiText('请至少填写一条验收标准', 'Add at least one acceptance criterion'));
  if (doc.fields.acceptance.length > 5) errors.push(uiText('验收标准最多 5 条', 'Use at most five acceptance criteria'));
  if (!doc.fields.boundaries.length) errors.push(uiText('请至少填写一条边界', 'Add at least one boundary'));
  if (!REVIEW_MODES.includes(doc.reviewMode)) errors.push(uiText('审查模式无效', 'Invalid review mode'));
  return errors;
}
