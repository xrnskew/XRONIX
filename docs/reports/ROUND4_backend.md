# Раунд 4 · backend

Плановая дата — **25 октября 2026**, отчёт подготовлен 21 октября. Сквозной Docker-прогон ещё не проводился. Значения ниже описывают подготовку машины; это не метрики стека XRONIX.

## Проверка домашнего сервера 21.10

Пользователь разрешил проверку. Выполнены только чтения по SSH `home-server-ddns`; сервисы, образы, тома, порты и конфигурация не менялись.

| Параметр | Наблюдение |
|---|---|
| ОС / CPU | Linux 6.8.0-147-generic, 2 логических CPU |
| Docker / Compose | 29.1.3 / 2.40.3+ds1-0ubuntu1~24.04.1 |
| RAM | всего 15456 MiB, доступно 11522 MiB, swap используется 0 |
| Диск / | 227 GiB, доступно 163 GiB |
| Уже работающий Docker | 30 контейнеров, 29 образов (13.67 GB), 14 томов (626.2 MB), build cache 523.4 MB |
| Порты | 127.0.0.1:8080 и :18080 уже заняты |
| Средства чистой ВМ | virsh, qemu-system-x86_64, multipass не найдены в PATH; /dev/kvm не обнаружен |

**Вывод:** ресурсов достаточно для обсуждения отдельного тестового окружения, но сервер не чистый. `docker compose up` из исходного compose столкнётся с занятым 8080. Существующие контейнеры/кэш не удалять и не останавливать. Для заявленного «на чистой машине» нужна отдельная свежая ВМ с Docker/Compose либо другая предоставленная машина. Изолированный compose-проект с изменённым портом возможен как дополнительная проверка, но его нельзя выдать за исходный сценарий на чистом хосте.

## Протокол 25 октября на выделенной чистой машине

До начала записать ОС, CPU, RAM, диск, Docker/Compose, сеть, SHA собственной ветки backend, состояние image/build caches и отсутствие .env/старого тома. Использовать свежий clone, а не рабочую папку разработчика. Сервис web собирается без моков исходным Dockerfile; frontend не редактировать.

```sh
mkdir round4-artifacts
docker version > round4-artifacts/docker-version.txt
docker compose version > round4-artifacts/compose-version.txt
docker system df > round4-artifacts/docker-df-before.txt
docker images > round4-artifacts/images-before.txt
/usr/bin/time -p git clone --branch backend https://github.com/xrnskew/XRONIX.git XRONIX 2> round4-artifacts/clone-time.txt
cd XRONIX
git rev-parse HEAD > ../round4-artifacts/revision.txt
git status --short --branch > ../round4-artifacts/git-status.txt
docker compose config --quiet
/usr/bin/time -p docker compose up -d --build --wait --wait-timeout 600 > ../round4-artifacts/up.txt 2> ../round4-artifacts/up-time.txt
docker compose ps --format json > ../round4-artifacts/ps-healthy.json
docker stats --no-stream $(docker compose ps -q) > ../round4-artifacts/stats-healthy.txt
docker system df > ../round4-artifacts/docker-df-after.txt
docker images > ../round4-artifacts/images-after.txt
docker compose images > ../round4-artifacts/project-images.txt
```

Время `clone → healthy` = real из clone-time + real из up-time; отдельно привести оба интервала. Между командами не включать в результат ручные паузы. Если build/start падает, записать неуспешную попытку и причину, не стирать её. У всех четырёх сервисов должен быть health=healthy (у web healthcheck задан в Dockerfile). `docker system df` относится ко всему хосту; на чистой машине это допустимо, а `project-images.txt` отделяет образы проекта. Память снять после healthy и после браузерных сценариев, отметить моменты измерения.

Браузер: открыть http://<тестовая-машина>:8080/app, без публичного переключения xronix.ru. Зафиксировать браузер, URL, SHA, пользователя, результат и скриншоты:

| Сценарий | С AI | Без AI |
|---|---|---|
| Вход client@xronix.demo / analyst@xronix.demo | не выполнен | не выполнен |
| Аналитик: «Вектор», «Лебедев» | не выполнен | не выполнен |
| Чат → факт с источником → план → Старт | не выполнен | факт AI не ожидается, запасной план: не выполнен |
| Господдержка: Северная выпечка, 40 млн, без залога, 36 мес.; единственный подходящий продукт с датой акции, заявка → аналитик, +8 | не выполнен | не выполнен |

После первого набора снять stats, затем `docker compose stop ai`. Проверить backend health, новый чат с новой историей, повторить вход и бизнес-сценарии; старые изменённые заявки не считать свежим прогоном. Новые заявки или второй изолированный проект с чистым томом — с фиксацией этого условия. Записать время ответа запасного диалога и ошибки консоли/сети. Затем `docker compose start ai`, дождаться health, сохранить финальный ps/logs/stats. Публичный AI/сайт и чужие контейнеры не трогать; глобальный prune не использовать.

## Цифры для README

| Метрика XRONIX | Результат |
|---|---|
| Clone | не измерено |
| Build + запуск до 4 healthy | не измерено |
| Суммарно clone → healthy | не измерено |
| RAM каждого из 4 контейнеров после healthy / сценариев | не измерено |
| Размер каждого образа, суммарный disk/cache | не измерено |
| Сценарии с AI / без AI | ожидают прогона |

Чистая машина и время запуска ещё не согласованы. Автоматический запуск/выкладка на 25 октября не настроены.
