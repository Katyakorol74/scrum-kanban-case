# Scrum → Kanban на TatNet Apps + Supabase

Этот проект сохраняет оригинальный интерфейс из предоставленного `Index.html` и переносит API `/api/session` и `/api/coach` в Next.js. Сервер хранит состояние в таблице `public.app_kv` базы TatNet Supabase.

## Переменные окружения

Задайте их в настройках приложения TatNet Apps (значения секретов не добавлять в Git):

- `SUPABASE_URL` — URL базы, например `https://<project-id>.supa.tatcloud.ru`
- `SUPABASE_SERVICE_ROLE_KEY` — ключ `service_role` из Supabase Studio → Project Settings → API. Хранить только на сервере.
- `COACH_PASSWORD` — новый длинный пароль для кабинета ведущего.

## Запуск локально

```bash
npm install
npm run dev
```

## Важно

- Таблица `public.app_kv` должна существовать и иметь столбцы `key text primary key`, `value jsonb`, `updated_at timestamptz`.
- Доступ anon/authenticated к таблице намеренно закрыт. Сервер использует только `SUPABASE_SERVICE_ROLE_KEY`.
- Не добавляйте `.env`/ключи в Git и не размещайте service-role key в браузерном HTML.
- После создания приложения проверьте /api/session?code=TEST123&team=1&create=1, затем проверьте кабинет ведущего и несколько одновременных браузерных сессий.
- Код использует очередь запросов внутри одного процесса и сохраняет только изменившиеся строки. Перед производственным использованием нужно провести нагрузочную проверку и проверить обработку параллельных изменений одного борда.
