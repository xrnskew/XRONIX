## Раунд 2 · бэкенд · 20 октября 2026

**Ветка и коммит:** `backend` @ `5260020` — Add round-two analyst API, demo seed, and rules chat integration.
**Синхронизация с dev:** `git merge origin/dev` выполнен, `dev` @ `7c64209`, конфликтов нет.
**Часть Дани:** `backend-ai` @ `e3e2688` (включая `3e0852e` и `b51c5f3`) проверена и объединена в `backend` коммитом `71681ed`.

**Итог:** API аналитика, засев, чат с собственным сервисом правил и запасным диалогом,
разбор потребности готовы и проверены тестами, HTTP и браузером без моков фронта.
Контейнерная сборка и запуск на чистой машине **пока не проверены**: на этой машине нет Docker.
Поэтому весь раунд не объявляется полностью закрытым до проверки пунктов 12–13.

### Правки после приёмки раунда 1

| № замечания | Что изменено | Статус | Где | Проверка и результат |
|---|---|---|---|---|
| 1 | Убрана двойная точка после «5 мес.» в причине подбора | готово | `backend/app/credit_rules.py` | `age_text(months).rstrip('.')` перед финальной точкой; конвейерные тесты зелёные |
| 2 | Проверка гонки одноразового сброса принимает разрешённую SQLite-реакцию: один 204, второй 400 либо 429 | готово | `backend/tests/test_features.py` | `test_recovery_is_generic_hashed_expiring_and_single_use`: **10 прогонов подряд, 10 PASS**; пароль меняется только одним запросом |
| 3 | Объяснены CORS_ORIGINS и cookie; запрещённый origin получает понятный текст ошибки | готово | `backend/README.md`, `backend/app/middleware.py` | В браузере обе демо-роли вошли через HttpOnly cookie с разрешённым origin; общий набор проверяет CORS/чужие origin |
| 4 | Аналитик может читать план нечерновой заявки, остальные чужие/непривязанные планы скрыты | готово | `backend/app/main.py` | `test_version_roles_draft_and_plan_access`, реальный HTTP-сценарий `analyst_linked_plan_access` |

**Закрытие ревью Дани по раунду 1:** полная история с вопросами/вариантами,
проверка денежных сумм цифрами и словами во всех видимых полях, устойчивость оценщика
к `null`, числу и прочим невалидным результатам исправлены в `e3e2688`.
Независимо повторены 66 тестов, валидация, байтовое совпадение генерации и четыре оценки правил.
Прежний `b51c5f3` отдельно не принимался; принят исправленный результат.

### Задачи

Нумерация — `docs/tasks/ROUND2.md`.

| № | Задача | Статус | Где в коде | Как проверить | Ожидаемый результат |
|---|---|---|---|---|---|
| 1 | Роль analyst, скрытие черновиков и bank API от клиента | готово | `backend/app/bank.py` | `test_version_roles_draft_and_plan_access`, `test_seed_real_pipeline_idempotent_and_bank_cards` | Клиент получает NOT_FOUND; черновиков нет в очереди и карточках аналитика |
| 2 | Очередь, фильтр нескольких статусов, ожидание с перехода, grade | готово | `backend/app/bank.py` | `test_queue_order_uses_last_transition_not_autosave`, `GET /api/bank/applications?status=manual_review,counter_offer` | Дольше ожидающие сверху; автосохранение не обнуляет ожидание; ответ по bank#/queue_item |
| 3 | Карточка: проверки, скоринг, рекомендация, журнал, заявитель | готово | `backend/app/bank.py`, `backend/app/conveyor.py` | `test_seed_real_pipeline_idempotent_and_bank_cards`; открыть «Вектор» в /app#/bank | Четыре проверки, сырые details, rules_version, actor_name; рекомендация для manual_review. До скоринга при info_requested рекомендация может быть null, как в схеме/моке |
| 4 | Четыре решения, проверки условий, версия, условие ИП | готово | `backend/app/bank.py` | `test_all_decisions_visible_to_client`, `test_decision_validation_and_no_partial_mutation` | approve/counter/request_info/decline работают; неверные условия — VALIDATION_ERROR; повтор вне manual_review — INVALID_TRANSITION; устаревшая версия — VERSION_CONFLICT |
| 5 | Сводка по статусам, доля автоматических решений, время | готово | `backend/app/bank.py` | `GET /api/bank/stats`, проверка JSON Schema в тесте сида | Черновики исключены; доля 0–1; среднее от первой подачи до последнего решения, null без решений |
| 6 | Доступ аналитика к связанному плану | готово | `backend/app/main.py` | `test_version_roles_draft_and_plan_access`, `tests/smoke_round2.py` | Связанный с видимой заявкой план — 200; непривязанный чужой — NOT_FOUND |
| 7 | Тесты аналитика и видимость результата клиенту/в ленте | готово | `backend/tests/test_round2.py` | `python -m pytest -q tests/test_round2.py` | 22 passed; HTTP и браузер подтвердили решение и оффер клиенту |
| 8 | Демо-учётки и повторный запуск без дублей | готово | `backend/app/seed.py`, `backend/app/config.py` | `test_seed_real_pipeline_idempotent_and_bank_cards`; перезапуск нативного стенда | client@xronix.demo / demo12345, analyst@xronix.demo / demo12345; два пользователя; решения после перезапуска сохранены |
| 9 | Семь демо-заявок через настоящий конвейер, время в прошлом | готово | `backend/app/seed.py`, `backend/app/catalog/demo_*.json` | Тест сида, очередь в браузере | Северная — funded; Ромашка — declined; Лебедев — counter_offer и manual_review/C; доверенность — info_requested; Вектор — manual_review; будущий ИП со «Стартом» и планом пекарни в Самаре. Журнал содержит настоящие этапы |
| 10 | State чата, профильный город, consult, ready → план, fallback | готово | `backend/app/consult.py`, `backend/app/main.py`, миграция 5 | `test_fallback_chat_restart_state_and_template_plan`, `test_service_questions_history_and_ready`, браузер | Состояние переживает перезапуск; сервис получает вопросы/варианты и ответы; цифры считает бэкенд; без сервиса сфера → город → свои деньги → план |
| 11 | Прокси needs/parse с пустым ответом при сбое | готово | `backend/app/main.py`, `backend/app/consult.py` | `test_parse_fallback_and_consult_bad_response`, `test_parse_service_and_generations`; HTTP smoke | Валидный ответ сервиса передаётся; timeout/503/невалидный ответ → 200 со всеми null и confidence={} |
| 12 | Compose: четыре сервиса, сеть, настройки и том | частично | `docker-compose.yml`, Dockerfile участников | YAML разобран; build context/Dockerfile, порт nginx 8080, volume проверены. Далее `docker compose up --build` | Конфигурация готова; реальная сборка и запуск контейнеров не выполнены из-за отсутствия Docker |
| 13 | Чистая машина, Compose и браузерный путь обоих аккаунтов | частично | `backend/tests/smoke_round2.py`, артефакты ниже | Нативный стенд из трёх отдельных HTTP-сервисов + неизменённый собранный фронт проверен | Оба входа, решения Вектора/Лебедева C, клиентские офферы/лента, чат → план → Старт пройдены. Проверка именно Docker на чистой машине ещё нужна |
| 14 | Лицензии, датасеты, генерация и оценка Дани | готово | `ai/LICENSES.md`, `ai/dataset/`, `ai/tests/` | Команды из ai/dataset/README.md; независимый повтор в временной копии e3e2688 | consult 2827/298, parse_need 2681/296; 0 ошибок валидации, повторная генерация побайтно та же; 66 тестов |
| 15 | Дообучение на RTX 5070 | нет | Решение Ильи в чате «Подготовить задачу для Дани» | Обучение не запускать | Отменено прямым решением пользователя: реализована собственная система правил/шаблонов, без внешних моделей, API и GPU |
| 16 | CPU-сервис consult/parse-need, метрики и задержка | готово | `ai/app/rules/`, `ai/app/main.py`, `ai/Dockerfile` | 66 тестов Дани; отдельный реальный HTTP-процесс; метрики ниже | Оба API работают без GIGACHAT_AUTH_KEY. Время измерено на Mac; контейнерная сборка отдельно не проверена |

### Отступления от контрактов и согласованные изменения плана

- API и JSON Schema односторонне не менялись. Правки схем/примеров из `dev` получены слиянием.
- Вместо Qwen/LoRA и обучения на RTX 5070 используется собственная система правил и шаблонов
  по прямому решению Ильи. Историческая записка о базовой модели не означает, что модель обучена или используется.
- Сервис и чат сохраняют прежние имена `/ai/*` и клиентские типы `questions`, `message`, `plan`.
  Денежные расчёты и кредитное решение остаются в бэкенде.
- Есть несовпадение действующих схем: consult.response.text допускает 600 символов,
  клиентский reply.questions.text — 300. Несовместимый ответ включает запасной путь,
  а не обрезается молча. Согласовать общий предел с Сашей/Даней; текущие ответы сервиса проходят оба формата.
- Для будущего ИП ЕГРЮЛ/ФНС не вызываются. В карточке аналитика соответствующие строки
  явно показывают «не требуется», `details.skipped=true`; это не выдаётся за внешний ответ.
- При гонке сброса пароля тест разрешает существующий RATE_LIMITED/429 при занятой SQLite,
  как допускает замечание 2. Семантика одноразового токена не ослаблена: успешен только один запрос.

### Тесты

| Набор | Команда | Результат |
|---|---|---|
| Бэкенд, полный финальный набор | `cd backend && python -m pytest -q --disable-warnings` | **249 passed, 0 failed за 115,22 с** |
| Раунд 2, после проверки ожидания очереди | `python -m pytest -q tests/test_round2.py --disable-warnings` | 22 passed за 19,07 с |
| Сброс пароля, повторяемость | 10 запусков `python -m pytest -q tests/test_features.py::test_recovery_is_generic_hashed_expiring_and_single_use --disable-warnings` | 10 PASS из 10 |
| Контракты | `cd contracts && npm ci && npm run check` | Зелёный; ci выполнен с локальным кешем (--offline) |
| Сервис Дани | `cd ai && python -m unittest discover -s tests` | Независимый повтор e3e2688: 66 OK за 1,077 с |
| Данные Дани | `python -m dataset.generate`; `python -m dataset.validate` | Генерация exit 0, четыре JSONL побайтно совпадают; consult 2827/298, parse_need 2681/296, 0 ошибок |
| Метрики правил | `python -m dataset.evaluate --task consult --split train --predictor dataset.predictors:rules_consult --name review.train` и остальные сочетания | Все четыре оценки train/holdout совпали с сохранёнными (время исключено из сравнения) |
| Реальный HTTP | `python backend/tests/smoke_round2.py --url http://127.0.0.1:18000 --output /tmp/round2-result.json` | status=ok, 7 проверок; см. artifacts/ROUND2_native.json |
| Браузер без моков | Фронт dev@7c64209 во временной копии, `VITE_USE_MOCKS=false`, три нативных HTTP-сервиса | Вход аналитиком, решение по Вектору, выход, вход клиентом, оффер/комментарий; чат → анкета → сохранённый план. Console errors: [] |
| Фронт — только проверка неизменённого кода Саши | `VITE_USE_MOCKS=false VITE_CSP_ALLOW_HTTP=true npm run build` во временной копии | tsc + Vite: успешно, 661 модуль; исходное frontend/ не редактировалось |
| Compose | Разбор YAML, проверка четырёх build-путей, 8080:8080 и volume | Статически OK; Docker отсутствует, контейнеры не запускались |
| Пробелы/патч | `git diff --check` | Успешно |

Первоначальные две остановки нового набора устранены: `recommendation=null` допустима до скоринга;
тест создания черновика теперь явно выбирает действующую компанию для fast и проверяет HTTP-статус.

### Метрики сервиса правил Дани

Это собственная система правил, а не обученная модель.
Старый holdout использовался при настройке, поэтому **он больше не является независимой оценкой**.
Числа на обоих синтетических наборах воспроизведены; реальное качество новых пользовательских фраз ещё не установлено.

| Метрика | train | прежний holdout |
|---|---|---|
| consult: type и state целиком | 0,9791 | 0,9933 |
| consult: придуманные суммы | 0 | 0 |
| consult: обещания кредита | 0 | 0 |
| parse-need: purpose | 0,9739 | 0,9899 |
| parse-need: sphere | 0,9735 | 0,9561 |
| parse-need: city | 0,9851 | 0,9865 |
| parse-need: amount_rub | 1,0000 | 1,0000 |

Числовые пороги раздела 13.3 на имеющихся наборах достигнуты; независимый новый набор нужен
до вывода о качестве вне генератора. Дане подготовлено отдельное задание на него.
Исправленная baseline-оценка придуманных сумм — около 0,030 вместо прежних 0,017.

Фактические HTTP-замеры на Mac ARM64, без GPU/ключа: первые 50 различных запросов
прежнего holdout для каждого метода; используется только для измерения времени, не для настройки.

| Метод | N | Среднее | p95 |
|---|---|---|---|
| /ai/consult | 50 | 2,55 мс | 4,06 мс |
| /ai/parse-need | 50 | 1,40 мс | 2,15 мс |

Источник: `artifacts/ROUND2_ai_timing.json`. Это не замер Linux-контейнера на машине жюри и не измерение памяти.

### Запуск для проверки

**На машине с Docker (следующая обязательная проверка):**

```bash
git clone --branch backend https://github.com/xrnskew/XRONIX.git
cd XRONIX
docker compose up --build
# http://localhost:8080/app
# http://localhost:8080/docs
```

Демо-входы: `client@xronix.demo` / `demo12345`, `analyst@xronix.demo` / `demo12345`.
По умолчанию `SEED_DEMO=true`, `CONSULT_CHAT=true`, `VITE_USE_MOCKS=false`.
SQLite, ключ сессий, загрузки и локальные бэкапы живут в томе `backend-data`.
Собственный origin для доступа с другого устройства добавить в CORS_ORIGINS.

**Нативный запуск без Docker, три терминала:**

```bash
# Установка из корня (Python 3.12+; проверено на Python 3.13)
python3 -m venv /tmp/xronix-round2-backend
/tmp/xronix-round2-backend/bin/pip install -r backend/requirements.txt -r backend/requirements-dev.txt
python3 -m venv /tmp/xronix-round2-ai
/tmp/xronix-round2-ai/bin/pip install -r ai/requirements.txt

# Терминал 1
cd integrations-mock
/tmp/xronix-round2-backend/bin/uvicorn app.main:app --host 127.0.0.1 --port 8002

# Терминал 2 (из корня)
cd ai
/tmp/xronix-round2-ai/bin/uvicorn app.main:app --host 127.0.0.1 --port 8001

# Терминал 3 (из корня), новая одноразовая демо-база
cd backend
SEED_DEMO=true CONSULT_CHAT=true DATABASE_URL=sqlite:////tmp/xronix-round2-demo.sqlite \
INTEGRATIONS_URL=http://127.0.0.1:8002 AI_SERVICE_URL=http://127.0.0.1:8001 \
/tmp/xronix-round2-backend/bin/uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000

# Терминал 4 (из корня)
/tmp/xronix-round2-backend/bin/python backend/tests/smoke_round2.py --url http://127.0.0.1:8000 --output /tmp/round2-result.json
```

Скрипт принимает демо-решения и создаёт новый чат/заявку. Для повторения всего сценария
использовать новую демо-базу, потому что исходные Вектор/Лебедев уже получат решение.
Чтобы запустить только данные/оценку Дани, отдельно установить `ai/dataset/requirements.txt`;
для работы самого сервиса эта морфология/генератор не нужны.

### Что не сделано и почему

- Docker build/up и сценарий на чистой машине с контейнерами: Docker на доступном Mac отсутствует.
  Проверены файлы/пути/порты, нативная сеть и браузер, но они не доказывают контейнерный запуск.
- Новая независимая проверка правил на живых/ручных фразах: прежний holdout участвовал в настройке.
  Готовое следующее сообщение Дане — `backend/ROUND2_EXTERNAL_TASKS.md`.
- Обучение Qwen/LoRA не проводилось и не требуется по последнему решению пользователя.
- Продакшен не обновлялся. Слияние новых результатов раунда 2 в dev не выполнялось.
- Codex не редактировал frontend/ или ai/: получены коммиты Саши/Дани и проверены их результаты.
  Сообщений участникам самостоятельно не отправлял, агентов вместо Дани не запускал.

### Вопросы и предложения

1. Согласовать общий maxLength текста consult и клиентского reply.
2. На машине с Docker выполнить пункты 12–13 и приложить вывод, после этого принимать весь раунд.
3. Дане — новая ручная выборка и исходная оценка фиксированных правил до донастройки.

### Подтверждения

- [HTTP-сценарии](artifacts/ROUND2_native.json)
- [HTTP-время сервиса правил](artifacts/ROUND2_ai_timing.json)
- [Оффер клиента после решения аналитика](artifacts/ROUND2_client_offer.png)
- [Сохранённый план в чате без моков](artifacts/ROUND2_chat_plan.png)
