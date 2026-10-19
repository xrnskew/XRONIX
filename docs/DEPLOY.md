# Деплой фронта: GitHub Pages + домен с reg.ru + DNS в Яндекс Облаке

Фронт собирается GitHub Actions (`.github/workflows/deploy-frontend.yml`) и публикуется на GitHub Pages. Бэкенд и ИИ-сервис живут отдельно в Яндекс Облаке.
Схема адресов (подставь свой домен вместо `example.ru`):

| Адрес | Что | Где |
|---|---|---|
| `https://app.example.ru` | Сайт-презентация с кабинетом | GitHub Pages |
| `https://api.example.ru` | Бэкенд Ильи | ВМ или балансировщик в Яндекс Облаке |

Репозиторий публичный: в нём не должно быть паролей и токенов. Всё секретное только в `.env` на сервере.

## 1. Где сейчас DNS домена
Открой личный кабинет reg.ru → Домены → твой домен → «DNS-серверы и управление зоной».
Или в терминале: `nslookup -type=NS example.ru`.

- `ns1.reg.ru`, `ns2.reg.ru`: записи правятся в reg.ru. Делегировать в Яндекс не обязательно, можно сразу идти к шагу 3 и добавить записи там.
- `ns1.yandexcloud.net`, `ns2.yandexcloud.net`: зона уже в Cloud DNS, записи правятся в консоли Яндекс Облака.

Хочешь управлять зоной из Яндекс Облака: сначала создай там публичную зону (Cloud DNS → Создать зону → `example.ru.`), перенеси нужные записи, и только потом в reg.ru поменяй NS на `ns1.yandexcloud.net` и `ns2.yandexcloud.net`. Если сменить NS раньше, чем зона заполнена, сайт и почта домена перестанут открываться. Обновление NS занимает от часа до суток.

## 2. Включить GitHub Pages (нужен доступ владельца репозитория)
1. `Settings → Pages → Build and deployment → Source: GitHub Actions`.
2. `Settings → Environments → github-pages → Deployment branches`: добавь `main`, `dev` и `frontend` (по умолчанию разрешён только `main`, и деплой из других веток упадёт).
3. `Actions → Deploy frontend to GitHub Pages → Run workflow`, выбери ветку. Через пару минут сайт будет на `https://xrnskew.github.io/XRONIX/`.

Деплоится последний запуск, ветки не публикуются параллельно. Для финальной сдачи публикуй из `main`.

## 3. Привязать домен
Рекомендую поддомен (`app` или `www`), так проще и надёжнее.

В DNS-зоне (reg.ru или Cloud DNS) добавь:

| Имя | Тип | Значение |
|---|---|---|
| `app` | `CNAME` | `xrnskew.github.io.` (в Cloud DNS с точкой на конце) |

Если нужен сам `example.ru` без поддомена, вместо CNAME четыре записи `A` на корень:
`185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
и по желанию `AAAA`: `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`.

Дальше: `Settings → Pages → Custom domain` → `app.example.ru` → Save. GitHub проверит DNS. Когда проверка пройдена, включи `Enforce HTTPS` (сертификат Let's Encrypt выпускается автоматически, от минут до нескольких часов).
Проверка: `nslookup app.example.ru` должен вернуть адреса GitHub (185.199.x.x).
Желательно ещё подтвердить домен в аккаунте GitHub (`Settings → Pages → Add a domain`, добавляется TXT-запись), чтобы им не завладел чужой репозиторий.

## 4. Бэкенд на поддомене api
1. В Яндекс Облаке получи публичный IP ВМ (или адрес балансировщика), в DNS-зоне добавь `api` `A` → этот IP.
2. **HTTPS обязателен**: сайт на HTTPS не может ходить на `http://` API, браузер заблокирует запросы. Варианты: Certificate Manager + Application Load Balancer либо Caddy или nginx с Let's Encrypt на самой ВМ.
3. **CORS на бэкенде** (скажи Илье): разрешить `Origin: https://app.example.ru` (и `http://localhost:5173` для разработки), заголовок `Authorization`, методы `GET, POST, PATCH, OPTIONS`. Без этого кабинет на Pages не сможет обращаться к `api.example.ru`.
4. В репозитории: `Settings → Secrets and variables → Actions → Variables`:
   - `VITE_API_URL` = `https://api.example.ru`
   - `VITE_USE_MOCKS` = `false`
   Переменные `VITE_*` попадают в публичный JS, секретов в них быть не должно. Пока бэкенда нет, не задавай их: сайт соберётся на моках и будет полностью рабочим.
5. Перезапусти workflow, чтобы сборка подхватила переменные.

## Чек-лист
- [ ] Узнал, где DNS (шаг 1)
- [ ] Pages: Source = GitHub Actions, ветки добавлены в окружение
- [ ] Первый деплой прошёл, открывается `xrnskew.github.io/XRONIX/`
- [ ] CNAME `app` → `xrnskew.github.io.`
- [ ] Custom domain сохранён, `Enforce HTTPS` включён
- [ ] `api` → IP бэкенда, HTTPS и CORS настроены
- [ ] Переменные `VITE_API_URL` и `VITE_USE_MOCKS=false` заданы, сборка перезапущена
