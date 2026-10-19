"""Real HTTP / process restart check: .venv/bin/python tests/smoke.py."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

import httpx

ROOT = Path(__file__).resolve().parents[1]


def run():
    with tempfile.TemporaryDirectory(prefix='xronix-smoke-') as directory:
        env = {**os.environ, 'MOCK_AI': 'true', 'DATABASE_URL': f'sqlite:///{directory}/db.sqlite', 'JWT_SECRET': os.urandom(48).hex()}
        with httpx.Client(base_url='http://127.0.0.1:8000', timeout=35, trust_env=False) as client:
            for restart in range(2):
                process = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'app.main:create_app', '--factory', '--host', '0.0.0.0', '--port', '8000'], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
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
                        cid = client.post('/api/chats', headers=headers).json()['chat_id']
                        path = f'/api/chats/{cid}/messages'
                        assert client.post(path, headers=headers, json={'text': 'Хочу кофейню'}).json()['type'] == 'questions'
                        response = client.post(path, headers=headers, json={'text': 'Москва, 500 тысяч, новичок', 'answers': [{'question_id': 'budget', 'answer': '500 тысяч'}]})
                        assert response.status_code == 200, response.text
                        reply = response.json()
                        pid = reply['plan_id']
                        assert reply['plan']['credit']['monthly_payment_rub'] == 51878
                    else:
                        assert client.get('/api/me', headers=headers).status_code == 200
                        assert client.get(f'/api/plans/{pid}', headers=headers).json()['plan'] == reply['plan']
                        assert client.get('/api/plans', headers=headers).json()[0]['plan_id'] == pid
                        assert len(client.get(f'/api/chats/{cid}', headers=headers).json()['messages']) == 4
                        assert client.post(path, headers=headers, json={'text': 'Спасибо'}).json()['type'] == 'message'
                finally:
                    process.terminate()
                    process.wait(timeout=40)
                    process.stderr.close()
    print('PASS: 0.0.0.0:8000, health, register/login, JWT, chat, questions, answers, plan, annuity, real process restart, persisted plan/history/mock state')


if __name__ == '__main__':
    run()
