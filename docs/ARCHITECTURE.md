# Архитектура XRONIX

> Черновик к сдаче (раунд 2). Логика продукта подробно — в [CONVEYOR.md](CONVEYOR.md), точные форматы — в [`contracts/`](../contracts).

## 1. Компоненты

```mermaid
flowchart LR
    C[Клиент<br/>браузер] -->|http :8080| W
    A[Кредитный аналитик<br/>браузер] -->|http :8080| W

    subgraph compose[docker compose up]
      W["web<br/>nginx + собранный React<br/>/ · /app · /app#/bank"]
      B["backend<br/>FastAPI · Python 3.12<br/>машина состояний, проверки,<br/>скоринг, решение, очередь"]
      DB[("том data<br/>SQLite + загруженные файлы")]
      M["integrations-mock<br/>ЕГРЮЛ/ЕГРИП · ФНС · БКИ<br/>синтетические данные"]
      AI["ai<br/>своя модель с открытыми весами<br/>/ai/consult · /ai/parse-need"]
      W -->|"/api/* · /docs"| B
      B --> DB
      B -->|HTTP| M
      B -.->|"HTTP, таймаут;<br/>нет ответа — запасной путь"| AI
    end
```

| Сервис | Папка | Технологии | Порт в сети compose | Что делает |
|---|---|---|---|---|
| `web` | `frontend/` | React 19, Vite, TypeScript, Tailwind; nginx | 8080 (наружу) | Раздаёт фронт, проксирует `/api`, `/docs`, `/openapi.json` в `backend` |
| `backend` | `backend/` | FastAPI, SQLAlchemy, SQLite, PyJWT | 8000 | Учётки и роли, заявки и машина состояний, проверки, скоринг, решение, рабочее место аналитика, лента, чат подбора бизнеса, расчёт проекта |
| `integrations-mock` | `integrations-mock/` | FastAPI | 8002 | Моки ЕГРЮЛ/ЕГРИП, «Прозрачного бизнеса» ФНС и БКИ по контракту [`integrations.md`](../contracts/integrations.md) |
| `ai` | `ai/` | FastAPI, Qwen3-1.7B + LoRA (в работе) | 8001 | Диалог чата и разбор фразы в мастере. Кредитных решений не принимает и денег не считает |

Принципы:
- **Основной сценарий работает без модели.** Если `ai` не ответил за таймаут, бэкенд ведёт чат по запасному диалогу, а мастер заполняется руками.
- **Внешние системы — отдельным сервисом по HTTP.** Моки заменяются настоящими интеграциями без правок конвейера. Если мок недоступен, проверка получает статус `error`, и заявка уходит аналитику, а не падает.
- **Правила — данными, а не кодом.** Пороги скоринга и решения лежат в [`credit_rules.v1.json`](../contracts/rules/credit_rules.v1.json). Версия правил сохраняется с каждым решением.
- **Один источник правды о форматах.** Схемы JSON в `contracts/schemas`; примеры проверяются `npm run check`, ответы бэкенда — тестами по тем же схемам.

## 2. Как заявка проходит конвейер

```mermaid
sequenceDiagram
    autonumber
    actor К as Клиент
    participant W as web
    participant B as backend
    participant M as integrations-mock
    actor А as Аналитик

    К->>W: ИНН компании
    W->>B: GET /api/registry/{inn}
    B->>M: GET /egrul/{inn}
    M-->>B: карточка компании
    К->>B: POST /api/companies, /api/products/match
    К->>B: POST /api/applications (черновик), PATCH …
    К->>B: POST /api/applications/{id}/submit
    Note over B: submitted → checking (фоновая очередь)
    B->>B: полнота и корректность
    B->>M: GET /egrul, GET /fns, POST /bki/report
    Note over B: стоп-фактор → declined<br/>не хватает данных → info_requested
    Note over B: checking → scoring: балл, класс A–D, нагрузка
    alt автоматическое решение
      Note over B: approved · counter_offer · declined
    else серая зона
      Note over B: manual_review
      А->>B: GET /api/bank/applications, /{id}
      А->>B: POST /api/bank/applications/{id}/decision
    end
    loop пока идут автоматические этапы
      W->>B: GET /api/applications/{id} (раз в 2–3 с)
    end
    К->>B: accept → sign
    Note over B: signing → funded (симуляция выдачи)
    B-->>К: лента: смена статуса, решение, запрос данных
```

## 3. Состояния заявки

```mermaid
stateDiagram-v2
    [*] --> draft
    draft --> submitted: клиент подаёт
    draft --> withdrawn: клиент удаляет
    submitted --> checking: система
    checking --> info_requested: не хватает данных
    checking --> declined: стоп-фактор
    checking --> scoring: проверки пройдены
    info_requested --> checking: клиент ответил
    info_requested --> withdrawn: клиент отозвал
    scoring --> approved: автоодобрение
    scoring --> counter_offer: другие условия
    scoring --> manual_review: серая зона
    scoring --> declined: низкий балл
    manual_review --> approved: аналитик
    manual_review --> counter_offer: аналитик
    manual_review --> info_requested: аналитик
    manual_review --> declined: аналитик
    approved --> signing: клиент принял
    counter_offer --> signing: клиент принял
    approved --> cancelled: клиент отказался
    counter_offer --> cancelled: клиент отказался
    signing --> funded: подписано, выдано
    funded --> [*]
    declined --> [*]
    withdrawn --> [*]
    cancelled --> [*]
```

Переходы делает только машина состояний на бэкенде. Недопустимый переход — `409 INVALID_TRANSITION`, устаревшая `version` — `409 VERSION_CONFLICT`. Каждый переход пишется в журнал `application_events`: откуда, куда, кто, причина, время. Тексты статусов для клиента — в [`dictionaries.json`](../contracts/dictionaries.json).

## 4. Модель данных

```mermaid
erDiagram
    users ||--o{ company_members : "состоит"
    companies ||--o{ company_members : "имеет"
    companies ||--o{ applications : "подаёт"
    users ||--o{ applications : "заявитель"
    plans |o--o{ applications : "расчёт проекта"
    applications ||--o{ application_events : "журнал"
    applications ||--o{ check_results : "проверки"
    applications ||--o| scoring_results : "скоринг"
    applications ||--o{ offers : "условия"
    applications ||--o{ documents : "файлы"
    users ||--o{ feed_items : "лента"

    users { string id string email string role "client|analyst" }
    companies { string id string inn string ogrn string name string kind "ul|ip|person" date registered_at string okved }
    company_members { string user_id string company_id string member_role bool authority_confirmed }
    applications { string id string number string status int version string product_id int amount_rub int term_months string purpose json financials json collateral string plan_id }
    application_events { string id string from_status string to_status string actor "client|system|analyst" string reason datetime at }
    check_results { string id string kind "completeness|egrul|fns|bki" string result "ok|warn|fail|error" json data string source }
    scoring_results { int score string grade json factors string rules_version }
    offers { string id string kind "approve|counter" int amount_rub int term_months float rate_percent int monthly_payment_rub json schedule string status }
    documents { string id string kind string filename string stored_path }
    feed_items { string id string kind string text string application_id bool read }
```

Кроме этого: `plans` (расчёт проекта), чаты и генерации ответов, сессии, токены восстановления пароля. Миграции версионные, применяются при старте бэкенда.

## 5. Безопасность и надёжность

- Сессия — HttpOnly cookie `SameSite=Strict`, на https — `Secure`. Запись по cookie принимается только с `Origin` из `CORS_ORIGINS`.
- Пароли — PBKDF2-SHA256, 600 000 итераций. Токен восстановления одноразовый, 15 минут. Ограничение частоты запросов на вход и к ИИ.
- Роли: все `/api/bank/*` только для `analyst`, остальным — `404` («чужое не существует»). Аналитик не меняет данные клиента, только принимает решение; всё попадает в журнал.
- Загрузки — до 5 МБ, проверяются на сервере, хранятся в томе `data` рядом с базой, не в каталоге сайта.
- Конкурентные решения защищены `version` заявки.
- Сбой мока или модели не останавливает конвейер: проверка с `error` уходит аналитику, чат — на запасной диалог.
- nginx: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`; во фронте — CSP.

Для продакшена: SQLite заменяется на PostgreSQL без изменения API (модели на SQLAlchemy), фоновая очередь — на брокер, моки — на настоящие интеграции за тем же HTTP-контрактом. Прод-конфигурация с Caddy и резервными копиями — в `backend/deploy/`.
