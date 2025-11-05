# FerBot API (limpia)

## Arranque local
1. `cp .env.example .env` y coloca `OPENAI_API_KEY=...`
2. `npm i`
3. `npm start`
4. Visita `http://localhost:3000/health` y `http://localhost:3000/agent`

## Endpoints
- `GET /health` → ping + modelo.
- `GET /admin/reloadTrainer` → recarga identidad + conocimiento.
- `POST /assist_trainer` → { reply, why, next } + tracking shown.
- `POST /trackRate` → guarda calificación (wins).
- `GET /admin/usage.json` → JSON de métricas.
- `GET /agent` → panel unificado (emergencia).

## Deploy
Sube este repo a GitHub y conecta a Render (Web Service, Node 18+).  
Variables: `OPENAI_API_KEY`, `OPENAI_MODEL` (opcional).
