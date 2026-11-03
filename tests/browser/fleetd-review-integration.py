"""Optional real-binary integration: isolated localhost fleetd and disposable DB only."""
import os,sys,subprocess,tempfile,socket,time,json,urllib.request,sqlite3
from pathlib import Path
os.environ.pop('CODEX_APP_SERVER_ENDPOINT', None)
os.environ.pop('CODEX_HOME', None)
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'dashboard'))
binary = os.environ['FLEET_TEST_BINARY']
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sidecar_app import TrustedProxyGate
import fleetd_proxy
with tempfile.TemporaryDirectory(prefix='fleet-review-isolated-') as tmp:
    with socket.socket() as s:
        s.bind(('127.0.0.1',0)); port=s.getsockname()[1]
    base=f'http://127.0.0.1:{port}'
    env={**os.environ,'FLEET_TOKEN':'local-worker-credential','FLEET_REVIEW_TOKEN':'local-review-credential','FLEET_NTFY_URL':'','FLEET_NTFY_TOPIC':''}
    log=open(tmp+'/fleet.log','wb')
    p=subprocess.Popen([binary,'--db',tmp+'/fleet.db','--listen',f'127.0.0.1:{port}'],env=env,stdout=log,stderr=log)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(base+'/healthz',timeout=1).close(); break
            except OSError: time.sleep(.1)
        def api(method,path,body=None,token='local-worker-credential'):
            req=urllib.request.Request(base+'/api/v1/'+path,method=method,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},data=None if body is None else json.dumps(body).encode())
            with urllib.request.urlopen(req,timeout=3) as r:return json.load(r)
        try: api('GET','tasks',token='local-review-credential')
        except Exception as e:
            print('FLEET_BINARY_REVIEW_TOKEN_UNSUPPORTED',type(e).__name__); sys.exit(2)
        for key in ('FLEET_TOKEN','FLEET_REVIEW_TOKEN'):os.environ[key]=env[key]
        os.environ.update(FLEETD_URL=base+'/api/v1',HERMES_DASHBOARD_TRUSTED_PROXY_SECRET='local-secret',HERMES_WORKBENCH_ALLOWED_USERS='preview')
        app=FastAPI();app.include_router(fleetd_proxy.router,prefix='/api/plugins/workbench');app.add_middleware(TrustedProxyGate)
        c=TestClient(app);headers={'x-hermes-proxy-secret':'local-secret','remote-user':'preview','origin':'http://testserver'}
        for action,expected in [('request_changes','running'),('approve','done')]:
            task=api('POST','tasks',{'title':'Isolated review test','kind':'codex','machine':'no-worker-test','prompt':'No work. Test fixture only.','acceptance':'test','verify_mode':'human'})['task']
            # Only this disposable local database is seeded. Production is never written.
            with sqlite3.connect(tmp+'/fleet.db') as db:db.execute("UPDATE tasks SET status='review' WHERE id=?",(task['id'],))
            body={'text':'First line\nSecond line'} if action=='request_changes' else {}
            r=c.post('/api/plugins/workbench/fleetd/tasks/'+task['id']+'/'+action,headers=headers,json=body)
            assert r.status_code==200,(r.status_code,r.text)
            detail=api('GET','tasks/'+task['id']);assert detail['task']['status']==expected
            if body:assert any(e['type']=='task.note' and e['payload']==body['text'] for e in detail['events'])
        api('POST','workers',{'id':'isolated-worker','machine':'no-worker-test','caps':['agy','codex'],'status':'online'})
        for action, initial, expected in [('archive','done','archived'),('retry','blocked','ready')]:
            task=api('POST','tasks',{'title':'Isolated lifecycle test','kind':'research','machine':'no-worker-test','prompt':'Fixture only','acceptance':'test'})['task']
            with sqlite3.connect(tmp+'/fleet.db') as db:db.execute("UPDATE tasks SET status=? WHERE id=?",(initial,task['id']))
            r=c.post('/api/plugins/workbench/fleetd/tasks/'+task['id']+'/'+action,headers=headers,json={})
            assert r.status_code==200,(r.status_code,r.text)
            assert api('GET','tasks/'+task['id'])['task']['status']==expected
        task=api('POST','tasks',{'title':'Isolated decision test','kind':'research','risk':'R3','machine':'no-worker-test','prompt':'Fixture only','acceptance':'test'})['task']
        api('POST','tasks/'+task['id']+'/decision',{'question':'Proceed?','options':['Retry','Stop']})
        detail=c.get('/api/plugins/workbench/fleetd/tasks/'+task['id'],headers=headers).json()
        d=detail['open_decision']
        r=c.post('/api/plugins/workbench/fleetd/tasks/'+task['id']+'/decide',headers=headers,json={'decision_id':d['id'],'option_id':d['options'][0]['id']})
        assert r.status_code==200,(r.status_code,r.text)
        assert api('GET','tasks/'+task['id'])['task']['status']=='ready'
        r=c.get('/api/plugins/workbench/fleetd/tasks/search',headers=headers,params={'q':'Isolated lifecycle','archived':'true'})
        assert r.status_code==200,(r.status_code,r.text)
        assert len(r.json()['tasks'])==1 and r.json()['tasks'][0]['status']=='archived'
        print('PASS real fleetd binary: archive, retry, decision, indexed archived search')
        print('PASS real fleetd binary: authenticated proxy approve -> done; note event -> request_changes -> running')
    finally:p.terminate();p.wait(timeout=5);log.close()
