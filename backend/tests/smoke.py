"""Real HTTP / process restart check: .venv/bin/python tests/smoke.py."""
import os
import socket
from pathlib import Path
import subprocess
import sys
import tempfile
import time

import httpx

ROOT = Path(__file__).resolve().parents[1]


def run():
    with tempfile.TemporaryDirectory(prefix='xronix-smoke-') as directory:
        env = {**os.environ, 'MOCK_AI': 'true', 'DATABASE_URL': f'sqlite:///{directory}/db.sqlite', 'JWT_SECRET': os.urandom(48).hex(), 'BACKUP_ENABLED': 'false', 'BACKUP_DIR': f'{directory}/backups'}
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
        env['CORS_ORIGINS'] = 'https://xronix.ru'
        with httpx.Client(base_url=f'http://127.0.0.1:{port}', timeout=35, trust_env=False) as client:
            for restart in range(2):
                if restart == 1:
                    subprocess.run([sys.executable, '-m', 'app.maintenance', 'restore', '--backup', backup,
                                    '--confirm', f'RESTORE {directory}/db.sqlite'], cwd=ROOT, env=env,
                                   check=True, capture_output=True)
                process = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'app.main:create_app', '--factory', '--host', '0.0.0.0', '--port', str(port)], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                try:
                    for _ in range(100):
                        if process.poll() is not None:
                            raise RuntimeError(process.stderr.read().decode())
                        try:
                            if client.get('/health').status_code == 200:
                                break
                        except httpx.ConnectError:
                            pass
                        time.sleep(0.1)
                    else:
                        raise RuntimeError('Server did not become healthy')
                    if restart == 0:
                        auth = client.post('/api/auth/register', json={'name': 'Smoke', 'email': 'smoke@example.com', 'password': 'smoke-test-password'})
                        assert auth.status_code == 201, auth.text
                        headers = {'Authorization': f'Bearer {auth.json()["token"]}'}
                        assert client.post('/api/auth/login', json={'email': 'smoke@example.com', 'password': 'smoke-test-password'}).status_code == 200
                        assert client.get('/api/me', headers=headers).status_code == 200
                        assert client.patch('/api/me', headers=headers, json={'city': 'Казань', 'tags': ['Казань']}).json()['city'] == 'Казань'
                        assert client.options('/api/me', headers={'Origin':'https://xronix.ru', 'Access-Control-Request-Method':'GET', 'Access-Control-Request-Headers':'authorization'}).status_code == 200
                        assert client.get('/api/me', headers={'Origin':'https://evil.example'}).status_code == 400
                        assert client.get('/api/me').status_code == 401
                        cid = client.post('/api/chats', headers=headers).json()['chat_id']
                        assert client.get('/api/chats', headers=headers).json()[0]['id'] == cid
                        path = f'/api/chats/{cid}/messages'
                        assert client.post(path, headers=headers, json={'text': 'Хочу кофейню'}).json()['type'] == 'questions'
                        response = client.post(path, headers=headers, json={'text': 'Москва, 500 тысяч, новичок', 'answers': [{'question_id': 'budget', 'answer': '500 тыс – 2 млн'}]})
                        assert response.status_code == 200, response.text
                        reply = response.json()
                        pid = reply['plan_id']
                        assert reply['plan']['credit']['monthly_payment_rub'] == 51878
                        replay = client.post(path, headers=headers, json={'text': 'Москва, 500 тысяч, новичок', 'answers': [{'question_id': 'budget', 'answer': '500 тыс – 2 млн'}]})
                        assert replay.json() == reply
                        assert len(client.get('/api/plans', headers=headers).json()) == 1
                        second = client.post('/api/auth/register', json={'name':'Second', 'email':'second@example.com', 'password':'second-password'}).json()
                        other = {'Authorization': f'Bearer {second["token"]}'}
                        assert client.get(f'/api/plans/{pid}', headers=other).status_code == 404
                        assert client.get(f'/api/chats/{cid}', headers=other).status_code == 404
                        result = subprocess.run([sys.executable, '-m', 'app.maintenance', 'backup'], cwd=ROOT, env=env, check=True, capture_output=True, text=True)
                        backup = result.stdout.strip()
                        denied = subprocess.run([sys.executable, '-m', 'app.maintenance', 'restore', '--backup', backup,
                                                 '--confirm', f'RESTORE {directory}/db.sqlite'], cwd=ROOT, env=env, capture_output=True)
                        assert denied.returncode == 1
                        client.patch('/api/me', headers=headers, json={'city':'После резервной копии'})
                    else:
                        assert client.get('/api/me', headers=headers).json()['city'] == 'Казань'
                        assert client.get('/api/me', headers=headers).status_code == 200
                        assert client.get(f'/api/plans/{pid}', headers=headers).json()['plan'] == reply['plan']
                        assert client.get('/api/plans', headers=headers).json()[0]['plan_id'] == pid
                        assert len(client.get(f'/api/chats/{cid}', headers=headers).json()['messages']) == 4
                        assert client.post(path, headers=headers, json={'text': 'Спасибо'}).json()['type'] == 'message'
                finally:
                    process.terminate()
                    process.wait(timeout=40)
                    process.stderr.close()
    print('PASS: real HTTP, health, register/login, JWT, profile, chats, questions/answers, plan, replay, user isolation, production CORS, annuity, process restart, native SQLite backup/offline restore, persisted plan/history/mock state')


if __name__ == '__main__':
    run()
