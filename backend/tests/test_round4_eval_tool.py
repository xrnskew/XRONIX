"""The independent set must keep raw failures and cannot show partial accuracy."""
import json
from io import BytesIO
from urllib.error import HTTPError

import pytest

from tools import evaluate_round4 as ev


def cases():
    # Synthetic transport fixtures, never included in the human evaluation set.
    return [dict(id=str(i), endpoint='consult' if i < 15 else 'parse-need',
                 text='Тест транспорта', source='synthetic', expected='Не оценивать качество чата') for i in range(30)]


def test_capture_keeps_http_failures_utf8_input_and_first_output(tmp_path, monkeypatch):
    source = tmp_path / 'cases.json'
    source.write_text(json.dumps(cases(), ensure_ascii=False), encoding='utf-8')
    output = tmp_path / 'raw.json'
    requests = []

    def fail(request, timeout):
        requests.append(json.loads(request.data))
        raise HTTPError(request.full_url, 422, 'bad', {}, BytesIO('{"ошибка":"тест"}'.encode()))

    monkeypatch.setattr(ev, 'urlopen', fail)
    result = ev.capture(source, output, 'http://127.0.0.1:18001')
    assert len(result['rows']) == 30
    assert requests[0]['message'] == requests[-1]['text'] == 'Тест транспорта'
    assert requests[0]['history'] == [] and requests[0]['state']['city'] is None
    assert all(r['status'] == 422 and r['response_text'] == '{"ошибка":"тест"}' for r in result['rows'])
    assert json.loads(output.read_text(encoding='utf-8')) == result
    assert all(s['percent'] is None for s in ev.summary(result).values())
    with pytest.raises(FileExistsError):
        ev.capture(source, output, 'http://127.0.0.1:18001')
    assert len(requests) == 30


def test_summary_requires_all_human_labels_and_keeps_failures_in_denominator():
    rows = [dict(row, correct=True, reviewer='reviewer', reason='Проверено') for row in cases()]
    rows[0]['correct'] = False
    rows[15]['correct'] = None
    result = ev.summary(dict(rows=rows))
    assert result['consult'] == dict(total=15, reviewed=15, correct=14, percent=93.33)
    assert result['parse-need']['percent'] is None


def test_input_requires_both_groups_and_unique_ids():
    rows = cases()
    rows[-1]['id'] = rows[0]['id']
    with pytest.raises(ValueError, match='Повторный'):
        ev.load_cases(json.dumps(rows))
    with pytest.raises(ValueError, match='30–50'):
        ev.load_cases('[]')
    rows = cases()
    rows[-1]['endpoint'] = 'consult'
    with pytest.raises(ValueError, match='15–25'):
        ev.load_cases(json.dumps(rows))
