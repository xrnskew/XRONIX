"""Stateful business chat. An optional stateless rules service; all money is calculated here."""
import asyncio
import copy
import json
import re
import time

import httpx
from jsonschema import ValidationError
from sqlalchemy import select, update, func
from sqlalchemy.exc import SQLAlchemyError

from .db import Chat, Message, Plan, Generation, now, uid
from .errors import ApiError
from .chat_context import bound_answers
from .limits import consume
from . import project_calc


SPHERES=[('coffee',r'кофе'),('bakery',r'пекар|хлеб'),('car_wash',r'мойк'),('clothing_store',r'одежд|бутик'),('beauty_salon',r'салон красот|парикмах|барбер'),('pickup_point',r'пункт выдачи|\bпвз\b')]


def render_history(messages):
    out=[]
    for m in messages[-20:]:
        r=m.reply
        text=r.get('text','')
        for q in r.get('questions',[]):
            text+='\n'+q['text']
            if q.get('options'):text+='\n'+' / '.join(q['options'])
        if m.role=='user' and m.answers:
            text+='\n'+'\n'.join(a['question_id']+': '+a['answer'] for a in m.answers)
        out.append(dict(role=m.role,content=text[:4000]))
    return out


def amount(text):
    low=text.lower().replace('ё','е')
    if re.search(r'полтора\s+(ляма|миллиона)',low):return 1500000
    if re.search(r'полмиллиона|пол[- ]ляма',low):return 500000
    m=re.search(r'(\d[\d ]*(?:[.,]\d+)?)\s*(млн|миллион\w*|лям\w*|тыс\w*|к\b|руб\w*|₽)?',low)
    if not m:return None
    try:
        n=float(m[1].replace(' ','').replace(',','.'))
        unit=m[2] or ''
        n*=1000000 if unit.startswith(('млн','миллион','лям')) else 1000 if unit.startswith(('тыс','к')) else 1
        return int(n) if n.is_integer() and 0<=n<=10**12 else None
    except (ValueError,OverflowError):return None


class Consult:
    def __init__(self,app,settings,contracts,sessions):
        self.app,self.settings,self.contracts,self.sessions=app,settings,contracts,sessions
        self.c=app.state.conveyor

    async def call(self,endpoint,payload):
        schema='consult' if endpoint=='consult' else 'parse-need'
        self.contracts.validate(schema,payload,'request')
        async with asyncio.timeout(10):
            async with self.app.state.ai.client.stream('POST',self.settings.ai_service_url+'/ai/'+endpoint,json=payload,timeout=10) as response:
                response.raise_for_status()
                data=bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data)>65536:raise ValueError('Oversized response')
                result=json.loads(data,parse_constant=lambda x:(_ for _ in ()).throw(ValueError('Nonfinite number')))
        self.contracts.validate(schema,result,'response')
        return result

    def validate_state(self,result,before):
        state=result['state'];sphere=state['sphere']
        if sphere is not None and sphere not in self.c.templates['spheres']:raise ValueError('Unsupported sphere')
        if result['type']=='message' and state!=before:raise ValueError('Message changed state')
        if result['type']=='ready' and (not sphere or not state['city'] or state['own_funds_rub'] is None):raise ValueError('Incomplete ready')
        if state['answers']:
            if not sphere:raise ValueError('Answers without sphere')
            qs={q['id']:q for q in self.c.templates['spheres'][sphere]['questions']}
            for key,value in state['answers'].items():
                if key not in qs:raise ValueError('Unknown answer')
                q=qs[key]
                if q['kind']=='choice':
                    if value not in [o['value'] for o in q['options']]:raise ValueError('Invalid choice')
                elif type(value) not in (int,float) or not q['min']<=value<=q['max']:raise ValueError('Invalid number')
        if result['type']!='ready':
            # Both service and client envelopes must be valid; incompatible output uses the fallback.
            self.contracts.validate('reply',{k:v for k,v in result.items() if k!='state'})

    def fallback(self,text,state,previous,answers):
        st=copy.deepcopy(state)
        low=text.lower()
        if re.search(r'игнорируй|забудь.*инструкц|system:|погода|анекдот|футбол',low):
            return dict(type='message',text='Я помогаю подобрать бизнес. Давайте вернёмся к вашей идее.',state=st)
        sphere=next((s for s,rx in SPHERES if re.search(rx,low)),None)
        if sphere:
            if sphere!=st['sphere']:st['answers']={}
            st['sphere']=sphere
        normalized=lambda s:s.strip().lower().replace('ё','е')
        names=project_calc.CITIES
        found=next((n for n in sorted(names,key=len,reverse=True) if re.search(r'(?<![а-я])'+re.escape(n)+r'(?![а-я])',normalized(text))),None)
        if found:
            # Catalog preserves the original name for public state.
            city_rows=json.loads((project_calc.DATA/'cities.json').read_text())
            st['city']=next(n for n,_,_ in city_rows if normalized(n)==found)
        asked={q['id'] for q in (previous.reply.get('questions',[]) if previous else [])}
        for a in answers:
            if a['question_id']=='city' and a['answer'].strip():st['city']=a['answer'].strip()[:60]
        if 'city' in asked and not found and not answers and text.strip():st['city']=text.strip()[:60]
        funds_text=next((a['answer'] for a in answers if a['question_id']=='own_funds'),text)
        money=amount(funds_text)
        if 'own_funds' in asked or re.search(r'есть|своих|свои|накоп|отлож|вложить|бюджет',low):
            if money is not None:st['own_funds_rub']=money
            elif re.search(r'своих нет|ноль|без своих|^нет\b|^0$',funds_text,re.I):st['own_funds_rub']=0
        if not st['sphere']:
            q=dict(id='sphere',text='Что открываем? '+', '.join(d['title'] for d in self.c.templates['spheres'].values())+'.',kind='text')
        elif not st['city']:q=dict(id='city',text='В каком городе открываетесь?',kind='text')
        elif st['own_funds_rub'] is None:q=dict(id='own_funds',text='Сколько своих денег готовы вложить в запуск? Если нет — напишите «нет».',kind='text')
        else:return dict(type='ready',text='Считаю план по шаблону.',state=st)
        return dict(type='questions',text='Уточните, пожалуйста:',questions=[q],state=st)

    async def process(self,chat_id,body,background,user,s,generation_id=None):
        chat=s.scalar(select(Chat).where(Chat.id==chat_id,Chat.user_id==user.id))
        if chat is None:raise ApiError('NOT_FOUND')
        stamp=time.time();lease=stamp+30
        got=s.execute(update(Chat).where(Chat.id==chat_id,Chat.busy_until<stamp).values(busy_until=lease)).rowcount
        if not got:raise ApiError('RATE_LIMITED')
        try:
            if generation_id is None and s.scalar(select(Generation.id).where(Generation.user_id==user.id,Generation.status.in_(('queued','running'))).limit(1)):raise ApiError('RATE_LIMITED')
            active=Chat.busy_until>stamp
            if s.scalar(select(func.count()).select_from(Chat).where(active,Chat.user_id==user.id))>1 or s.scalar(select(func.count()).select_from(Chat).where(active))>self.settings.ai_max_concurrent:raise ApiError('RATE_LIMITED')
            consume(s,'ai-user',user.id,self.settings.ai_requests_per_minute)
            consume(s,'ai-global','all',self.settings.ai_global_per_minute)
            s.commit()
        except Exception:s.rollback();raise
        try:
            s.refresh(chat)
            messages=list(reversed(s.scalars(select(Message).where(Message.chat_id==chat_id).order_by(Message.seq.desc()).limit(20)).all()))
            previous=next((m for m in reversed(messages) if m.role=='assistant'),None)
            answers=bound_answers(body,previous)
            state=chat.consult_state or dict(sphere=None,city=user.city,own_funds_rub=None,answers={})
            current=body.text+('' if not answers else '\n'+'\n'.join(a['question']+' '+a['answer'] for a in answers))
            # Bound history/current text to the existing service request schema.
            payload=dict(history=render_history(messages),message=current[:4000],state=state)
            if not messages:chat.title=body.text[:60]
            reused=messages and messages[-1].role=='user' and messages[-1].reply.get('text')==body.text and (messages[-1].answers or [])==[a.model_dump() for a in body.answers]
            if not reused:s.add(Message(chat_id=chat_id,role='user',reply=dict(type='message',text=body.text),answers=[a.model_dump() for a in body.answers]))
            chat.updated_at=now();s.commit()
            try:
                result=await self.call('consult',payload)
                self.validate_state(result,state)
            except (httpx.HTTPError,TimeoutError,ValueError,ValidationError,KeyError,TypeError):
                result=self.fallback(current,state,previous,answers)
            chat.consult_state=copy.deepcopy(result['state'])
            if result['type']=='ready':
                st=result['state']
                plan=project_calc.calculate(dict(sphere=st['sphere'],city=st['city'],own_funds_rub=st['own_funds_rub'],answers=st['answers']),self.c.templates,self.c.products)
                self.contracts.validate('plan',plan)
                plan_id=uid();s.add(Plan(id=plan_id,user_id=user.id,chat_id=chat_id,body=plan))
                chat.plan_id=plan_id;chat.title=plan['title'][:60]
                reply=dict(type='plan',text='План готов. Цифры рассчитаны бэкендом по шаблону; параметры можно изменить в расчёте проекта.',plan_id=plan_id,plan=plan)
            else:reply={k:v for k,v in result.items() if k!='state'}
            self.contracts.validate('reply',reply)
            s.add(Message(chat_id=chat_id,role='assistant',reply=reply));chat.updated_at=now()
            if generation_id:s.execute(update(Generation).where(Generation.id==generation_id,Generation.status=='running').values(status='succeeded',reply=reply,updated_at=now(),lease_until=0))
            s.commit();return reply
        finally:
            s.rollback()
            try:
                s.execute(update(Chat).where(Chat.id==chat_id,Chat.busy_until==lease).values(busy_until=0));s.commit()
            except SQLAlchemyError:s.rollback()
