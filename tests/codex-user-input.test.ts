import { visibleChatText } from '../dashboard/src/chat-line-output';
import { describe, expect, it } from 'vitest';
import { pendingAsyncQuestions, formatQuestionAnswers, questionTranscript } from '../dashboard/src/codex-user-input';

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


describe('question transcript presentation', () => {
  const question = { id: 'q', role: 'assistant', content: 'Choose?\n\n- A\n- B', questions: [{ title: 'Choose?', options: ['A', 'B'] }] };
  it('shows pending questions only in the form without changing source data', () => {
    expect(questionTranscript([question])).toEqual([]);
    expect(question.content).toContain('- B');
  });
  it('keeps a compact question and answer after submission and reload', () => {
    const messages = [question, { id: 'a', role: 'user', content: 'Choose?\nA' }];
    expect(questionTranscript(messages).map(m => m.content)).toEqual(['Choose?', 'A']);
    expect(messages[1].content).toBe('Choose?\nA');
  });
  it('retains ordinary lists, unrelated replies, and failure retry', () => {
    const ordinary = { id: 'o', role: 'assistant', content: '- A\n- B' };
    expect(questionTranscript([ordinary])).toEqual([ordinary]);
    expect(questionTranscript([question, { id: 'a', role: 'user', content: 'Keep Choose? in prose' }])[1].content).toBe('Keep Choose? in prose');
    expect(questionTranscript([question, { id: 'a', role: 'user', status: 'failed', content: 'Choose?\nA' }])).toHaveLength(1);
  });
  it('keeps answered questions visible while the agent continues running', () => {
    expect(visibleChatText({ ...question, status: 'running', content: 'Choose?' })).toBe('Choose?');
  });
  it('preserves explanation beside structured questions', () => {
    expect(questionTranscript([{ ...question, content: 'A separate detail.\n\nChoose?\n- A\n- B' }])[0].content).toBe('A separate detail.');
  });
  it('preserves multiple question context with concise answers', () => {
    const next = { ...question, id: 'q2', content: 'When?\n- Now\n- Later', questions: [{ title: 'When?', options: ['Now', 'Later'] }] };
    expect(questionTranscript([question, next, { id: 'a', role: 'user', content: 'Choose?\nA\n\nWhen?\nLater' }]).map(m => m.content)).toEqual(['Choose?', 'When?', 'A\n\nLater']);
  });
});
