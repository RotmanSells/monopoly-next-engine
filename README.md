# Monopoly Room Engine (Next.js + PWA)

Готовый к работе движок комнаты Monopoly на Next.js 16 (App Router) с PWA-установкой, локальной синхронизацией между вкладками и подготовкой к деплою на Vercel.

## Что уже реализовано

- Архитектура по слоям:
- `src/domain` - бизнес-правила комнаты и операций.
- `src/application` - сценарии join/leave/операции.
- `src/infrastructure` - localStorage + BroadcastChannel.
- `src/ui` - интерфейс и PWA-регистрация.
- PWA:
- `app/manifest.ts`
- `public/sw.js`
- `public/offline.html`
- иконки Monopoly в `public/icons`.
- Светлая тема интерфейса, адаптивная под мобильные.

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

## Ограничение текущей версии

Состояние комнаты хранится локально в браузере (`localStorage`) и синхронизируется между вкладками одного устройства. Для кросс-устройственного мультиплеера нужен внешний backend-адаптер (например Firebase/Supabase/Redis API) в слое `infrastructure`.
