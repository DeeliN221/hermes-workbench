import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cardDocumentFromBody,
  emptyCardDocument,
  parseCardDocument,
  renderCardDocument,
  validateCardDocument,
} from '../dashboard/src/kanban-card-schema';

const doc = {
  schema: 'standard@1' as const,
  reviewMode: 'auto' as const,
  reviewer: 'reviewer',
  fields: {
    background: 'The current card form is freeform.',
    output: 'A structured card editor.',
    acceptance: ['Fields render separately', 'The generated body stays readable'],
    boundaries: ['Do not change task status'],
  },
};

describe('Workbench card schema', () => {
  it('round-trips the canonical fields and review metadata', () => {
    const body = renderCardDocument(doc);
    expect(body).toContain('<!-- workbench-card:');
    expect(body).toContain('Review policy: auto');
    expect(parseCardDocument(body)).toEqual(doc);
  });

  it('ignores legacy freeform cards and preserves them as background', () => {
    const legacy = 'A freeform description\n\nwith two paragraphs.';
    expect(parseCardDocument(legacy)).toBeNull();
    const imported = cardDocumentFromBody(legacy);
    expect(imported.fields.background).toBe(legacy);
    expect(imported.reviewMode).toBe('auto');
  });

  it('accepts localized headings', () => {
    const body = [
      '<!-- workbench-card: {"schema":"standard@1","review_mode":"human","reviewer":""} -->',
      '## 背景', '现状', '## 产出', '结果', '## 验收', '- [ ] 第一条', '- 第二条', '## 边界', '- 不改状态',
    ].join('\n');
    expect(parseCardDocument(body)).toMatchObject({
      reviewMode: 'human',
      fields: { acceptance: ['第一条', '第二条'], boundaries: ['不改状态'] },
    });
  });

  it('reports missing and oversized fixed fields', () => {
    const errors = validateCardDocument({
      ...emptyCardDocument(),
      fields: { background: '', output: '', acceptance: ['1', '2', '3', '4', '5', '6'], boundaries: [] },
    });
    expect(errors).toHaveLength(4);
    expect(errors.join(' ')).toContain('Background');
    expect(errors.join(' ')).toContain('five');
  });
});

beforeEach(() => vi.stubGlobal('document', { documentElement: { lang: 'en-US' } }));
afterEach(() => vi.unstubAllGlobals());
