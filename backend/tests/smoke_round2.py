"""Run against three live HTTP services, without frontend mocks or external model keys.

python tests/smoke_round2.py --url http://127.0.0.1:8000 --output /tmp/round2-result.json
Uses disposable demo applications and chat; run only against a demo database.
"""
import argparse
import json
import time
from datetime import datetime,timezone
from pathlib import Path

import httpx


def run(url):
    checks=[]
    with httpx.Client(base_url=url,timeout=15) as c:
        def request(method,path,h=None,**kwargs):
            r=c.request(method,path,headers=h,**kwargs)
            assert r.status_code in (200,201,204),f'{method} {path}: {r.status_code} {r.text}'
            return r.json() if r.content else None
        def login(email):
            data=request('POST','/api/auth/login',json=dict(email=email,password='demo12345'))
            return dict(Authorization='Bearer '+data['token'])
        h=login('client@xronix.demo');bank=login('analyst@xronix.demo')
        checks.append('both_demo_logins')
        rows=request('GET','/api/bank/applications?status=manual_review',bank)
        for inn in ('7768151886','777309114120'):
            row=next(x for x in rows if x['inn']==inn)
            card=request('GET','/api/bank/applications/'+row['id'],bank)
            assert len(card['checks'])==4
            if inn=='777309114120':assert card['scoring']['grade']=='C'
            card=request('POST','/api/bank/applications/'+row['id']+'/decision',bank,json=dict(kind='approve',version=card['application']['version'],comment='Проверено в сквозном сценарии.'))
            public=request('GET','/api/applications/'+row['id'],h)
            assert public['status']=='approved' and public['offer']==card['application']['offer']
            assert card['events'][-1]['actor']=='analyst'
        checks.append('analyst_vector_and_lebedev_c_client_offers')
        feed=request('GET','/api/feed',h)
        assert any(f['kind']=='offer' for f in feed)
        checks.append('client_feed')
        parsed=request('POST','/api/needs/parse',h,json=dict(text='Хочу открыть кофейню в Казани, нужно полтора миллиона на два года, без залога'))
        assert parsed['sphere']=='coffee' and parsed['city']=='Казань' and parsed['amount_rub']==1500000 and parsed['term_months']==24
        checks.append('parse_need_live_rules_service')
        chat=request('POST','/api/chats',h)['chat_id']
        reply=request('POST',f'/api/chats/{chat}/messages',h,json=dict(text='Хочу открыть кофейню в Казани, своих 500 тысяч'))
        if reply['type']=='questions':
            answers=[dict(question_id=q['id'],answer=q['options'][0] if q['kind']=='choice' else 'Не знаю') for q in reply['questions']]
            reply=request('POST',f'/api/chats/{chat}/messages',h,json=dict(text='Посчитайте по умолчанию',answers=answers))
        assert reply['type']=='plan',reply
        plan=reply['plan'];pid=reply['plan_id']
        assert plan['finance']['own_funds_rub']==500000
        assert request('GET','/api/plans/'+pid,h)['plan']==plan
        checks.append('chat_questions_to_backend_template_plan')
        co=request('POST','/api/companies',h,json=dict(inn='772519083310',member_role='owner',future=True))
        req=dict(company_id=co['id'],plan_id=pid,purpose='new_location',amount_rub=plan['finance']['funding_gap_rub'],term_months=36,has_collateral=True)
        items=request('POST','/api/products/match',h,json=req)['items']
        assert next(x for x in items if x['product_id']=='start')['eligible']
        req.pop('has_collateral');req.update(product_id='start',consent_bki=True,financials=dict(revenue_12m_rub=None,expenses_12m_rub=None,loan_payments_monthly_rub=0),collateral=dict(kind='guarantor',description='Поручитель',value_rub=1000000))
        a=request('POST','/api/applications',h,json=req)
        a=request('POST','/api/applications/'+a['id']+'/submit',h,json=dict(version=a['version']))
        deadline=time.monotonic()+30
        while a['status'] in ('submitted','checking','scoring') and time.monotonic()<deadline:
            time.sleep(.5);a=request('GET','/api/applications/'+a['id'],h)
        assert a['status'] in ('approved','counter_offer'),a
        assert 'зарегистрировать ИП' in a['offer']['explanation'][-1]
        checks.append('chat_plan_start_approval_registration_condition')
        bank_card=request('GET','/api/bank/applications/'+a['id'],bank)
        assert request('GET','/api/plans/'+pid,bank)['plan']==plan
        checks.append('analyst_linked_plan_access')
        stats=request('GET','/api/bank/stats',bank)
        return dict(status='ok',at=datetime.now(timezone.utc).isoformat(),url=url,checks=checks,application_id=a['id'],plan_id=pid,start_status=a['status'],stats=stats)


if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--url',default='http://127.0.0.1:8000');ap.add_argument('--output')
    args=ap.parse_args();result=run(args.url)
    text=json.dumps(result,ensure_ascii=False,indent=2)
    if args.output:Path(args.output).write_text(text+'\n',encoding='utf-8')
    print(text)
