"""Analyst API; all business transitions reuse the conveyor's transaction and version."""
from datetime import datetime, timezone

from fastapi import Body, Depends
from jsonschema import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import credit_rules as credit
from .conveyor_models import Application, ApplicationEvent, CheckResult, Company, Offer, ScoringResult
from .conveyor_state import expect_version
from .db import User, uid
from .errors import ApiError
from .validation import schema_error_ru


def timestamp(value):
    return datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()


def events(s,a):
    return s.scalars(select(ApplicationEvent).where(ApplicationEvent.application_id==a.id).order_by(ApplicationEvent.seq)).all()


def summary(kind,result,data):
    if result=='error':return 'Внешняя система недоступна. Нужна проверка специалиста.'
    if data.get('skipped'):return 'Не требуется для будущего ИП.'
    if kind=='completeness':return 'Нужны дополнительные данные.' if result!='ok' else 'Обязательные поля заполнены.'
    if kind=='egrul':return 'Компания действует.' if data.get('status')=='active' else 'Статус компании: '+str(data.get('status'))
    if kind=='fns':return 'Есть замечания ФНС.' if result!='ok' else 'Замечаний ФНС нет.'
    return 'Есть просрочки по кредитам.' if result!='ok' else 'Просрочек по кредитам нет.'


def bank_view(c,s,a):
    checks={}
    for x in s.scalars(select(CheckResult).where(CheckResult.application_id==a.id).order_by(CheckResult.at,CheckResult.id)):
        checks[x.kind]=dict(kind=x.kind,result=x.result,summary=summary(x.kind,x.result,x.data),details=x.data,source=x.source,checked_at=x.at)
    if c.company(s,a.company_id,a.user_id)['registry']['kind']=='person':
        for kind in ('egrul','fns'):
            checks.setdefault(kind,dict(kind=kind,result='ok',summary='Не требуется для будущего ИП.',details=dict(skipped=True),source='xronix',checked_at=a.updated_at))
    sc=s.get(ScoringResult,a.id)
    scoring=dict(**sc.data,rules_version=sc.rules_version) if sc else None
    rec=a.data.get('recommendation')
    if isinstance(rec,str):rec=dict(kind='request_info',text=rec)
    applicant=s.get(User,a.user_id)
    result=dict(application=c.view(s,a),applicant=dict(name=applicant.name,email=applicant.email,member_role=c.company(s,a.company_id,a.user_id)['member_role']),
                checks=[checks[k] for k in ('completeness','egrul','fns','bki') if k in checks],scoring=scoring,recommendation=rec,
                events=[dict(id=e.id,from_status=e.from_status,to_status=e.to_status,actor=e.actor,actor_name=(s.get(User,e.actor_id).name if e.actor_id and s.get(User,e.actor_id) else 'Система'),reason=e.reason or None,at=e.at) for e in events(s,a)])
    c.contracts.validate('bank',result,'bank_application')
    return result


def apply_decision(c,s,a,body,user):
    if a.status!='manual_review':raise ApiError('INVALID_TRANSITION')
    expect_version(a,body['version'])
    kind,comment=body['kind'],body['comment'].strip()
    p=c.products[a.data['product_id']]
    if kind in ('approve','counter'):
        sc=s.get(ScoringResult,a.id)
        amount=body.get('amount_rub',a.data['amount_rub'])
        term=body.get('term_months',a.data['term_months'])
        rate=body.get('rate_percent',credit.rate_for(p,sc.data['grade'] if sc else 'B',c.rules))
        if not (p['amountMin'] or 0)<=amount<=p['amountMax']:
            raise ApiError('VALIDATION_ERROR',f"Сумма для этого продукта — от {p['amountMin'] or 0:,} до {p['amountMax']:,} ₽.".replace(',','\u00a0'))
        if not (p['termMin'] or 1)<=term<=p['termMax']:
            raise ApiError('VALIDATION_ERROR',f"Срок для этого продукта — от {p['termMin'] or 1} до {p['termMax']} мес.")
        if rate<(p['rateFrom'] or 0):raise ApiError('VALIDATION_ERROR',f"Ставка не может быть ниже {p['rateFrom']:g}%.".replace('.',','))
        if kind=='counter' and amount==a.data['amount_rub'] and term==a.data['term_months']:
            raise ApiError('VALIDATION_ERROR','Во встречном предложении измените сумму или срок.')
        if kind=='counter' and not comment:raise ApiError('VALIDATION_ERROR','Объясните клиенту, почему условия другие.')
        explanation=['Заявку одобрил кредитный специалист.' if kind=='approve' else 'Кредитный специалист предложил другие условия.']
        if comment:explanation.append(comment)
        if c.company(s,a.company_id,a.user_id)['registry']['kind']=='person':explanation.append(c.rules['start']['condition_text'])
        if p['id']=='gov_guarantee':explanation.append(credit.GOV_TEXT)
        rows=credit.schedule(amount,rate,term)
        offer=s.scalar(select(Offer).where(Offer.application_id==a.id))
        if not offer:offer=Offer(id=uid(),application_id=a.id);s.add(offer)
        offer.data=dict(id=offer.id,kind=kind,product_id=p['id'],amount_rub=amount,term_months=term,rate_percent=rate,monthly_payment_rub=credit.payment(amount,rate,term),total_payment_rub=sum(r['payment_rub'] for r in rows),explanation=explanation,schedule=rows,status='pending')
        a.data={**a.data,'info_request':None,'decline':None}
        c.move(s,a,'approved' if kind=='approve' else 'counter_offer','analyst',user.id,comment)
    elif kind=='request_info':
        if not body.get('info_items'):raise ApiError('VALIDATION_ERROR','Укажите, какие данные нужны.')
        items=[dict(kind=x['kind'],text=x['text'].strip() or c.dict['info_request_kinds'][x['kind']]['text']) for x in body['info_items']]
        a.data={**a.data,'info_request':dict(items=items,comment=comment or None)}
        c.move(s,a,'info_requested','analyst',user.id,comment)
    elif kind=='decline':
        if not body.get('decline_reasons'):raise ApiError('VALIDATION_ERROR','Выберите причину отказа.')
        if not comment:raise ApiError('VALIDATION_ERROR','Комментарий к отказу обязателен.')
        params=dict(min_months=str(p['minBusinessMonths'] or 0),eligible_date='',limit_rub=credit.rub(c.rules['stop_factors']['tax_debt_max_rub'])[:-2],max_amount_rub='',min_share=f"{c.rules['start']['min_own_share']*100:g}")
        if 'business_too_young' in body['decline_reasons']:
            company=c.company(s,a.company_id,a.user_id)
            registry=company['registry']
            minimum=p['minBusinessMonths'] or 0
            if minimum==0 or (registry['registered_at'] and company['business_months']>=minimum):
                raise ApiError('VALIDATION_ERROR','Стаж бизнеса уже соответствует требованиям продукта. Выберите другую причину отказа.')
            try:params['eligible_date']=credit.eligible_date(registry['registered_at'],p['minBusinessMonths'] or 0)
            except (TypeError,ValueError,OverflowError):pass
        if p.get('validUntil'):params['valid_until']=datetime.fromisoformat(p['validUntil']).strftime('%d.%m.%Y')
        reasons=[]
        for code in body['decline_reasons']:
            values={**params}
            if code=='not_msp':values['limit_rub']=credit.rub(c.rules['gov_guarantee']['msp_max_revenue_rub'])[:-2]
            reasons.append(credit.decline_text(dict(code=code,params=values),c.dict))
        a.data={**a.data,'decline':dict(reasons=reasons,comment=comment),'info_request':None}
        c.move(s,a,'declined','analyst',user.id,comment)
    else:raise ApiError('VALIDATION_ERROR','Неизвестное решение.')


def install(app,authenticated,db):
    c=app.state.conveyor
    def analyst(user:User=Depends(authenticated)):
        if user.role!='analyst':raise ApiError('NOT_FOUND')
        return user
    def visible(s,id):
        a=s.scalar(select(Application).where(Application.id==id,Application.status!='draft'))
        if a is None:raise ApiError('NOT_FOUND')
        return a

    @app.get('/api/bank/applications')
    def queue(status:str|None=None,user:User=Depends(analyst),s:Session=Depends(db)):
        query=select(Application).where(Application.status!='draft')
        if status:
            values=status.split(',')
            if any(v not in c.dict['statuses'] for v in values):raise ApiError('VALIDATION_ERROR','Неизвестный статус.')
            query=query.where(Application.status.in_(values))
        result=[]
        stamp=datetime.now(timezone.utc).timestamp()
        for a in s.scalars(query.order_by(Application.updated_at,Application.seq)):
            company=s.get(Company,a.company_id)
            sc=s.get(ScoringResult,a.id)
            es=events(s,a)
            submitted=next((e.at for e in es if e.to_status=='submitted'),None)
            result.append(dict(id=a.id,number=f'Z-{a.created_at[:4]}-{a.seq:06}',status=a.status,company_name=company.registry['name'],inn=company.inn,product_id=a.data['product_id'],amount_rub=a.data['amount_rub'],term_months=a.data['term_months'],grade=sc.data['grade'] if sc else None,submitted_at=submitted,waiting_minutes=max(0,int((stamp-timestamp(es[-1].at if es else a.updated_at))/60))))
        return sorted(result,key=lambda x:-x['waiting_minutes'])

    @app.get('/api/bank/applications/{id}')
    def application(id:str,user:User=Depends(analyst),s:Session=Depends(db)):
        return bank_view(c,s,visible(s,id))

    @app.post('/api/bank/applications/{id}/decision')
    def decide(id:str,body:dict=Body(example=dict(kind='approve',version=5,comment='')),user:User=Depends(analyst),s:Session=Depends(db)):
        a=visible(s,id)
        try:c.contracts.validate('bank',body,'decision_request')
        except ValidationError as exc:raise ApiError('VALIDATION_ERROR',schema_error_ru(exc)) from None
        apply_decision(c,s,a,body,user)
        c.commit(s)
        return bank_view(c,s,a)

    @app.get('/api/bank/stats')
    def stats(user:User=Depends(analyst),s:Session=Depends(db)):
        by_status={};decisions=[]
        for a in s.scalars(select(Application).where(Application.status!='draft')):
            by_status[a.status]=by_status.get(a.status,0)+1
            es=events(s,a)
            submitted=next((e for e in es if e.to_status=='submitted'),None)
            decision=next((e for e in reversed(es) if e.to_status in ('approved','counter_offer','declined')),None)
            if submitted and decision:decisions.append((decision.actor,(timestamp(decision.at)-timestamp(submitted.at))/60))
        n=len(decisions)
        return dict(by_status=by_status,auto_decision_share=round(sum(a=='system' for a,_ in decisions)/n,2) if n else 0,avg_minutes_to_decision=round(sum(t for _,t in decisions)/n,1) if n else None)
