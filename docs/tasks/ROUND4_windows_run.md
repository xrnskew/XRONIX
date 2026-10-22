# Замер чистого запуска на Windows (Даня)

Главный замер для README: на твоей Windows-машине, на свежем клоне ветки `backend`. Числа и сырые файлы идут в README вместо прежнего пересказа внешнего отчёта. Если Илья сумеет получить сырые артефакты прежнего Windows-прогона (`docs/reports/ROUND4_windows.md`), мы добавим его вторым замером рядом, как независимое подтверждение. Код, `contracts/`, `backend/`, `frontend/` не менять.

## Условия честного замера
1. Docker должен быть пустым: `docker images` и `docker system df` показывают ноль образов и кэша. Если нет, так и напиши в отчёте и собери с `--no-cache` (тогда это «холодная сборка при закэшированных базовых образах»). Чужие образы и тома не удалять и не чистить.
2. Порт `8080` свободен, клон свежий, ветка `backend`.
3. Установка Docker в замер не входит.

## Подготовка (PowerShell)
```powershell
docker version > ver-docker.txt; docker compose version > ver-compose.txt
docker system df > df-before.txt; docker images > images-before.txt
```

## Запуск
```powershell
$c = Measure-Command { git clone --branch backend --single-branch https://github.com/xrnskew/XRONIX.git xronix-r4 }
cd xronix-r4; git rev-parse HEAD > ..\revision.txt
$u = Measure-Command { docker compose up -d --build --wait --wait-timeout 600 }   # с --no-cache, если Docker не пустой
"clone $($c.TotalSeconds) c; up $($u.TotalSeconds) c" > ..\timing.txt
docker compose ps > ..\ps.txt
docker stats --no-stream $(docker compose ps -q) > ..\stats-healthy.txt
docker compose images > ..\compose-images.txt; docker system df > ..\df-after.txt
```

## Браузер (`http://localhost:8080/app`, скриншоты файлами)
1. Экран входа.
2. «Клиент» (тестовый вход) → чат «Хочу пекарню в Самаре, своих 900 000 ₽» → «Нет опыта» → план с карточкой «Налоги».
3. «Аналитик банка» → очередь с Вектором и Лебедевым.

## Без AI
`docker compose stop ai`; `docker stats --no-stream` в `stats-ai-stopped.txt`; новый чат «Хочу кофейню в Казани, 500 000 ₽» (должен ответить запасной диалог, скриншот); `docker compose start ai`, дождаться `healthy`, `stats-final.txt`.

## Оформление
- Файлы в `docs/reports/artifacts/ROUND4_windows_danya/`; к каждому SHA-256 (`Get-FileHash`) в `ROUND4_windows_danya_manifest.json`.
- Отчёт `docs/reports/ROUND4_windows_danya.md`: ОС, процессор, память, версии Docker и Compose, был ли Docker пустым и была ли сборка с `--no-cache`, три числа (`clone`, `up`, сумма), память по сервисам, размеры образов, что видно на скриншотах, что пошло не так.
- Из логов убрать личные пути и всё, похожее на секреты, и отметить это в отчёте.
- Неудачные попытки и их причины записать, не стирать.
- Отчёт и файлы в `backend-ai`, хеш коммита сообщить Илье.

## Что дальше с числами
Саша переносит их в README: время `clone → healthy`, память по сервисам после старта, размеры образов, с пометкой «Windows, дата, Docker пуст / с `--no-cache`, сырые файлы в `docs/reports/artifacts/ROUND4_windows_danya/`».
