# Frontend ↔ Backend

Базовый путь `/api`, формат JSON, кодировка UTF-8. После входа каждый запрос, кроме `/api/auth/*`, идёт с заголовком `Authorization: Bearer <token>`.
Схемы: [`schemas/`](schemas), примеры: [`examples/`](examples).

## Ошибки
Любая ошибка: HTTP-статус и тело [`error.schema.json`](schemas/error.schema.json):
```json
{ "error": { "code": "AI_UNAVAILABLE", "message": "Консультант сейчас недоступен. Попробуйте ещё раз через минуту." } }
```
`message` фронт показывает пользователю как есть: по-русски, без технических деталей.

| code | HTTP | Когда |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Тело запроса не прошло проверку |
| `VALIDATION_ERROR` | 413 | Тело запроса больше допустимого: JSON — 64 КБ, загрузка файла — 5 МБ |
| `UNAUTHORIZED` | 401 | Нет токена или он просрочен: фронт возвращает на экран входа |
| `INVALID_CREDENTIALS` | 401 | Неверная почта или пароль |
| `EMAIL_TAKEN` | 409 | Почта уже зарегистрирована |
| `NOT_FOUND` | 404 | Нет такого чата или плана (или он чужой) |
| `RATE_LIMITED` | 429 | Слишком часто, фронт ждёт и повторяет |
| `AI_UNAVAILABLE` | 502 | AI-сервис не отвечает |
| `AI_BAD_RESPONSE` | 502 | ИИ дважды вернул битый JSON (после ретраев бэкенда) |
| `INTERNAL` | 500 | Всё остальное |

Чужие данные всегда `NOT_FOUND`, а не 403: не подсказываем, что они существуют.

## Авторизация

### `POST /api/auth/register`
Запрос: `{ "email": string, "password": string (≥ 8), "name": string }`
Ответ 201: `{ "token": string, "user": User }`

### `POST /api/auth/login`
Запрос: `{ "email": string, "password": string }`
Ответ 200: `{ "token": string, "user": User }`

**Cookie-режим (браузер).** Фронт шлёт заголовок `X-Session-Mode: cookie` и `credentials: include`. Сессию бэкенд ставит HttpOnly-cookie (`SameSite=Strict`, на https — `Secure`), а в ответе register и login **токена нет**: `{ "user": User }`. Скрипт страницы токен не видит. Запись по cookie принимается только с `Origin` из `CORS_ORIGINS`. Режим с `Authorization: Bearer` остаётся для клиентов без браузера (коллекция запросов, тесты).

`User`: [`profile.schema.json`](schemas/profile.schema.json), пример [`user.json`](examples/user.json).

## Профиль

### `GET /api/me` → `User`
### `PATCH /api/me` → `User`
Тело: любое подмножество полей `name`, `city`, `experience`, `budget_rub`, `tags`. Отсутствующее поле не меняется. `tags` заменяется целиком. `email` и `id` менять нельзя.
Теги из этого профиля попадают в каждый запрос к ИИ.

## Чаты

### `GET /api/chats` → `[{ "id": string, "title": string, "updated_at": ISO, "plan_id": string | null }]`
Новые сверху. `title` бэкенд берёт из первого сообщения (до 60 символов) или из заголовка плана.

### `POST /api/chats` → `{ "chat_id": string }`   (201)
Тела нет.

### `GET /api/chats/{id}`
```json
{ "id": "…", "messages": [ { "id": "…", "role": "user|assistant", "created_at": "ISO", "reply": <Reply> } ] }
```
Для сообщения пользователя `reply` это `{ "type": "message", "text": "…" }`. Для ответа ИИ любой из трёх типов ниже.

### `DELETE /api/chats/{id}`   (204, без тела)
Удаляет диалог вместе с его сообщениями и планами (`plans` с этим `chat_id`). Память и теги профиля не трогает.
Чужой или несуществующий диалог: `NOT_FOUND`. Пока ИИ отвечает в этом диалоге: `RATE_LIMITED`, фронт показывает сообщение и даёт повторить.
После удаления `GET /api/plans` больше не возвращает планы этого диалога, поэтому вкладка «План» показывает предыдущий план или пустое состояние.
CORS: в разрешённые методы нужно добавить `DELETE`.

### `POST /api/chats/{id}/messages`
Запрос:
```json
{ "text": "Хочу открыть кофейню у метро",
  "answers": [ { "question_id": "budget", "answer": "500 тыс – 2 млн" } ] }
```
`text` обязателен (1–4000 символов). `answers` необязателен: фронт заполняет его, когда пользователь отвечает на вопросы ИИ, а в `text` кладёт те же ответы связным текстом. Бэкенд передаёт ИИ только `text`.
Ответ 200: [`Reply`](schemas/reply.schema.json) одного из трёх типов:

| `type` | Что делает фронт | Пример |
|---|---|---|
| `message` | Показывает текст в чате | [reply.message.json](examples/reply.message.json) |
| `questions` | Рисует вопросы: `choice` кнопками (2–5 вариантов), `text` полем ввода | [reply.questions.json](examples/reply.questions.json) |
| `plan` | Сохраняет `plan` для вкладок «План» и «Финансы», показывает карточку «Открыть план» | [reply.plan.front.json](examples/reply.plan.front.json) |

Запрос может идти до 30 секунд (ИИ думает): фронт показывает индикатор «печатает» и не даёт отправить второе сообщение, пока нет ответа.
Бэкенд сохраняет и сообщение пользователя, и ответ ИИ в историю чата.

## Планы

### `GET /api/plans` → `[{ "plan_id": string, "chat_id": string, "title": string, "created_at": ISO }]`
Новые сверху. Фронт берёт первый элемент, чтобы вкладка «План» работала после перезагрузки страницы.

### `GET /api/plans/{id}` → `{ "plan_id": string, "chat_id": string, "created_at": ISO, "plan": Plan }`
`Plan`: [`plan.schema.json`](schemas/plan.schema.json), примеры [plan.coffee.json](examples/plan.coffee.json) и [plan.no-credit.json](examples/plan.no-credit.json).

## Что должен учесть фронт
- Деньги приходят целыми рублями, форматирует фронт.
- `credit.needed = false`: поля кредита `null`, вкладка «Финансы» показывает только `comment`, калькулятор скрыт.
- `credit.verdict` и `debt_load_percent` приходят уже пересчитанными бэкендом, фронт им доверяет. Калькулятор на экране только оценка «что если», итог всегда за сервером.
- `credit.recommended_product_id` необязателен. Если есть, фронт подсвечивает этот продукт в списке банка.
- Неизвестные поля в ответах игнорируются, обязательные поля фронт не проверяет повторно.

## Дополнение: контекст чата и сохраняемая генерация

GET /api/chats/{id} дополнительно возвращает `facts` и `generation` (null или последняя задача).
Элементы `messages` включают `answers: [{question_id, answer}]` для восстановления анкеты.
Факты: `{ключ: {value: string|integer, source: profile|user_message|answer, message_id: string|null, question_id?: string}}`.
Профиль копируется при создании чата; ответы меняют только факты этого чата.
`answers` в отправке сообщения должны соответствовать последней анкете: IDs уникальны,
для choice значение совпадает с options. Невалидные ответы дают VALIDATION_ERROR.

POST /api/chats/{id}/generations → 202, тело `{text, answers?: [], request_id}`.
Ключ request_id: 16–80 символов `[a-zA-Z0-9_-]`, уникален в рамках пользователя.
Повтор идентичного запроса возвращает ту же задачу; подмена тела/чата с тем же ключом даёт VALIDATION_ERROR.
GET /api/generations/{id} возвращает `{id,chat_id,request_id,status,reply,error_code,created_at,updated_at,request}`.
`request` содержит исходные text и answers; `reply` и error_code могут быть null.
Статусы: queued/running/succeeded/failed. Чужая задача — NOT_FOUND.
Незавершённая задача блокирует удаление чата и вторую генерацию пользователя.

## Дополнение: пароль и сеансы

- POST /api/auth/logout-all → 204; требует входа, отзывает все сеансы, включая текущий.
- POST /api/auth/change-password `{current_password,new_password}` → 204; требует входа и текущего пароля, отзывает сеансы. Новый пароль: 8–1024 символа.
- POST /api/auth/forgot-password `{email}` → 202 `{message}` одинакового вида для существующего и отсутствующего аккаунта. Без SMTP — 503 RECOVERY_UNAVAILABLE.
- POST /api/auth/reset-password `{token,new_password}` → 204; одноразовый токен 43 символа, срок 15 минут. Неверный/просроченный — 400 RESET_TOKEN_INVALID. После сброса нужен обычный вход.

Подтверждение email при регистрации не требуется. Новые коды ошибок добавлены в error.schema.json.
Теги профиля меняются только через явный PATCH /api/me; результаты планов/сводок их не меняют.
