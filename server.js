import express from 'express';
import path from 'path';
import fs from 'fs';
import url from 'url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// CORS for development
import cors from 'cors';
app.use(cors());

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Load schema
const schemaPath = path.join(__dirname, 'data', 'schema.json');
let tableSchema = null;
try {
  const schemaStr = fs.readFileSync(schemaPath, 'utf-8');
  tableSchema = JSON.parse(schemaStr);
} catch (err) {
  console.error('Failed to load schema.json. Ensure data/schema.json exists.', err);
  tableSchema = {
    title: 'Users',
    columns: [
      { field: 'id', label: 'ID', type: 'number', sortable: true, filter: { type: 'numberRange' } },
      { field: 'name', label: 'Name', type: 'string', sortable: true, filter: { type: 'text' } },
      { field: 'email', label: 'Email', type: 'string', sortable: true, filter: { type: 'text' } },
      { field: 'role', label: 'Role', type: 'enum', options: ['Admin','User','Manager'], sortable: true, filter: { type: 'select', multiple: true } },
      { field: 'active', label: 'Active', type: 'boolean', sortable: true, filter: { type: 'boolean' } },
      { field: 'createdAt', label: 'Created At', type: 'date', sortable: true, filter: { type: 'dateRange' }, format: 'yyyy-MM-dd' }
    ],
    rowActions: [
      { name: 'view', label: 'View' },
      { name: 'delete', label: 'Delete', confirm: true }
    ],
    bulkActions: [
      { name: 'export', label: 'Export CSV' },
      { name: 'deactivate', label: 'Deactivate', confirm: true }
    ],
    defaultPageSize: 10,
    allowedPageSizes: [10, 25, 50, 100],
    filterMode: 'server'
  };
}

// In-memory data generation
let dataRows = [];
function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function generateData(count = 250) {
  const firstNames = ['Alice','Bob','Carol','Dave','Eve','Frank','Grace','Heidi','Ivan','Judy','Mallory','Niaj','Olivia','Peggy','Rupert','Sybil','Trent','Victor','Wendy','Yvonne','Zara'];
  const lastNames = ['Smith','Johnson','Williams','Jones','Brown','Davis','Miller','Wilson','Moore','Taylor'];
  const roles = ['Admin','User','Manager'];
  const rows = [];
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - 3);
  for (let i = 1; i <= count; i++) {
    const first = randomChoice(firstNames);
    const last = randomChoice(lastNames);
    const name = `${first} ${last}`;
    const email = `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.com`;
    const role = randomChoice(roles);
    const active = Math.random() > 0.25;
    const createdAt = new Date(startDate.getTime() + Math.random() * (Date.now() - startDate.getTime()));
    rows.push({ id: i, name, email, role, active, createdAt: createdAt.toISOString() });
  }
  return rows;
}

dataRows = generateData(300);

// Utilities
function applyFilters(rows, filters, schema) {
  if (!filters || Object.keys(filters).length === 0) return rows;
  const columnMap = new Map(schema.columns.map(c => [c.field, c]));
  return rows.filter(row => {
    for (const [field, filterDef] of Object.entries(filters)) {
      const column = columnMap.get(field);
      if (!column) continue;
      const value = row[field];
      const type = column.type;
      const fType = filterDef.type;

      if (fType === 'text') {
        const q = (filterDef.value ?? '').toString().toLowerCase();
        if (q && value != null && value.toString().toLowerCase().includes(q) === false) return false;
      } else if (fType === 'numberRange') {
        const numVal = Number(value);
        if (Number.isFinite(filterDef.min) && !(numVal >= Number(filterDef.min))) return false;
        if (Number.isFinite(filterDef.max) && !(numVal <= Number(filterDef.max))) return false;
      } else if (fType === 'select') {
        const selected = Array.isArray(filterDef.values) ? filterDef.values : (filterDef.value != null ? [filterDef.value] : []);
        if (selected.length > 0 && !selected.includes(value)) return false;
      } else if (fType === 'boolean') {
        if (filterDef.value === true || filterDef.value === false) {
          if (Boolean(value) !== Boolean(filterDef.value)) return false;
        }
      } else if (fType === 'dateRange') {
        const dateVal = value ? new Date(value) : null;
        if (filterDef.from) {
          const from = new Date(filterDef.from);
          if (!dateVal || dateVal < from) return false;
        }
        if (filterDef.to) {
          const to = new Date(filterDef.to);
          if (!dateVal || dateVal > to) return false;
        }
      }
    }
    return true;
  });
}

function applySort(rows, sortBy, sortDir, schema) {
  if (!sortBy) return rows;
  const column = schema.columns.find(c => c.field === sortBy);
  if (!column) return rows;
  const dir = sortDir === 'desc' ? -1 : 1;
  const type = column.type;
  return [...rows].sort((a, b) => {
    const va = a[sortBy];
    const vb = b[sortBy];
    if (va == null && vb == null) return 0;
    if (va == null) return -1 * dir;
    if (vb == null) return 1 * dir;
    if (type === 'number') {
      return (Number(va) - Number(vb)) * dir;
    } else if (type === 'date') {
      return (new Date(va) - new Date(vb)) * dir;
    } else if (type === 'boolean') {
      return ((va === vb) ? 0 : va ? 1 : -1) * dir;
    } else {
      return va.toString().localeCompare(vb.toString()) * dir;
    }
  });
}

function paginate(rows, page, pageSize) {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  const end = start + pageSize;
  const items = rows.slice(start, end);
  return { items, page: safePage, pageSize, total, totalPages };
}

app.get('/api/schema', (req, res) => {
  res.json(tableSchema);
});

app.get('/api/data', (req, res) => {
  try {
    const all = req.query.all === 'true';
    let filters = {};
    if (req.query.filters) {
      try { filters = JSON.parse(req.query.filters); } catch (e) {}
    }
    const sortBy = req.query.sortBy || null;
    const sortDir = req.query.sortDir === 'desc' ? 'desc' : 'asc';
    const page = parseInt(req.query.page || '1', 10);
    const pageSize = parseInt(req.query.pageSize || String(tableSchema.defaultPageSize || 10), 10);

    let rows = dataRows;
    rows = applyFilters(rows, filters, tableSchema);
    rows = applySort(rows, sortBy, sortDir, tableSchema);

    if (all) {
      return res.json({ items: rows, page: 1, pageSize: rows.length, total: rows.length, totalPages: 1 });
    }

    const result = paginate(rows, page, pageSize);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to get data' });
  }
});

app.post('/api/actions/:action', (req, res) => {
  const action = req.params.action;
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
  if (ids.length === 0) return res.status(400).json({ error: 'No ids provided' });
  if (action === 'delete') {
    const before = dataRows.length;
    dataRows = dataRows.filter(r => !ids.includes(Number(r.id)));
    return res.json({ ok: true, removed: before - dataRows.length });
  } else if (action === 'deactivate') {
    let updated = 0;
    dataRows = dataRows.map(r => {
      if (ids.includes(Number(r.id))) { updated++; return { ...r, active: false }; }
      return r;
    });
    return res.json({ ok: true, updated });
  } else if (action === 'view') {
    const found = dataRows.filter(r => ids.includes(Number(r.id)));
    return res.json({ ok: true, items: found });
  } else {
    return res.json({ ok: true, action, ids });
  }
});

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});