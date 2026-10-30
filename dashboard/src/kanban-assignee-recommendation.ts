import { uiText as sourceText } from './ui-locale';
/**
 * Suggest an installed Hermes profile for a Kanban card.
 *
 * The suggestion is advisory: it combines the task wording (the card's actual
 * intent), the board it lives on, and that board's delivered-run history, so a
 * person can accept one proposal instead of re-reading every profile name.
 * Nothing is written here — callers decide whether to preselect the value.
 */

export type AssigneeStats = { completed: number; failed: number };
export type AssigneeHistory = Record<string, AssigneeStats>;

export type IntentRule = { keywords: string[]; boards?: string[] };

export type ScoredAssignee = {
  name: string;
  score: number;
  reasons: string[];
  matched: string[];
};

export type AssigneeRecommendation = {
  assignee: string;
  score: number;
  reason: string;
  candidates: ScoredAssignee[];
};

/** Bilingual intent vocabulary per known profile; custom profiles stay neutral. */
export const PROFILE_INTENTS: Record<string, IntentRule> = {
  'project-manager': {
    keywords: [
      '代码', '开发', '重构', '测试', '部署', '发布', '前端', '后端', '接口', '数据库', '性能', '优化',
      '修复', '缺陷', '架构', '工作流', '脚本', '联调', '流水线',
      'code', 'develop', 'refactor', 'test', 'deploy', 'release', 'frontend', 'backend', 'api',
      'database', 'performance', 'bug', 'fix', 'architecture', 'pipeline', 'typescript', 'python', 'pull request',
    ],
    boards: ['workbench', 'project-manager', 'digital-hub', 'ops'],
  },
  writer: {
    keywords: ['写作', '文章', '文案', '博客', '稿件', '润色', '改写', '摘要', '标题', '公众号', '分享稿', '读书笔记',
      'writing', 'article', 'blog', 'copy', 'draft', 'essay', 'polish', 'newsletter'],
    boards: ['writing'],
  },
  'career-coach': {
    keywords: ['简历', '求职', '面试', 'offer', '职业', '跳槽', '招聘', '岗位', '内推',
      'resume', 'cv', 'interview', 'career', 'job', 'hiring'],
    boards: ['career'],
  },
  'finance-advisor': {
    keywords: ['理财', '预算', '投资', '基金', '股票', '收入', '支出', '财务', '报税', '保险', '记账',
      'budget', 'invest', 'finance', 'expense', 'tax', 'portfolio'],
    boards: ['money'],
  },
  'health-advisor': {
    keywords: ['健康', '睡眠', '运动', '健身', '饮食', '体重', '体检', '就医', '康复', '营养',
      'health', 'sleep', 'exercise', 'diet', 'workout', 'medical'],
    boards: ['health'],
  },
  'learning-mentor': {
    keywords: ['学习', '课程', '考试', '复习', '研究', '论文', '知识点', '练习题', '技能', '读书',
      'study', 'course', 'exam', 'research', 'paper', 'skill', 'revise'],
    boards: ['learning'],
  },
  'social-advisor': {
    keywords: ['社交', '沟通', '关系', '朋友', '聚会', '冲突', '情绪', '人际', '聊天',
      'social', 'communication', 'relationship', 'friend', 'conflict'],
    boards: ['social'],
  },
  'travel-assistant': {
    keywords: ['旅行', '行程', '机票', '酒店', '签证', '攻略', '景点', '出差', '路线',
      'travel', 'trip', 'itinerary', 'flight', 'hotel', 'visa'],
    boards: ['travel'],
  },
};

const TITLE_WEIGHT = 3;
const BODY_WEIGHT = 1;
const BOARD_WEIGHT = 5;
const MIN_SCORE = 3;

function normalized(value: string): string {
  return value.toLowerCase();
}

/** Score one installed profile against the card's wording and board. */
export function scoreAssignee(input: {
  title?: string;
  body?: string;
  board?: string;
  profile: string;
  history?: AssigneeHistory;
}): ScoredAssignee | null {
  const rule = PROFILE_INTENTS[input.profile];
  const history = input.history?.[input.profile];
  const title = normalized(String(input.title || ''));
  const body = normalized(String(input.body || ''));
  const board = normalized(String(input.board || ''));
  const reasons: string[] = [];
  const matched: string[] = [];
  let score = 0;

  for (const keyword of rule?.keywords || []) {
    const needle = normalized(keyword);
    const inTitle = title.includes(needle);
    const inBody = !inTitle && body.includes(needle);
    if (!inTitle && !inBody) continue;
    matched.push(keyword);
    score += inTitle ? TITLE_WEIGHT : BODY_WEIGHT;
  }
  if (matched.length) {
    reasons.push(sourceText(`匹配任务意图：${matched.slice(0, 3).join('、')}`, `Matches task intent: ${matched.slice(0, 3).join(', ')}`));
  }

  if (board && rule?.boards?.includes(board)) {
    score += BOARD_WEIGHT;
    reasons.push(sourceText(`看板「${board}」的常见执行者`, `Usual owner on the ${board} board`));
  }

  if (history) {
    const decided = Math.max(0, history.completed) + Math.max(0, history.failed);
    if (decided >= 2) {
      const rate = Math.max(0, history.completed) / decided;
      score += Math.round(rate * 4);
      if (history.failed >= 2) score -= 1;
      reasons.push(sourceText(
        `此看板交付成功率 ${Math.round(rate * 100)}%（${history.completed}/${decided}）`,
        `${Math.round(rate * 100)}% delivery success on this board (${history.completed}/${decided})`,
      ));
    }
  }

  if (!score) return null;
  return { name: input.profile, score, reasons, matched };
}

/** Rank installed profiles; returns null when nothing plausible matches. */
export function recommendAssignee(input: {
  title?: string;
  body?: string;
  board?: string;
  profiles: string[];
  history?: AssigneeHistory;
}): AssigneeRecommendation | null {
  const seen = new Set<string>();
  const candidates: ScoredAssignee[] = [];
  for (const profile of input.profiles) {
    if (!profile || seen.has(profile)) continue;
    seen.add(profile);
    const scored = scoreAssignee({ ...input, profile });
    if (scored) candidates.push(scored);
  }
  candidates.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
  const best = candidates[0];
  if (!best || best.score < MIN_SCORE) return null;
  return {
    assignee: best.name,
    score: best.score,
    reason: best.reasons.join('；'),
    candidates: candidates.slice(0, 3),
  };
}

/** Turn board run counts into the per-assignee history this module consumes. */
export function historyFromTasks(tasks: Array<{ assignee?: string; completed_runs?: number; failed_runs?: number }>): AssigneeHistory {
  const history: AssigneeHistory = {};
  for (const task of tasks) {
    const name = String(task.assignee || '').trim();
    if (!name) continue;
    const entry = history[name] || { completed: 0, failed: 0 };
    entry.completed += Math.max(0, Number(task.completed_runs) || 0);
    entry.failed += Math.max(0, Number(task.failed_runs) || 0);
    history[name] = entry;
  }
  return history;
}

/** One-line proposal for a drawer or dialog hint. */
export function recommendationText(recommendation: AssigneeRecommendation | null): string {
  if (!recommendation) return '';
  return sourceText(`推荐 ${recommendation.assignee}：${recommendation.reason}`, `Recommended ${recommendation.assignee}: ${recommendation.reason}`);
}
