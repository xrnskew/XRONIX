"""Opt-in/out demo fixture. Every seeded outcome is produced by the real conveyor."""
import copy
import logging
from datetime import datetime,timedelta
from uuid import UUID,uuid5

from sqlalchemy import select,update
from .db import User,Chat,Plan,now
from .conveyor import CATALOG,load
from .conveyor_models import Application,ApplicationEvent,Company,CompanyMember,FeedItem,Offer
from .security import hash_password
from .storage import file_lock,database_path,StorageError
from . import project_calc

logger=logging.getLogger(__name__)
NS=UUID('35c879b8-a217-41eb-9d79-6f17e4fe728c')
def ident(name):return str(uuid5(NS,'xronix-demo-v2:'+name))


async def seed(app):
    c=app.state.conveyor
    path=database_path(c.settings).with_suffix('.seed.lock')
    try:
        with file_lock(path,exclusive=True):
            await _seed(app)
    except StorageError as exc:
        if exc.code!='DATABASE_OR_BACKUP_IN_USE':raise
        logger.info('Demo initialization is running in another process')


async def _seed(app):
    c=app.state.conveyor;sessions=c.sessions
    with sessions() as s:
        for email,name,role in [('client@xronix.demo','Александр','client'),('analyst@xronix.demo','Ольга Смирнова','analyst')]:
            user=s.scalar(select(User).where(User.email==email))
            if user is None:
                user=User(id=ident(email),email=email,name=name,role=role,password_hash=hash_password('demo12345'),city='Самара')
                s.add(user);s.flush()
            elif user.role!=role:
                logger.warning('Demo seed skipped: reserved email already has a different role')
                return
        client=s.scalar(select(User).where(User.email=='client@xronix.demo'))
        owner=client.id
        s.commit()
    scenarios=load(CATALOG,'demo_companies.json');bodies=load(CATALOG,'demo_applications.json')
    specs=[('north','7715881399','director',26*60),('romashka','7755761690','director',5*60),('lebedev','777309114120','owner',3*60),('authority','7772731777','accountant',2*60),('vector','7768151886','director',47),('lebedev-c','777309114120','owner',22),('founder','772519083310','owner',9)]
    for name,inn,role,minutes in specs:
        id=ident('application:'+name)
        with sessions() as s:
            a=s.scalar(select(Application).where(Application.id==id))
            if a and a.data.get('seed_complete'):continue
            if not a:
                co=s.scalar(select(Company).where(Company.inn==inn))
                if not co:
                    registry=scenarios[inn]['registry'] if name!='founder' else dict(inn=inn,ogrn=None,name='Мария Новикова (будущий ИП)',kind='person',status='not_registered',registered_at=None,okved=None,address='',head_name='Мария Новикова',source='xronix')
                    co=Company(id=ident('company:'+inn),inn=inn,registry=registry);s.add(co);s.flush()
                if not s.get(CompanyMember,(owner,co.id)):
                    s.add(CompanyMember(user_id=owner,company_id=co.id,member_role=role,authority_confirmed=role in ('owner','director')))
                d=copy.deepcopy(bodies[inn]) if name!='founder' else dict(product_id='start',purpose='new_location',amount_rub=1000000,term_months=36,financials=dict(revenue_12m_rub=None,expenses_12m_rub=None,loan_payments_monthly_rub=0),collateral=dict(kind='guarantor',description='Поручитель — супруга, официальный доход',value_rub=1500000))
                d.update(plan_id=None,consent_bki=True)
                if name=='lebedev-c':d['financials']=dict(revenue_12m_rub=9600000,expenses_12m_rub=7800000,loan_payments_monthly_rub=85000)
                if name=='founder':
                    plan=project_calc.calculate(dict(sphere='bakery',city='Самара',own_funds_rub=900000,answers={}),c.templates,c.products)
                    chat=Chat(id=ident('founder-chat'),user_id=owner,title=plan['title'],plan_id=ident('founder-plan'))
                    if not s.get(Chat,chat.id):s.add(chat);s.flush()
                    if not s.get(Plan,chat.plan_id):s.add(Plan(id=chat.plan_id,user_id=owner,chat_id=chat.id,body=plan))
                    d.update(plan_id=chat.plan_id,amount_rub=min(3000000,plan['credit']['amount_rub'] or 2000000))
                a=Application(id=id,user_id=owner,company_id=co.id,data=d);s.add(a);s.flush()
                s.add(ApplicationEvent(application_id=id,from_status=None,to_status='draft',actor='client',actor_id=owner))
                c.move(s,a,'submitted','client',owner);c.commit(s)
        for _ in range(3):
            if not await c.step(app.state.integrations,application_id=id):break
        with sessions() as s:
            a=s.scalar(select(Application).where(Application.id==id))
            if name=='north' and a.status=='approved':
                offer=s.scalar(select(Offer).where(Offer.application_id==id));offer.data={**offer.data,'status':'accepted'}
                c.move(s,a,'signing','client',owner);c.commit(s)
                c.move(s,a,'funded','client',owner);c.commit(s)
            # Only newly seeded records are dated; future restarts preserve the user's changes.
            offset=timedelta(minutes=minutes)
            shift=lambda value:(datetime.fromisoformat(value.replace('Z','+00:00'))-offset).isoformat().replace('+00:00','Z')
            a.created_at=shift(a.created_at);a.updated_at=shift(a.updated_at)
            for e in s.scalars(select(ApplicationEvent).where(ApplicationEvent.application_id==id)):e.at=shift(e.at)
            for f in s.scalars(select(FeedItem).where(FeedItem.application_id==id)):f.created_at=shift(f.created_at)
            a.data={**a.data,'seed_complete':True};c.commit(s)
