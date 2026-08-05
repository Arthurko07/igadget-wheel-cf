# ⚡ iGadget — Колесо Фортуны (Cloudflare Workers, 100% бесплатно)

Worker + D1 (база) + R2 (картинки, фолбэк на Telegraph) + бот grammY через webhook.

## Запуск
Инструкция: см. чат/документацию проекта. Кратко:
1. `npm install`
2. `npx wrangler login`
3. `npx wrangler d1 create igadget-wheel` → вписать database_id в wrangler.toml
4. `npx wrangler d1 execute igadget-wheel --file=./schema.sql`
5. `npx wrangler r2 bucket create igadget-wheel-images`
6. `npx wrangler secret put BOT_TOKEN / ADMIN_PASSWORD / WEBHOOK_SECRET`
7. `npx wrangler deploy`
8. `curl -X POST https://АДРЕС.workers.dev/api/setup -H "X-Admin-Password: ПАРОЛЬ"`
