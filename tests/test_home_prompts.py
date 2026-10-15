import json
import sqlite3
import sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).parents[1] / 'dashboard'))
from home_prompts import session_prompts, visible_request


def test_summary_reads_user_edges_and_compression_only(tmp_path, monkeypatch):
    monkeypatch.setenv('HERMES_WORKBENCH_HERMES_HOME', str(tmp_path))
    c = sqlite3.connect(tmp_path / 'state.db')
    c.executescript('''CREATE TABLE sessions(id TEXT PRIMARY KEY,parent_session_id TEXT,source TEXT,model_config TEXT,end_reason TEXT);
        CREATE TABLE messages(id INTEGER PRIMARY KEY,session_id TEXT,role TEXT,content TEXT,active INTEGER DEFAULT 1);
        CREATE INDEX session_messages ON messages(session_id,id);''')
    c.executemany('INSERT INTO sessions VALUES (?,?,?,?,?)', [('parent',None,'cli','{}','compression'),('child','parent','cli','{}',None),('branch','parent','cli','{"_branched_from":"parent"}',None)])
    c.executemany('INSERT INTO messages(session_id,role,content) VALUES (?,?,?)', [('parent','user','<environment_context>hidden</environment_context>'),('parent','user','First'),('parent','tool','x'*1000000),('child','user','Latest'),('branch','user','Branch request')])
    c.execute("INSERT INTO messages(session_id,role,content,active) VALUES ('child','user','Rewound request',0)")
    c.commit();c.close()
    assert session_prompts('default','child') == {'first':'First','latest':'Latest'}
    assert session_prompts('default','branch') == {'first':'Branch request','latest':'Branch request'}
    with pytest.raises(Exception): session_prompts('../outside','child')
    with pytest.raises(Exception): session_prompts('default',"child' OR 1=1")


def test_summary_preserves_visible_content_and_strips_bootstrap():
    assert visible_request('# AGENTS.md instructions for /example\n\n<INSTRUCTIONS>rules</INSTRUCTIONS><environment_context>cwd</environment_context>Question') == 'Question'
    assert visible_request('Explain <environment_context> in this code') == 'Explain <environment_context> in this code'
    assert visible_request('\0json:'+json.dumps([{'type':'text','text':'Question'},{'type':'image_url'}])) == 'Question\n[Hermes media omitted]'
