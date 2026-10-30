// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  historyFromTasks,
  recommendAssignee,
  recommendationText,
  scoreAssignee,
} from '../dashboard/src/kanban-assignee-recommendation';

const INSTALLED = ['default', 'project-manager', 'writer', 'career-coach', 'health-advisor', 'learning-mentor'];

afterEach(() => {
  document.documentElement.lang = '';
});

describe('Kanban assignee recommendation', () => {
  it('matches the card intent and explains why', () => {
    document.documentElement.lang = 'en';
    const recommendation = recommendAssignee({
      title: 'Fix the workbench PR deployment pipeline',
      body: 'Refactor the TypeScript test runner',
      board: 'workbench',
      profiles: INSTALLED,
    });
    expect(recommendation?.assignee).toBe('project-manager');
    expect(recommendation?.reason).toContain('Matches task intent');
    expect(recommendation?.reason).toContain('workbench');
    expect(recommendation?.score).toBeGreaterThan(5);
  });

  it('keeps Chinese task wording working and prefers title matches', () => {
    document.documentElement.lang = 'zh';
    const title = recommendAssignee({ title: '整理求职简历与面试准备', profiles: INSTALLED });
    const body = recommendAssignee({ title: '本周计划', body: '整理求职简历与面试准备', profiles: INSTALLED });
    expect(title?.assignee).toBe('career-coach');
    expect(title!.score).toBeGreaterThan(body!.score);
    expect(recommendationText(title)).toContain('推荐 career-coach');
  });

  it('weights delivered history on the board without hiding a stronger intent', () => {
    const strongIntent = scoreAssignee({
      title: 'Write the release article for the blog',
      profile: 'writer',
    })!;
    const weakIntentWithHistory = scoreAssignee({
      title: 'Small note',
      profile: 'writer',
      history: { writer: { completed: 10, failed: 0 } },
    })!;
    expect(weakIntentWithHistory.score).toBeLessThan(15);
    expect(strongIntent.score).toBeGreaterThan(weakIntentWithHistory.score - 1);
    const failing = scoreAssignee({
      title: 'Small note',
      profile: 'writer',
      history: { writer: { completed: 0, failed: 3 } },
    })!;
    expect(failing.score).toBeLessThan(weakIntentWithHistory.score);
  });

  it('only chooses installed profiles and stays silent without a real signal', () => {
    const recommendation = recommendAssignee({ title: '面试准备', profiles: ['default', 'writer'] });
    expect(recommendation).toBeNull();
    const installed = recommendAssignee({ title: '面试准备', profiles: ['default', 'career-coach'] });
    expect(installed?.assignee).toBe('career-coach');
    expect(installed?.candidates.map(candidate => candidate.name)).toEqual(['career-coach']);
  });

  it('aggregates per-assignee run history from the board overview', () => {
    const history = historyFromTasks([
      { assignee: 'project-manager', completed_runs: 2, failed_runs: 1 },
      { assignee: 'project-manager', completed_runs: 1 },
      { assignee: '', completed_runs: 9 },
      { assignee: 'writer', failed_runs: 2 },
    ]);
    expect(history).toEqual({
      'project-manager': { completed: 3, failed: 1 },
      writer: { completed: 0, failed: 2 },
    });
  });

  it('returns a bounded candidate list for a broad intent', () => {
    const recommendation = recommendAssignee({
      title: 'Research the paper, write the summary, fix the test, plan the trip',
      profiles: INSTALLED,
    });
    expect(recommendation).not.toBeNull();
    expect(recommendation!.candidates.length).toBeLessThanOrEqual(3);
    expect(recommendation!.candidates[0].score).toBeGreaterThanOrEqual(recommendation!.candidates.at(-1)!.score);
  });
});
