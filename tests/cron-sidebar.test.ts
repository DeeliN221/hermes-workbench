import {describe,it,expect} from 'vitest';
import {cronSections,sortCronJobs} from '../dashboard/src/cron-sidebar';
const jobs=[
 {id:'a',name:'学习：研究资讯',next_run_at:'2026-09-25T08:00:00+08:00',enabled:true},
 {id:'b',name:'Codex capacity recovery',no_agent:true,enabled:false,state:'paused',next_run_at:'2020-01-01'},
 {id:'c',name:'同步：Obsidian',no_agent:true,enabled:true,next_run_at:'2026-09-25T01:00:00Z'},
 {id:'d',name:'推荐：家庭电影',enabled:true,next_run_at:null},
];
describe('cron sidebar',()=>{
 it('sorts actual instants and keeps unscheduled jobs last in both directions',()=>{
  expect(sortCronJobs(jobs,'time').slice(0,2).map(j=>j.id)).toEqual(['a','c']);
  expect(sortCronJobs(jobs,'time-desc').slice(0,2).map(j=>j.id)).toEqual(['c','a']);
  expect(jobs[0].id).toBe('a');
 });
 it('sorts execution mode and paused status independently',()=>{
  expect(sortCronJobs(jobs,'script').slice(0,2).every(j=>j.no_agent)).toBe(true);
  expect(sortCronJobs(jobs,'agent').slice(0,2).every(j=>!j.no_agent)).toBe(true);
  expect(sortCronJobs(jobs,'paused')[0].id).toBe('b');
  expect(sortCronJobs(jobs,'active').at(-1)?.id).toBe('b');
 });
 it('groups all jobs once and supports global sorting and unknown names',()=>{
  expect(cronSections(jobs,'time',true).map(g=>g.name)).toEqual(['Learning and research','Life and careers','Notes and organization','Operations and reliability']);
  expect(cronSections(jobs,'paused',false)[0].jobs[0].id).toBe('b');
  expect(cronSections([{id:'x',name:'New task'}],'time',true)[0].name).toBe('Other jobs');
 });
});
