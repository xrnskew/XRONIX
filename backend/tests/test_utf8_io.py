"""JSON assets and exports must not depend on Windows' legacy default encoding."""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]


def legacy_environment():
    env=os.environ.copy()
    env.update(LC_ALL='C',LANG='C',PYTHONUTF8='0',PYTHONCOERCECLOCALE='0',PYTHONPATH=os.pathsep.join([str(ROOT/'backend'),str(ROOT/'backend/tests')]))
    return env


def run_legacy(args):
    result=subprocess.run([sys.executable,*args],cwd=ROOT,env=legacy_environment(),capture_output=True,timeout=30)
    assert result.returncode==0,result.stderr.decode('utf-8',errors='replace')
    return result


def test_startup_seed_and_chat_without_utf8_mode(tmp_path):
    code='''
import json,locale,sys
import httpx
from fastapi.testclient import TestClient
from app.config import Settings
from app.main import create_app
from test_conveyor import mock_app
assert sys.flags.utf8_mode == 0
settings=Settings(database_url='sqlite:///'+sys.argv[1],jwt_secret='encoding-regression-only-0123456789012345',seed_demo=True,consult_chat=True,api_requests_per_minute=10000,auth_requests_per_minute=1000)
app=create_app(settings,integrations_transport=httpx.ASGITransport(app=mock_app),ai_transport=httpx.MockTransport(lambda r:httpx.Response(503)))
with TestClient(app) as c:
    assert c.get('/health').status_code==200
    login=c.post('/api/auth/login',json=dict(email='client@xronix.demo',password='demo12345'))
    assert login.status_code==200,login.text
    assert login.json()['user']['name']=='Александр'
    headers={'Authorization':'Bearer '+login.json()['token']}
    companies=c.get('/api/companies',headers=headers).json()
    assert any('Северная выпечка' in item['registry']['name'] for item in companies)
    cid=c.post('/api/chats',headers=headers).json()['chat_id']
    reply=c.post('/api/chats/'+cid+'/messages',headers=headers,json=dict(text='Хочу пекарню в городе Самара, своих 900 тысяч'))
    assert reply.status_code==200,reply.text
    assert reply.json()['type']=='plan'
    assert reply.json()['plan']['business']['city']=='Самара'
    assert reply.json()['plan']['finance']['own_funds_rub']==900000
print(json.dumps(dict(utf8_mode=sys.flags.utf8_mode,encoding=locale.getpreferredencoding(False),status='ok')))
'''
    # The command itself must be ASCII-safe when Python's UTF-8 mode is disabled.
    result=run_legacy(['-c',code.encode('ascii',errors='backslashreplace').decode('ascii'),str(tmp_path/'legacy.sqlite')])
    summary=json.loads(result.stdout)
    assert summary['utf8_mode']==0 and summary['status']=='ok'
    if os.name!='nt':assert summary['encoding'].lower() not in ('utf-8','utf8')


def test_openapi_export_is_utf8_without_utf8_mode(tmp_path):
    output=tmp_path/'openapi.json'
    run_legacy(['-m','app.export_openapi',str(output)])
    text=output.read_text(encoding='utf-8')
    schema=json.loads(text)
    assert '/api/plans/calculate' in schema['paths']
    assert '/api/bank/applications/{id}/decision' in schema['paths']
    assert any(ord(char)>127 for char in text)
