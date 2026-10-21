"""Run locally, then open http://127.0.0.1:18701 in a browser. Restart for each run.

PYTHONPATH=backend backend/.venv/bin/python backend/tests/cors_browser.py
Results: /tmp/xronix-cross-origin-browser-result.json. Uses only a disposable DB.
"""
import sys,tempfile,threading,json
from pathlib import Path
from http.server import BaseHTTPRequestHandler,HTTPServer
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.config import Settings
from app.main import create_app
import uvicorn
PAGE=r'''<!doctype html><html lang="ru"><meta charset="utf-8"><title>XRONIX — проверка CORS</title><h1>Локальная cross-origin проверка</h1><pre id="result">Проверяется…</pre><script>
(async () => {
 const rows=[];
 const call=async (name,path,init,expected) => {
  const r=await fetch('http://127.0.0.1:18700'+path,{credentials:'include',...init});
  const b=await r.json();
  if(r.status!==expected)throw new Error(name+': '+r.status);
  rows.push({name,status:r.status,body:b});
 };
 try {
  await call('cookie register','/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json','X-Session-Mode':'cookie'},body:JSON.stringify({email:'browser@example.com',name:'CORS',password:'password123'})},201);
  await call('invalid JSON','/api/chats',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'},400);
  await call('oversized body','/api/chats',{method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(65537)},413);
  await call('cookie authentication','/api/me',{},200);
  await call('rate limit','/api/me',{},429);
  await fetch('/result',{method:'POST',body:JSON.stringify({status:'PASS',checks:rows})});
  document.getElementById('result').textContent='PASS: browser read all cross-origin responses\n'+JSON.stringify(rows,null,2);
 }catch(e){document.getElementById('result').textContent='FAIL: '+e+'\n'+JSON.stringify(rows,null,2);}
})();
</script></html>'''
class Handler(BaseHTTPRequestHandler):
 def do_POST(self):
  data=self.rfile.read(int(self.headers.get('Content-Length','0')))
  open('/tmp/xronix-cross-origin-browser-result.json','wb').write(data)
  self.send_response(204);self.end_headers()
 def do_GET(self):
  self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.end_headers();self.wfile.write(PAGE.encode())
 def log_message(self,*args):pass
server=HTTPServer(('127.0.0.1',18701),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
with tempfile.TemporaryDirectory(prefix='xronix-browser-cors-') as tmp:
 settings=Settings(database_url=f'sqlite:///{tmp}/browser.sqlite',jwt_secret='local-browser-cors-check-0123456789012345',seed_demo=False,consult_chat=True,cors_origins=['http://127.0.0.1:18701'],api_requests_per_minute=4)
 uvicorn.run(create_app(settings),host='127.0.0.1',port=18700)
server.shutdown()
