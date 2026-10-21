"""Capture an independent human set once; review raw responses before summary.

Run only against the AI checkout frozen at 311e860 (see ROUND4_eval.md).
This backend QA tool never changes AI rules or supplies test phrases.
"""
import argparse
import hashlib
import json
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

SERVICE_COMMIT = '311e8608d7e5d6ee0d2e938a870b67d16a7d6c68'
AI_TREE = '5555f1e1916cb803524499ceb01337a31d38fd86'
ENDPOINTS = ('consult', 'parse-need')


def load_cases(raw):
    cases = json.loads(raw)
    if not isinstance(cases, list) or not 30 <= len(cases) <= 50:
        raise ValueError('Нужно 30–50 фраз от людей.')
    counts = Counter()
    ids = set()
    for row in cases:
        if not isinstance(row, dict):
            raise ValueError('Каждая запись должна быть объектом.')
        if row.get('endpoint') not in ENDPOINTS:
            raise ValueError('endpoint: consult или parse-need.')
        for field in ('id', 'text', 'source', 'expected'):
            if not isinstance(row.get(field), str) or not row[field].strip():
                raise ValueError('Нужно непустое поле: ' + field)
        if row['id'] in ids or len(row['text']) > 4000:
            raise ValueError('Повторный id или текст длиннее 4000 символов.')
        ids.add(row['id'])
        counts[row['endpoint']] += 1
    if any(not 15 <= counts[e] <= 25 for e in ENDPOINTS):
        raise ValueError('Нужно по 15–25 фраз на каждый endpoint.')
    return cases


def capture(cases_path, output_path, base_url):
    url = urlsplit(base_url)
    if url.scheme != 'http' or url.hostname not in ('127.0.0.1', 'localhost') or url.path not in ('', '/') or url.query or url.fragment or url.username or url.password:
        raise ValueError('Для оценки используйте изолированный локальный AI, http://127.0.0.1:PORT.')
    raw = cases_path.read_bytes()
    cases = load_cases(raw)
    result = dict(service_commit=SERVICE_COMMIT, ai_tree=AI_TREE,
                  input_sha256=hashlib.sha256(raw).hexdigest(), base_url=base_url,
                  started_at=datetime.now(timezone.utc).isoformat(), rows=[])
    # Exclusive creation protects the first run from accidental replacement.
    with output_path.open('x', encoding='utf-8') as stream:
        for case in cases:
            body = {'text': case['text']}
            if case['endpoint'] == 'consult':
                body = dict(history=[], message=case['text'], state=dict(sphere=None, city=None, own_funds_rub=None, answers={}))
            row = dict(case, request=body, correct=None, reviewer=None, reason=None)
            started = time.monotonic()
            request = Request(base_url.rstrip('/') + '/ai/' + case['endpoint'],
                              data=json.dumps(body, ensure_ascii=False).encode('utf-8'),
                              headers={'Content-Type': 'application/json'}, method='POST')
            try:
                with urlopen(request, timeout=15) as response:
                    row.update(status=response.status, response_text=response.read().decode('utf-8'))
            except HTTPError as exc:
                row.update(status=exc.code, response_text=exc.read().decode('utf-8', errors='replace'))
            except (URLError, TimeoutError, OSError) as exc:
                row.update(status=None, response_text=None, transport_error=str(exc))
            row['elapsed_ms'] = round((time.monotonic() - started) * 1000, 2)
            result['rows'].append(row)
            # Keep partial evidence if a run is interrupted. Never retry silently.
            stream.seek(0)
            json.dump(result, stream, ensure_ascii=False, indent=2)
            stream.truncate()
            stream.flush()
    return result


def summary(result):
    output = {}
    for endpoint in ENDPOINTS:
        rows = [r for r in result['rows'] if r['endpoint'] == endpoint]
        reviewed = [r for r in rows if type(r.get('correct')) is bool and r.get('reviewer') and r.get('reason')]
        passed = sum(r['correct'] for r in reviewed)
        output[endpoint] = dict(total=len(rows), reviewed=len(reviewed), correct=passed,
                                percent=round(100 * passed / len(rows), 2) if rows and len(reviewed) == len(rows) else None)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    run = sub.add_parser('capture')
    run.add_argument('--cases', type=Path, required=True)
    run.add_argument('--output', type=Path, required=True)
    run.add_argument('--base-url', default='http://127.0.0.1:18001')
    report = sub.add_parser('summary')
    report.add_argument('reviewed', type=Path)
    args = parser.parse_args()
    if args.command == 'capture':
        result = capture(args.cases, args.output, args.base_url)
    else:
        result = json.loads(args.reviewed.read_text(encoding='utf-8'))
    print(json.dumps(summary(result), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
