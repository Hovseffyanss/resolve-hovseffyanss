# Running Resolve

Operational reference. Read this when you need to run, build, or debug the
app — not needed to write code.

## Scripts

```bash
npm start          # ts-node src/main.ts, listens on :3000 (PORT to change)
npm run build      # tsc -> dist/
npm run start:prod # node dist/main.js
npm test           # jest, no database needed
npm run test:watch
```

Single file: `npx jest src/tickets/tickets.service.spec.ts`
By name: `npx jest -t "rejects invalid input"`

## Local dev

Tests need no database. The app itself does:

```bash
docker compose up -d db   # just Postgres
npm install
npm start
```

## Full stack

```bash
docker compose up -d --build   # Postgres 16 + the app
curl localhost:3000/stats
```

Port 3000 busy? `APP_PORT=3300 docker compose up -d --build`.
Config is env-driven — `cp .env.example .env`. Data lives in the `pgdata`
volume; `docker compose down -v` resets it.

## Deployment

CI deploys on every push to `main`.
