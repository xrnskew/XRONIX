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
