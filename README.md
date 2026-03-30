# Monopoly Room Engine (Next.js + PWA)

Готовый к работе движок комнаты Monopoly на Next.js 16 (App Router) с PWA-установкой, локальной синхронизацией между вкладками и подготовкой к деплою на Vercel.

## Что уже реализовано

- Архитектура по слоям:
- `src/domain` - бизнес-правила комнаты и операций.
- `src/application` - сценарии join/leave/операции.
- `src/infrastructure` - realtime sync store (Yjs + websocket transport).
- `src/ui` - интерфейс и PWA-регистрация.
- PWA:
- `app/manifest.ts`
- `public/sw.js`
- `public/offline.html`
- иконки Monopoly в `public/icons`.
- Светлая тема интерфейса, адаптивная под мобильные.
- Формат комнаты: `4 цифры` (например, `0427`).
- Сессия игрока сохраняется локально: после перезагрузки страницы можно продолжить работу в комнате.
- В интерфейсе есть кнопка `🔄` для полного сброса комнаты у всех подключённых устройств.

## Локальный запуск

```bash
npm install
npm run dev
```

Открыть: [http://localhost:3000](http://localhost:3000)

## Проверки качества

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

## Деплой на Vercel

1. Убедиться, что изменения закоммичены в ветку `main`.
2. Подключить репозиторий в Vercel.
3. Настройки проекта:
- Framework Preset: `Next.js`
- Build Command: `npm run build`
- Output Directory: `.next` (по умолчанию)
4. Нажать Deploy.

CLI-вариант:

```bash
npm i -g vercel
vercel login
vercel --prod
```

## Self-Hosted (VPS, стабильные комнаты)

Рекомендуемый production-контур:

- `monopoly-web` (Next.js) на `:3000`
- `monopoly-realtime` (`@y/websocket-server`) на `:1234`
- `nginx` проксирует HTTP на `:3000`

### 1. Подготовка сервера

```bash
apt update
apt install -y curl git nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm i -g pm2
```

### 2. Сборка проекта

```bash
npm ci
npm run build
```

### 3. Запуск сервисов

```bash
NEXT_PUBLIC_YJS_WEBSOCKET_SERVER=ws://YOUR_SERVER_IP:1234 pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u root --hp /root
```

### 4. Быстрая проверка realtime

```bash
YJS_SERVER_URL=ws://127.0.0.1:1234 npm run test:realtime
```

### 5. Проверка задержки репликации

```bash
YJS_SERVER_URL=ws://127.0.0.1:1234 npm run test:latency
```

## Ограничение текущей версии

Синхронизация комнат работает в realtime через публичные websocket-серверы Yjs. Для продакшн-нагрузки рекомендуется использовать собственный websocket backend (или managed realtime сервис) без изменений бизнес-логики.

### Настройка realtime-сервера (опционально)

По умолчанию используется `wss://demos.yjs.dev` с автоматическим fallback на `wss://demos.yjs.dev/ws`.

Если приложение запущено на VPS без переменной окружения, клиент сначала попробует `ws://<current-host>:1234` (или `wss://` для HTTPS), а затем fallback-серверы.

Если нужно использовать свой сервер:

```bash
NEXT_PUBLIC_YJS_WEBSOCKET_SERVER=wss://your-realtime.example
```

Можно указать несколько endpoint’ов через запятую, тогда клиент будет переключаться между ними при проблемах соединения:

```bash
NEXT_PUBLIC_YJS_WEBSOCKET_SERVER=wss://primary.example,wss://backup.example
```
