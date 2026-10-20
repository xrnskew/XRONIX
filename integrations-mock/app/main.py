"""Synthetic external systems. Never queries live company or credit data."""
import hashlib
import json
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from .inn import valid_inn

SCENARIOS = json.loads((Path(__file__).resolve().parents[1]/'data/companies.json').read_text())
app = FastAPI(title='XRONIX integrations mock')


def generated(inn):
    h = int.from_bytes(hashlib.sha256(inn.encode()).digest(), 'big')
    ip = len(inn) == 12
    year, month, day = 2015+h%11, 1+(h>>4)%12, 1+(h>>8)%28
    digits = (str(h)*2)[:9 if ip else 7]
    base = f"{'3' if ip else '1'}{str(year)[2:]}77{digits}"
    ogrn = base+str(int(base)%(13 if ip else 11)%10)
    trouble, kind = (h>>20)%5 == 0, (h>>24)%3
    head = ['Иванов Сергей Петрович', 'Смирнова Анна Олеговна', 'Кузнецов Дмитрий Ильич'][(h>>16)%3]
    pay = ((h>>6)%4)*25000
    return dict(registry=dict(inn=inn,ogrn=ogrn,name=f'ИП {head}' if ip else f'ООО «Синтетика {h%1000}»',kind='ip' if ip else 'ul',status='active',registered_at=f'{year}-{month:02}-{day:02}',okved=dict(code='62.01',name='Разработка программного обеспечения'),address='г. Москва',head_name=head,source='mock-egrul v1'),
                fns=dict(inn=inn,mass_address=trouble and kind==0,tax_debt_rub=40000 if trouble and kind==1 else 0,head_disqualified=False,source='mock-fns v1'),
                bki=dict(inn=inn,has_history=True,history_months=12+h%60,loans=[dict(lender='Синтетический банк',monthly_payment_rub=pay,balance_rub=pay*15)] if pay else [],overdue_30_24m=int(trouble and kind==2),overdue_90_12m=0,source='mock-bki v1'))


def failure(code, message, status=400):
    return JSONResponse(dict(error=dict(code=code, message=message)),status_code=status)


def external(inn):
    if not valid_inn(inn):
        return failure('INVALID_INN','ИНН не прошёл контрольную сумму.')
    if inn == os.getenv('FAIL_INN'):
        return failure('INTEGRATION_UNAVAILABLE','Мок временно недоступен.',503)
    return SCENARIOS.get(inn) or generated(inn)


@app.get('/health')
def health():
    return {'status':'ok'}


@app.get('/egrul/{inn}')
def egrul(inn: str):
    data=external(inn)
    return data if isinstance(data, JSONResponse) else data['registry']


@app.get('/fns/{inn}')
def fns(inn: str):
    data=external(inn)
    return data if isinstance(data, JSONResponse) else data['fns']


@app.post('/bki/report')
async def bki(request: Request):
    try:
        body=await request.json()
    except ValueError:
        return failure('VALIDATION_ERROR','Проверьте тело запроса.')
    if not isinstance(body, dict) or set(body) != {'inn','consent'} or body['consent'] is not True:
        return failure('VALIDATION_ERROR','Необходимо согласие на БКИ.')
    data=external(body['inn'])
    if isinstance(data, JSONResponse):
        return data
    if body['inn']=='772519083310':
        return dict(inn=body['inn'],has_history=True,history_months=24,loans=[],overdue_30_24m=0,overdue_90_12m=0,source='mock-bki v1')
    return data['bki']
