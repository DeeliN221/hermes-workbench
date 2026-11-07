import {mkdir, readFile, writeFile, rename, open, chmod, unlink} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {RuntimeError} from './errors.mjs';

export class Store {
  constructor(directory) { this.directory = resolve(directory); this.sessions = new Map(); this.writes = Promise.resolve(); }
  async init() {
    await mkdir(this.directory, {recursive: true, mode: 0o700}); await chmod(this.directory, 0o700);
    this.lockPath = join(this.directory, 'bridge.lock');
    try { this.lock = await open(this.lockPath, 'wx', 0o600); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const pid = Number(await readFile(this.lockPath, 'utf8'));
      try { process.kill(pid, 0); }
      catch (e) {
        if (e.code === 'ESRCH') { await unlink(this.lockPath); return this.init(); }
        throw e;
      }
      throw new RuntimeError(503, 'runtime/writer-held', 'Bridge state is already in use');
    }
    await this.lock.writeFile(String(process.pid));
    try {
      const data = JSON.parse(await readFile(join(this.directory, 'metadata.json'), 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.sessions)) throw Error('Invalid metadata');
      for (const session of data.sessions) this.sessions.set(session.id, session);
    } catch (e) { if (e.code !== 'ENOENT') { await this.close(); throw e; } }
  }
  snapshot() { return JSON.parse(JSON.stringify({version:1,sessions:[...this.sessions.values()]})); }
  async writeSnapshot(data) {
    const temporary = join(this.directory, 'metadata.json.tmp');
    const handle = await open(temporary, 'w', 0o600);
    try { await handle.writeFile(JSON.stringify(data)); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, join(this.directory, 'metadata.json'));
    const dir = await open(this.directory, 'r'); try { await dir.sync(); } finally { await dir.close(); }
  }
  enqueue(work) {
    const operation=this.writes.then(work);this.writes=operation.catch(()=>{});return operation;
  }
  save() { return this.enqueue(()=>this.writeSnapshot(this.snapshot())); }
  commitDelivery(id,record,request) {
    return this.enqueue(async()=>{
      const meta=this.sessions.get(id);const existing=(meta.deliveries??[]).find(x=>x.idempotency_key===record.idempotency_key);
      if(existing){
        if(existing.hash!==record.hash)throw new RuntimeError(409,'runtime/delivery-conflict','Delivery key already has a different payload or attempt');
        return {record:existing,created:false};
      }
      const snapshot=this.snapshot();const target=snapshot.sessions.find(x=>x.id===id);
      target.deliveries=[...(target.deliveries??[]),record];
      if(request){
        if(Object.hasOwn(target.requests,record.supervisor.request_id))throw new RuntimeError(409,'runtime/request-conflict','Supervisor request identity already exists');
        target.requests[record.supervisor.request_id]=request;
      }
      await this.writeSnapshot(snapshot);
      // Publish only after both the file and directory durability barriers.
      meta.deliveries=target.deliveries;
      if(request)meta.requests[record.supervisor.request_id]=request;
      return {record,created:true};
    });
  }
  updateSupervisor(id,deliveryId,supervisor) {
    return this.enqueue(async()=>{
      const meta=this.sessions.get(id);
      const snapshot=this.snapshot();const target=snapshot.sessions.find(x=>x.id===id);
      const record=target.deliveries.find(x=>x.id===deliveryId);
      if(JSON.stringify(record.supervisor)===JSON.stringify(supervisor))return;
      record.supervisor=supervisor;
      await this.writeSnapshot(snapshot);
      meta.deliveries=target.deliveries;
      return record;
    });
  }
  async close() {
    await this.writes;
    if (this.lock) { await this.lock.close(); this.lock = undefined; await unlink(this.lockPath); }
  }
}
