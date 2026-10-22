"""Client API and a durable, leased background conveyor."""
import asyncio
import json
import logging
import time
from pathlib import Path

from fastapi import Body, Depends, File, Form, UploadFile
from fastapi.responses import Response
from jsonschema import ValidationError
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from . import credit_rules as credit, project_calc
from .conveyor_models import Application, ApplicationEvent, CheckResult, Company, CompanyMember, Document, FeedItem, Offer, ScoringResult
from .conveyor_state import AUTO, expect_version, transition
from .db import Chat, Plan, User, now, uid
from .errors import ApiError
from .inn import valid_inn
from .storage import database_path

logger=logging.getLogger(__name__)
CATALOG=Path(__file__).parent/'catalog'


def load(root, name):
    return json.loads((root/name).read_text(encoding='utf-8'))


class Conveyor:
    def __init__(self, settings, contracts, sessions):
        self.settings,self.contracts,self.sessions=settings,contracts,sessions
        self.rules=load(contracts.root,'rules/credit_rules.v1.json')
        self.dict=load(contracts.root,'dictionaries.json')
        self.products={p['id']:p for p in load(CATALOG,'products.json')['products']+load(contracts.root,'products.gov.json')['products']+load(contracts.root,'products.demo.json')['products']}
        self.templates=load(contracts.root,'templates/spheres.v1.json')
        self.templates['city_wages']=load(contracts.root,'templates/city_wages.v1.json')  # зарплаты считаются от средней по региону

    def validate(self, definition, body):
        try:
            self.contracts.validate('conveyor',body,definition)
        except ValidationError as exc:
            from .validation import schema_error_ru
            raise ApiError('VALIDATION_ERROR',schema_error_ru(exc)) from None

    def company(self,s,company_id,user_id):
        member=s.get(CompanyMember,(user_id,company_id))
        if member is None:
            raise ApiError('NOT_FOUND')
        company=s.get(Company,company_id)
        return dict(id=company.id,registry=company.registry,member_role=member.member_role,authority_confirmed=member.authority_confirmed,business_months=credit.business_months(company.registry['registered_at']))

    def owned(self,s,id,user):
        a=s.scalar(select(Application).where(Application.id==id,Application.user_id==user.id))
        if a is None:
            raise ApiError('NOT_FOUND')
        return a

    def plan(self,s,id,user_id):
        if not id:
            return None
        plan=s.scalar(select(Plan).where(Plan.id==id,Plan.user_id==user_id))
        if plan is None:
            raise ApiError('NOT_FOUND')
        return plan.body

    def missing(self,a,company):
        d=a.data
        missing=[]
        for key in ('purpose','amount_rub','term_months'):
            if not d.get(key):
                missing.append(key)
        person=company['registry']['kind']=='person'
        for key,value in d['financials'].items():
            if value is None and (not person or key=='loan_payments_monthly_rub'):
                missing.append('financials.'+key)
        if not d['consent_bki']:
            missing.append('consent_bki')
        p=self.products[d['product_id']]
        if p['collateral'] and (not d.get('collateral') or d['collateral']['value_rub']<=0 or not d['collateral']['description'].strip()):
            missing.append('collateral')
        return missing

    def valid_terms(self,d,person=False):
        p=self.products[d['product_id']]
        if d['product_id'] not in self.rules['applicable_products'] or (person and p['id']!='start'):
            raise ApiError('VALIDATION_ERROR','Этот продукт недоступен для подачи заявки.')
        if d['amount_rub'] and not (p['amountMin'] or 0)<=d['amount_rub']<=p['amountMax']:
            raise ApiError('VALIDATION_ERROR','Сумма вне диапазона продукта.')
        if not (p['termMin'] or 1)<=d['term_months']<=p['termMax']:
            raise ApiError('VALIDATION_ERROR','Срок вне диапазона продукта.')
        rev=d['financials']['revenue_12m_rub']
        if p['id']!='start' and rev is not None and d['amount_rub']>rev*self.rules['checks']['max_amount_to_revenue']:
            raise ApiError('VALIDATION_ERROR','Сумма превышает допустимое отношение к годовой выручке.')

    def view(self,s,a):
        company=self.company(s,a.company_id,a.user_id)
        d=a.data
        offer=s.scalar(select(Offer).where(Offer.application_id==a.id))
        result=dict(id=a.id,number=f'Z-{a.created_at[:4]}-{a.seq:06}',status=a.status,status_info=self.dict['statuses'][a.status],version=a.version,created_at=a.created_at,updated_at=a.updated_at,company=company,
                    **{k:d[k] for k in ('product_id','purpose','amount_rub','term_months','plan_id','financials','collateral','consent_bki')},
                    documents=[dict(id=x.id,kind=x.kind,filename=x.filename,uploaded_at=x.uploaded_at) for x in s.scalars(select(Document).where(Document.application_id==a.id).order_by(Document.uploaded_at,Document.id))],
                    missing_fields=self.missing(a,company) if a.status=='draft' else [],
                    info_request=d.get('info_request') if a.status=='info_requested' else None,
                    offer=offer.data if offer and a.status in {'approved','counter_offer','signing','funded'} else None,decline=d.get('decline'),
                    timeline=[dict(status=e.to_status,at=e.at,actor=e.actor,text=self.dict['statuses'][e.to_status]['title']) for e in s.scalars(select(ApplicationEvent).where(ApplicationEvent.application_id==a.id).order_by(ApplicationEvent.seq))])
        self.contracts.validate('conveyor',result,'application')
        return result

    def move(self,s,a,target,actor='system',actor_id=None,reason=''):
        transition(s,a,target,actor,self.dict,self.rules,actor_id,reason)

    def commit(self,s):
        try:
            s.commit()
        except StaleDataError:
            s.rollback()
            raise ApiError('VERSION_CONFLICT') from None

    def decline(self,s,a,reasons):
        a.data={**a.data,'decline':dict(reasons=[credit.decline_text(r,self.dict) for r in reasons]),'recommendation':dict(kind='decline',text=' '.join(credit.decline_text(r,self.dict)['text'] for r in reasons))}
        self.move(s,a,'declined',reason=','.join(r['code'] for r in reasons))

    def input(self,s,a,external):
        submitted=s.scalar(select(ApplicationEvent).where(ApplicationEvent.application_id==a.id,ApplicationEvent.actor=='client',ApplicationEvent.to_status.in_(('submitted','checking'))).order_by(ApplicationEvent.seq.desc()).limit(1))
        return dict(**{k:a.data[k] for k in ('financials','product_id','amount_rub','term_months','collateral')},**external,
                    submitted_on=submitted.at[:10] if submitted else None,
                    person=external['registry']['kind']=='person',plan=(self.plan(s,a.data['plan_id'],a.user_id) or {}).get('finance'))

    async def step(self,integrations,application_id=None):
        stamp=time.time()
        with self.sessions() as s:
            query=select(Application).where(Application.status.in_(AUTO),Application.lease_until<stamp)
            query=query.where(Application.id==application_id) if application_id else query.where(Application.due_at<=stamp)
            a=s.scalar(query.order_by(Application.due_at,Application.seq).limit(1))
            if a is None:
                return False
            id,version,status=a.id,a.version,a.status
            lease=stamp+30
            got=s.execute(update(Application).where(Application.id==id,Application.version==version,Application.lease_until<stamp).values(lease_until=lease)).rowcount
            s.commit()
            if not got:
                return True
            company=self.company(s,a.company_id,a.user_id)
        external,errors={},{}
        if status=='checking':
            person=company['registry']['kind']=='person'
            kinds=['bki'] if person else ['egrul','fns','bki']
            for kind in kinds:
                try:
                    external['registry' if kind=='egrul' else kind]=await integrations.request(kind,company['registry']['inn'])
                except ApiError:
                    errors[kind]='INTEGRATION_UNAVAILABLE'
            if person:
                external.update(registry=company['registry'],fns=dict(inn=company['registry']['inn'],mass_address=False,tax_debt_rub=0,head_disqualified=False,source='xronix-person'))
        with self.sessions() as s:
            a=s.scalar(select(Application).where(Application.id==id,Application.version==version,Application.lease_until==lease))
            if a is None:
                return True
            if status=='submitted':
                self.move(s,a,'checking')
            elif status=='checking':
                for kind in (['bki'] if company['registry']['kind']=='person' else ['egrul','fns','bki']):
                    data=external.get('registry' if kind=='egrul' else kind,{})
                    result='ok'
                    if kind in errors:
                        result='error'
                    elif kind=='egrul' and data['status'] in self.rules['stop_factors']['inactive_statuses']:
                        result='fail'
                    elif kind=='bki':
                        result='fail' if data['overdue_90_12m']>self.rules['stop_factors']['overdue_90_12m_max'] else 'warn' if data['overdue_30_24m'] else 'ok'
                    elif kind=='fns':
                        result='fail' if data['head_disqualified'] or data['tax_debt_rub']>self.rules['stop_factors']['tax_debt_max_rub'] else 'warn' if data['mass_address'] or data['tax_debt_rub'] else 'ok'
                    s.add(CheckResult(application_id=id,kind=kind,result=result,data=data or dict(error=errors.get(kind)),source=data.get('source','integrations-mock')))
                missing=self.missing(a,company)
                s.add(CheckResult(application_id=id,kind='completeness',result='warn' if missing or not company['authority_confirmed'] else 'ok',data=dict(missing_fields=missing),source='xronix'))
                if errors:
                    a.data={**a.data,'recommendation':'Внешние проверки недоступны: '+', '.join(errors)}
                    self.move(s,a,'manual_review',reason='integration_error')
                elif not company['authority_confirmed'] or missing:
                    kinds=(['authority_document'] if not company['authority_confirmed'] else [])+(['financials'] if missing else [])
                    a.data={**a.data,'info_request':dict(items=[dict(kind=k,text=self.dict['info_request_kinds'][k]['text']) for k in kinds],comment=None)}
                    self.move(s,a,'info_requested')
                else:
                    i=self.input(s,a,external)
                    stops=credit.stop_factors(i,self.products[a.data['product_id']],self.rules)
                    a.data={**a.data,'external':external,'info_request':None}
                    if stops:
                        self.decline(s,a,stops)
                    else:
                        self.move(s,a,'scoring')
            elif status=='scoring':
                i=self.input(s,a,a.data['external'])
                p=self.products[a.data['product_id']]
                sc=credit.score(i,p,self.rules)
                decision=credit.decide(i,sc,p,self.rules)
                s.merge(ScoringResult(application_id=id,data=sc,rules_version=self.rules['version']))
                rec_kind={'approve':'approve','counter':'counter','manual':('counter' if sc['grade']=='C' else 'approve'),'decline':'decline'}[decision['kind']]
                recommendation=dict(kind=rec_kind,text=decision.get('recommendation') or (' '.join(decision['explanation']) if 'explanation' in decision else 'Рекомендуется отказ по кредитной оценке.'))
                recommendation.update({k:decision[k] for k in ('amount_rub','term_months','rate_percent') if k in decision})
                a.data={**a.data,'recommendation':recommendation}
                if decision['kind']=='decline':
                    self.decline(s,a,decision['reasons'])
                elif decision['kind']=='manual':
                    a.data={**a.data,'recommendation':dict(kind='counter' if sc['grade']=='C' else 'approve',text=decision['recommendation'],amount_rub=i['amount_rub'],term_months=i['term_months'],rate_percent=credit.rate_for(p,sc['grade'],self.rules))}
                    self.move(s,a,'manual_review')
                else:
                    offer_id=uid()
                    rows=credit.schedule(decision['amount_rub'],decision['rate_percent'],decision['term_months'])
                    body=dict(id=offer_id,**decision,product_id=p['id'],monthly_payment_rub=credit.payment(decision['amount_rub'],decision['rate_percent'],decision['term_months']),total_payment_rub=sum(r['payment_rub'] for r in rows),schedule=rows,status='pending')
                    s.add(Offer(id=offer_id,application_id=id,data=body))
                    self.move(s,a,'approved' if decision['kind']=='approve' else 'counter_offer')
            self.commit(s)
        return True

    async def worker(self,app):
        while True:
            try:
                worked=await self.step(app.state.integrations)
                if not worked:
                    await asyncio.sleep(0.25)
            except asyncio.CancelledError:
                raise
            except (OperationalError,StaleDataError,ApiError):
                await asyncio.sleep(0.25)
            except Exception:
                logger.exception('Conveyor stage failed; persisted lease will allow retry')
                await asyncio.sleep(1)


def install(app,settings,contracts,sessions,authenticated,db):
    def client_user(user:User=Depends(authenticated)):
        if user.role!='client':
            raise ApiError('NOT_FOUND')
        return user

    c=Conveyor(settings,contracts,sessions)
    app.state.conveyor=c
    def example(name):
        return Body(openapi_examples={'example':{'value':contracts.example(name)}})

    @app.get('/api/registry/{inn}')
    async def registry(inn:str,user:User=Depends(client_user)):
        if not valid_inn(inn):
            raise ApiError('INVALID_INN')
        return await app.state.integrations.request('egrul',inn)

    @app.post('/api/companies',status_code=201)
    async def create_company(response:Response,body:dict=example('company.create.json'),user:User=Depends(client_user),s:Session=Depends(db)):
        c.validate('company_create',body)
        if not valid_inn(body['inn']):
            raise ApiError('INVALID_INN')
        future=body.get('future',False)
        if future and (len(body['inn'])!=12 or body['member_role']!='owner'):
            raise ApiError('VALIDATION_ERROR','Будущий ИП: личный ИНН и роль owner.')
        company=s.scalar(select(Company).where(Company.inn==body['inn']))
        if company and s.get(CompanyMember,(user.id,company.id)):
            response.status_code=200
            return c.company(s,company.id,user.id)
        if company and (company.registry['kind']=='person')!=future:
            raise ApiError('VALIDATION_ERROR','ИНН уже привязан к другому типу компании.')
        if not company:
            if future:
                registry=dict(inn=body['inn'],ogrn=None,name=user.name,kind='person',status='not_registered',registered_at=None,okved=None,address='',head_name=user.name,source='xronix')
            else:
                registry=await app.state.integrations.request('egrul',body['inn'])
            company=Company(id=uid(),inn=body['inn'],registry=registry)
            s.add(company)
            try:
                s.flush()
            except IntegrityError:
                s.rollback()
                company=s.scalar(select(Company).where(Company.inn==body['inn']))
                if company is None or (company.registry['kind']=='person')!=future:
                    raise ApiError('VALIDATION_ERROR') from None
        s.add(CompanyMember(user_id=user.id,company_id=company.id,member_role=body['member_role'],authority_confirmed=not c.dict['member_roles'][body['member_role']]['needs_authority']))
        try:
            c.commit(s)
        except IntegrityError:
            s.rollback()
            response.status_code=200
        return c.company(s,company.id,user.id)

    @app.get('/api/companies')
    def companies(user:User=Depends(client_user),s:Session=Depends(db)):
        return [c.company(s,id,user.id) for id in s.scalars(select(CompanyMember.company_id).where(CompanyMember.user_id==user.id))]

    async def save_file(file):
        content=await file.read(5*1024*1024+1)
        if len(content)>5*1024*1024:
            raise ApiError('VALIDATION_ERROR','Файл должен быть не больше 5 МБ.')
        directory=database_path(settings).parent/'uploads'
        directory.mkdir(mode=0o700,parents=True,exist_ok=True)
        path=directory/uid()
        with path.open('xb') as stream:
            import os
            os.chmod(path,0o600)
            stream.write(content)
        return path, (file.filename or 'document').replace('\\','/').split('/')[-1][:255]

    @app.post('/api/companies/{id}/authority')
    async def authority(id:str,file:UploadFile=File(),user:User=Depends(client_user),s:Session=Depends(db)):
        c.company(s,id,user.id)
        path,_=await save_file(file)
        try:
            member=s.get(CompanyMember,(user.id,id))
            member.authority_confirmed=True
            member.authority_path=str(path)
            c.commit(s)
        except Exception:
            path.unlink(missing_ok=True)
            raise
        return c.company(s,id,user.id)

    @app.get('/api/templates')
    def templates(user:User=Depends(client_user)):
        return project_calc.templates(c.templates)

    @app.post('/api/plans/calculate',status_code=201)
    def calculate(body:dict=example('plan.calc.request.json'),user:User=Depends(client_user),s:Session=Depends(db)):
        c.validate('plan_calc_request',body)
        try:
            plan=project_calc.calculate(body,c.templates,c.products)
        except ValueError as exc:
            raise ApiError('VALIDATION_ERROR',str(exc)) from None
        contracts.validate('plan',plan)
        chat=Chat(user_id=user.id,title=plan['title'][:60])
        s.add(chat)
        s.flush()
        plan_id=uid()
        chat.plan_id=plan_id
        s.add(Plan(id=plan_id,user_id=user.id,chat_id=chat.id,body=plan))
        c.commit(s)
        return dict(plan_id=plan_id,plan=plan)

    @app.post('/api/products/match')
    def match(body:dict=example('match.request.json'),user:User=Depends(client_user),s:Session=Depends(db)):
        c.validate('match_request',body)
        company=c.company(s,body['company_id'],user.id) if body.get('company_id') else None
        plan=c.plan(s,body.get('plan_id'),user.id)
        return dict(items=credit.match_products(body,company['business_months'] if company else None,c.products,c.rules,person=bool(company and company['registry']['kind']=='person'),plan=plan['finance'] if plan else None))

    @app.post('/api/applications',status_code=201)
    def create_application(body:dict=example('application.create.json'),user:User=Depends(client_user),s:Session=Depends(db)):
        c.validate('application_draft',body)
        if not body.get('company_id') or not body.get('product_id') or 'version' in body or 'info_response' in body:
            raise ApiError('VALIDATION_ERROR','Укажите company_id и product_id.')
        company=c.company(s,body['company_id'],user.id)
        plan=c.plan(s,body.get('plan_id'),user.id)
        data=dict(product_id=body['product_id'],purpose=body.get('purpose','equipment'),amount_rub=body.get('amount_rub',plan['finance']['funding_gap_rub'] if plan else 0),term_months=body.get('term_months',24),plan_id=body.get('plan_id'),financials=body.get('financials',dict.fromkeys(['revenue_12m_rub','expenses_12m_rub','loan_payments_monthly_rub'])),collateral=body.get('collateral'),consent_bki=body.get('consent_bki',False))
        c.valid_terms(data,company['registry']['kind']=='person')
        a=Application(id=uid(),user_id=user.id,company_id=company['id'],data=data)
        s.add(a)
        s.flush()
        s.add(ApplicationEvent(application_id=a.id,from_status=None,to_status='draft',actor='client',actor_id=user.id))
        c.commit(s)
        return c.view(s,a)

    @app.get('/api/applications')
    def applications(user:User=Depends(client_user),s:Session=Depends(db)):
        out=[]
        for a in s.scalars(select(Application).where(Application.user_id==user.id).order_by(Application.seq.desc())):
            out.append(dict(id=a.id,number=f'Z-{a.created_at[:4]}-{a.seq:06}',status=a.status,status_title=c.dict['statuses'][a.status]['title'],company_name=s.get(Company,a.company_id).registry['name'],product_id=a.data['product_id'],amount_rub=a.data['amount_rub'],updated_at=a.updated_at))
        return out

    @app.get('/api/applications/{id}')
    def application(id:str,user:User=Depends(client_user),s:Session=Depends(db)):
        return c.view(s,c.owned(s,id,user))

    @app.patch('/api/applications/{id}')
    def patch(id:str,body:dict=example('application.patch.json'),user:User=Depends(client_user),s:Session=Depends(db)):
        a=c.owned(s,id,user)
        c.validate('application_draft',body)
        expect_version(a,body.get('version'))
        if a.status not in {'draft','info_requested'}:
            raise ApiError('INVALID_TRANSITION')
        allowed={'financials','collateral','info_response','version'} if a.status=='info_requested' else {'version','product_id','purpose','amount_rub','term_months','plan_id','financials','collateral','consent_bki'}
        if set(body)-allowed:
            raise ApiError('VALIDATION_ERROR','Эти поля нельзя изменять в текущем статусе.')
        if body.get('plan_id'):
            c.plan(s,body['plan_id'],user.id)
        a.data={**a.data,**{k:v for k,v in body.items() if k!='version'}}
        c.valid_terms(a.data,c.company(s,a.company_id,user.id)['registry']['kind']=='person')
        a.updated_at=now()
        c.commit(s)
        return c.view(s,a)

    @app.post('/api/applications/{id}/submit')
    def submit(id:str,body:dict=Body(example={'version':1}),user:User=Depends(client_user),s:Session=Depends(db)):
        a=c.owned(s,id,user)
        if set(body)!={'version'}:
            raise ApiError('VALIDATION_ERROR')
        expect_version(a,body['version'])
        if a.status not in {'draft','info_requested'}:
            raise ApiError('INVALID_TRANSITION')
        company=c.company(s,a.company_id,user.id)
        missing=c.missing(a,company)
        if missing:
            raise ApiError('INCOMPLETE_APPLICATION','Не заполнены: '+', '.join(missing))
        c.valid_terms(a.data,company['registry']['kind']=='person')
        c.move(s,a,'submitted' if a.status=='draft' else 'checking',user.role,user.id)
        c.commit(s)
        return c.view(s,a)

    def action(id:str,action:str,body:dict=Body(example={'version':1}),user:User=Depends(client_user),s:Session=Depends(db)):
        targets={'accept':'signing','reject-offer':'cancelled','sign':'funded','withdraw':'withdrawn'}
        if action not in targets:
            raise ApiError('NOT_FOUND')
        a=c.owned(s,id,user)
        if set(body)!={'version'}:
            raise ApiError('VALIDATION_ERROR')
        expect_version(a,body['version'])
        c.move(s,a,targets[action],user.role,user.id)
        offer=s.scalar(select(Offer).where(Offer.application_id==a.id))
        if offer and action in {'accept','reject-offer'}:
            offer.data={**offer.data,'status':'accepted' if action=='accept' else 'rejected'}
        c.commit(s)
        return c.view(s,a)

    def action_endpoint(name):
        def endpoint(id:str,body:dict=Body(example={'version':1}),user:User=Depends(client_user),s:Session=Depends(db)):
            return action(id,name,body,user,s)
        return endpoint

    for name in ('accept','reject-offer','sign','withdraw'):
        app.add_api_route('/api/applications/{id}/'+name,action_endpoint(name),methods=['POST'],name=name)

    @app.post('/api/applications/{id}/documents',status_code=201)
    async def document(id:str,file:UploadFile=File(),kind:str=Form(),user:User=Depends(client_user),s:Session=Depends(db)):
        a=c.owned(s,id,user)
        if kind not in c.dict['info_request_kinds']:
            raise ApiError('VALIDATION_ERROR')
        if a.status not in {'draft','info_requested'}:
            raise ApiError('INVALID_TRANSITION')
        path,filename=await save_file(file)
        try:
            doc=Document(id=uid(),application_id=a.id,kind=kind,filename=filename,stored_path=str(path))
            s.add(doc)
            if kind=='authority_document':
                member=s.get(CompanyMember,(user.id,a.company_id))
                member.authority_confirmed=True
                member.authority_path=str(path)
            c.commit(s)
        except Exception:
            path.unlink(missing_ok=True)
            raise
        return dict(id=doc.id,kind=doc.kind,filename=doc.filename,uploaded_at=doc.uploaded_at)

    @app.get('/api/feed')
    def feed(user:User=Depends(client_user),s:Session=Depends(db)):
        return [{k:getattr(f,k) for k in ('id','kind','title','text','application_id','created_at','read')} for f in s.scalars(select(FeedItem).where(FeedItem.user_id==user.id).order_by(FeedItem.created_at.desc(),FeedItem.id.desc()).limit(50))]

    @app.post('/api/feed/read',status_code=204)
    def read_feed(body:dict,user:User=Depends(client_user),s:Session=Depends(db)):
        if set(body)!={'ids'} or not isinstance(body['ids'],list) or len(body['ids'])>50 or any(not isinstance(x,str) for x in body['ids']):
            raise ApiError('VALIDATION_ERROR')
        s.execute(update(FeedItem).where(FeedItem.user_id==user.id,FeedItem.id.in_(body['ids'])).values(read=True))
        c.commit(s)
        return Response(status_code=204)
