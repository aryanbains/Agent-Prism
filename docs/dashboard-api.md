# Dashboard API

- `GET /api/health`
- `GET /api/sessions`
- `GET /api/sessions/:id`
- `GET /api/sessions/:id/tree`
- `GET /api/runs/:id`
- `GET /api/tool-calls/:id`
- `GET /api/model-calls/:id`
- `GET /api/stats/cost`
- `GET /api/stats/health`
- `GET /api/export?format=json|csv`
- `GET /api/stream`

The SSE stream emits `ready` and `trace-update` events.