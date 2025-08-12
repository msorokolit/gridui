# JSON Schema Table (Vanilla JS + Express)

Render tables from a JSON schema and JSON data with powerful filtering, sorting, pagination, and row/bulk actions. No JS framework.

## Features
- Server-side or client-side mode (toggle)
- Filters by column: text, number range, date range, select (single/multi), boolean
- Sorting per column
- Pagination with page size options
- Row actions and bulk actions (export/deactivate/delete examples)
- Bootstrap 5 UI

## Getting started

```bash
cd /workspace
npm install
npm start
```

Open `http://localhost:3000` in your browser.

## Schema
Edit `data/schema.json` to customize columns, filters, and actions.

## Notes
- Demo data (300 rows) is generated in-memory at server start. Adjust generator in `server.js` as needed.
- For client-side mode, the app fetches the full dataset and applies filters/sort/pagination locally.