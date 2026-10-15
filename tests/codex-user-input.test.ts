import { describe, expect, it } from 'vitest';
import { pendingAsyncQuestions, formatQuestionAnswers } from '../dashboard/src/codex-user-input';

describe('async app-server questions', () => {
  const question = { id: 'question', role: 'assistant', delivery: 'async', questions: [{ title: 'When can the example device come online?', options: ['Now', 'Later'] }] };
  it('uses structured question metadata and preserves original options', () => {
    const result = pendingAsyncQuestions([question])!;
    expect(result.questions[0]).toMatchObject({ id: 'question:0', question: 'When can the example device come online?', isOther: true, options: [{ label: 'Now' }, { label: 'Later' }] });
    expect(formatQuestionAnswers(result.questions, { 'question:0': { answers: ['Later'] } })).toBe('When can the example device come online?\nLater');
  });
  it('recovers on reload, closes after a submitted answer, and allows explicit failure retry', () => {
    expect(pendingAsyncQuestions([question, { id: 'answer', role: 'user', status: 'pending' }])).toBeNull();
    expect(pendingAsyncQuestions([question, { id: 'answer', role: 'user', status: 'failed' }])?.id).toBe('question');
    expect(pendingAsyncQuestions([{ id: 'answer', role: 'user' }, question])?.id).toBe('question');
  });
  it('does not guess questions from ordinary bullet lists and handles multiple question messages', () => {
    expect(pendingAsyncQuestions([{ id: 'ordinary', role: 'assistant' }])).toBeNull();
    expect(pendingAsyncQuestions([question, { ...question, id: 'second' }])?.questions).toHaveLength(2);
    expect(pendingAsyncQuestions([{ ...question, questions: [null, {}, { title: 1 }] }])).toBeNull();
  });
});
