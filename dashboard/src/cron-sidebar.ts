import { uiText as sourceText } from './ui-locale';
export interface SidebarJob {
  id: string; name?: string; prompt?: string; no_agent?: boolean;
  enabled?: boolean; state?: string; next_run_at?: string | null;
}
export const cronSortOptions = [
  ['time', sourceText("下次执行：由近到远", "Next run: earliest first")], ['time-desc', sourceText("下次执行：由远到近", "Next run: latest first")],
  ['script', sourceText("仅脚本优先", "Script-only first")], ['agent', sourceText("AI 任务优先", "AI jobs first")],
  ['paused', sourceText("已暂停优先", "Paused first")], ['active', sourceText("启用优先", "Enabled first")], ['name', sourceText("任务名称", "Job name")],
] as const;
export function isCronPaused(job: SidebarJob): boolean { return job.state === 'paused' || (job.enabled === false && !['completed', 'terminal'].includes(job.state || '')); }
export function cronCategory(job: SidebarJob): string {
  const name = job.name || '';
  if (/学习|复盘|learn|research|review/i.test(name)) return sourceText("学习与研究", "Learning and research");
  if (/推荐|电影|职位|购车|recommend|movie|career|job search/i.test(name)) return sourceText("生活与求职", "Life and careers");
  if (/同步|自动维护|Inbox|sync|note|organize/i.test(name)) return sourceText("笔记与整理", "Notes and organization");
  if (/运维|维护|通知|工作|capacity|容量|maintenance|notification|operation/i.test(name)) return sourceText("运维与可靠性", "Operations and reliability");
  return sourceText("其他任务", "Other jobs");
}
function nextTime(job: SidebarJob): number | null {
  if (job.enabled === false || isCronPaused(job) || ['completed', 'finished', 'terminal'].includes(job.state || '')) return null;
  const value = Date.parse(job.next_run_at || '');
  return Number.isFinite(value) ? value : null;
}
export function sortCronJobs<T extends SidebarJob>(jobs: T[], order: string): T[] {
  const name = (a:T,b:T) => (a.name || a.id).localeCompare(b.name || b.id, typeof document === 'undefined' ? 'en' : document.documentElement.lang || 'en') || a.id.localeCompare(b.id);
  const time = (a:T,b:T) => {
    const x=nextTime(a), y=nextTime(b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return (x-y) * (order === 'time-desc' ? -1 : 1);
  };
  return [...jobs].sort((a,b) => {
    let rank = 0;
    if (order === 'script') rank = Number(!!b.no_agent)-Number(!!a.no_agent);
    if (order === 'agent') rank = Number(!!a.no_agent)-Number(!!b.no_agent);
    if (order === 'paused') rank = Number(isCronPaused(b))-Number(isCronPaused(a));
    if (order === 'active') rank = Number(a.enabled === false)-Number(b.enabled === false);
    return rank || (order === 'name' ? 0 : time(a,b)) || name(a,b);
  });
}
export function cronSections<T extends SidebarJob>(jobs:T[], order:string, grouped:boolean) {
  const sorted=sortCronJobs(jobs,order);
  if (!grouped) return [{name:sourceText("全部任务", "All jobs"),jobs:sorted}];
  return [sourceText("学习与研究", "Learning and research"),sourceText("生活与求职", "Life and careers"),sourceText("笔记与整理", "Notes and organization"),sourceText("运维与可靠性", "Operations and reliability"),sourceText("其他任务", "Other jobs")]
    .map(name=>({name,jobs:sorted.filter(job=>cronCategory(job)===name)})).filter(section=>section.jobs.length);
}
export function readCronSidebarPrefs(profile: string): { order:string; grouped:boolean; collapsed: Record<string,boolean> } {
  try {
    const p=JSON.parse(localStorage.getItem('workbench.cron.sidebar.'+profile)||'{}');
    return {order:cronSortOptions.some(([key])=>key===p.order)?p.order:'time', grouped:p.grouped!==false,
      collapsed:p.collapsed && typeof p.collapsed==='object'?p.collapsed:{}};
  } catch { return {order:'time',grouped:true,collapsed:{}}; }
}
