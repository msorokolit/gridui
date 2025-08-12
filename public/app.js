const api = {
  async getSchema() {
    const res = await fetch('/api/schema');
    return res.json();
  },
  async getData({ filters, sortBy, sortDir, page, pageSize, mode }) {
    const params = new URLSearchParams();
    if (filters && Object.keys(filters).length > 0) params.set('filters', JSON.stringify(filters));
    if (sortBy) params.set('sortBy', sortBy);
    if (sortDir) params.set('sortDir', sortDir);
    if (mode === 'client') params.set('all', 'true');
    else {
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
    }
    const res = await fetch(`/api/data?${params.toString()}`);
    return res.json();
  },
  async action(action, ids) {
    const res = await fetch(`/api/actions/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    return res.json();
  }
};

const state = {
  schema: null,
  filters: {},
  sortBy: null,
  sortDir: 'asc',
  page: 1,
  pageSize: 10,
  totalPages: 1,
  total: 0,
  mode: 'server',
  items: [], // current page items (server) or full items (client)
  pageItems: [],
  selectedIds: new Set(),
};

function formatValue(value, column) {
  if (value == null) return '';
  if (column.type === 'date') {
    try {
      const d = new Date(value);
      return d.toLocaleDateString();
    } catch { return String(value); }
  }
  if (column.type === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function buildFilterControl(column) {
  const wrapper = document.createElement('div');
  wrapper.className = 'filter-item';
  const id = `filter-${column.field}`;
  const label = document.createElement('label');
  label.textContent = column.label;
  label.setAttribute('for', id);
  wrapper.appendChild(label);

  const fType = column.filter?.type;
  let control;
  if (fType === 'text') {
    control = document.createElement('input');
    control.type = 'text';
    control.className = 'form-control form-control-sm';
    control.placeholder = 'Search...';
    control.addEventListener('input', debounce(() => {
      const val = control.value.trim();
      setFilter(column.field, { type: 'text', value: val });
    }, 300));
  } else if (fType === 'numberRange') {
    control = document.createElement('div');
    control.className = 'd-flex gap-2';
    const minI = document.createElement('input');
    minI.type = 'number';
    minI.className = 'form-control form-control-sm';
    minI.placeholder = 'Min';
    const maxI = document.createElement('input');
    maxI.type = 'number';
    maxI.className = 'form-control form-control-sm';
    maxI.placeholder = 'Max';
    const onChange = debounce(() => {
      const min = minI.value !== '' ? Number(minI.value) : undefined;
      const max = maxI.value !== '' ? Number(maxI.value) : undefined;
      setFilter(column.field, { type: 'numberRange', min, max });
    }, 300);
    minI.addEventListener('input', onChange);
    maxI.addEventListener('input', onChange);
    control.append(minI, maxI);
  } else if (fType === 'dateRange') {
    control = document.createElement('div');
    control.className = 'd-flex gap-2';
    const fromI = document.createElement('input');
    fromI.type = 'date';
    fromI.className = 'form-control form-control-sm';
    const toI = document.createElement('input');
    toI.type = 'date';
    toI.className = 'form-control form-control-sm';
    const onChange = debounce(() => {
      const from = fromI.value || undefined;
      const to = toI.value || undefined;
      setFilter(column.field, { type: 'dateRange', from, to });
    }, 300);
    fromI.addEventListener('input', onChange);
    toI.addEventListener('input', onChange);
    control.append(fromI, toI);
  } else if (fType === 'select') {
    const multiple = column.filter?.multiple;
    const select = document.createElement('select');
    select.className = 'form-select form-select-sm';
    if (multiple) select.multiple = true;

    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = multiple ? 'Any (Ctrl/Cmd-click to multi-select)' : 'Any';
    if (!multiple) select.appendChild(allOpt);

    const options = column.options || [];
    for (const opt of options) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      select.appendChild(o);
    }
    select.addEventListener('change', () => {
      if (multiple) {
        const values = Array.from(select.selectedOptions).map(o => o.value);
        setFilter(column.field, { type: 'select', values });
      } else {
        const value = select.value || undefined;
        setFilter(column.field, { type: 'select', value });
      }
    });
    control = select;
  } else if (fType === 'boolean') {
    const select = document.createElement('select');
    select.className = 'form-select form-select-sm';
    select.innerHTML = '<option value="">Any</option><option value="true">True</option><option value="false">False</option>';
    select.addEventListener('change', () => {
      const v = select.value;
      setFilter(column.field, { type: 'boolean', value: v === '' ? undefined : v === 'true' });
    });
    control = select;
  } else {
    control = document.createElement('span');
    control.className = 'text-muted';
    control.textContent = 'No filter';
  }

  control.id = id;
  wrapper.appendChild(control);
  return wrapper;
}

function setFilter(field, def) {
  if (def == null) delete state.filters[field];
  else state.filters[field] = def;
  state.page = 1;
  refresh();
}

function buildFilters() {
  const container = document.getElementById('filters-container');
  container.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'filter-row';
  for (const col of state.schema.columns) {
    if (!col.filter) continue;
    const item = buildFilterControl(col);
    row.appendChild(item);
  }
  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn btn-sm btn-outline-secondary';
  clearBtn.textContent = 'Clear Filters';
  clearBtn.addEventListener('click', () => {
    state.filters = {};
    refresh();
    buildFilters(); // reset inputs visual
  });
  const actions = document.createElement('div');
  actions.className = 'd-flex gap-2 align-items-end';
  actions.appendChild(clearBtn);

  const outer = document.createElement('div');
  outer.className = 'd-grid gap-2';
  outer.append(row, actions);
  container.appendChild(outer);
}

function buildTable() {
  const head = document.getElementById('table-head');
  const body = document.getElementById('table-body');
  head.innerHTML = '';
  body.innerHTML = '';

  const headerRow1 = document.createElement('tr');
  // Select all checkbox
  const selectTh = document.createElement('th');
  selectTh.className = 'select-all-cell';
  const selectAll = document.createElement('input');
  selectAll.type = 'checkbox';
  selectAll.addEventListener('change', () => {
    const idsOnPage = state.pageItems.map(r => r.id);
    if (selectAll.checked) idsOnPage.forEach(id => state.selectedIds.add(id));
    else idsOnPage.forEach(id => state.selectedIds.delete(id));
    renderBody();
    renderBulkActions();
  });
  selectTh.appendChild(selectAll);
  headerRow1.appendChild(selectTh);

  for (const col of state.schema.columns) {
    const th = document.createElement('th');
    th.textContent = col.label;
    if (col.sortable) {
      th.classList.add('sortable');
      const sortInd = document.createElement('span');
      sortInd.className = 'sort-ind';
      if (state.sortBy === col.field) sortInd.textContent = state.sortDir === 'asc' ? '▲' : '▼';
      th.appendChild(sortInd);
      th.addEventListener('click', () => {
        if (state.sortBy === col.field) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        else { state.sortBy = col.field; state.sortDir = 'asc'; }
        state.page = 1;
        refresh();
      });
    }
    headerRow1.appendChild(th);
  }

  // Actions column
  if (Array.isArray(state.schema.rowActions) && state.schema.rowActions.length > 0) {
    const th = document.createElement('th');
    th.textContent = 'Actions';
    headerRow1.appendChild(th);
  }

  head.appendChild(headerRow1);

  renderBody();
}

function renderBody() {
  const body = document.getElementById('table-body');
  body.innerHTML = '';
  for (const row of state.pageItems) {
    const tr = document.createElement('tr');

    const selectTd = document.createElement('td');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.selectedIds.has(row.id);
    cb.addEventListener('change', () => {
      if (cb.checked) state.selectedIds.add(row.id); else state.selectedIds.delete(row.id);
      renderBulkActions();
    });
    selectTd.appendChild(cb);
    tr.appendChild(selectTd);

    for (const col of state.schema.columns) {
      const td = document.createElement('td');
      td.textContent = formatValue(row[col.field], col);
      tr.appendChild(td);
    }

    if (Array.isArray(state.schema.rowActions) && state.schema.rowActions.length > 0) {
      const td = document.createElement('td');
      td.className = 'actions-cell';
      for (const action of state.schema.rowActions) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm btn-outline-primary me-1';
        btn.textContent = action.label;
        btn.addEventListener('click', async () => {
          if (action.confirm && !confirm(`Are you sure to ${action.name} #${row.id}?`)) return;
          const result = await api.action(action.name, [row.id]);
          console.log('Action result', result);
          if (action.name === 'delete' || action.name === 'deactivate') {
            await refresh();
          }
          if (action.name === 'view') {
            alert(JSON.stringify(result.items?.[0] ?? row, null, 2));
          }
        });
        td.appendChild(btn);
      }
      tr.appendChild(td);
    }

    body.appendChild(tr);
  }
}

function renderPagination() {
  const pageInfo = document.getElementById('page-info');
  pageInfo.textContent = `Page ${state.page} of ${state.totalPages} — ${state.total} rows`;

  document.getElementById('prev-page').disabled = state.page <= 1;
  document.getElementById('next-page').disabled = state.page >= state.totalPages;
}

function wirePagination() {
  document.getElementById('prev-page').addEventListener('click', () => {
    if (state.page > 1) { state.page--; refresh(); }
  });
  document.getElementById('next-page').addEventListener('click', () => {
    if (state.page < state.totalPages) { state.page++; refresh(); }
  });
}

function renderBulkActions() {
  const container = document.getElementById('bulk-actions');
  container.innerHTML = '';

  const selected = Array.from(state.selectedIds);
  const info = document.createElement('div');
  info.className = 'text-muted';
  info.textContent = `${selected.length} selected`;
  container.appendChild(info);

  for (const action of state.schema.bulkActions || []) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm btn-primary';
    btn.textContent = action.label;
    btn.disabled = selected.length === 0;
    btn.addEventListener('click', async () => {
      if (action.name === 'export') {
        exportCSV(selected);
        return;
      }
      if (action.confirm && !confirm(`Apply ${action.name} to ${selected.length} rows?`)) return;
      const result = await api.action(action.name, selected);
      console.log('Bulk action result', result);
      await refresh();
      state.selectedIds.clear();
      renderBulkActions();
    });
    container.appendChild(btn);
  }
}

function exportCSV(selectedIds) {
  const rows = state.mode === 'server' ? state.pageItems : state.items;
  const rowsToExport = selectedIds.length > 0 ? rows.filter(r => selectedIds.includes(r.id)) : rows;
  const headers = state.schema.columns.map(c => c.label);
  const fields = state.schema.columns.map(c => c.field);
  const lines = [headers.join(',')];
  for (const r of rowsToExport) {
    const line = fields.map(f => {
      const v = r[f];
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s + '"';
      return s;
    }).join(',');
    lines.push(line);
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'export.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function applyClientSideOps(allItems) {
  // filters
  let rows = allItems;
  rows = clientApplyFilters(rows);
  rows = clientApplySort(rows);
  state.total = rows.length;
  state.totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  if (state.page > state.totalPages) state.page = state.totalPages;
  const start = (state.page - 1) * state.pageSize;
  state.pageItems = rows.slice(start, start + state.pageSize);
}

function clientApplyFilters(rows) {
  if (!state.filters || Object.keys(state.filters).length === 0) return rows;
  const colMap = new Map(state.schema.columns.map(c => [c.field, c]));
  return rows.filter(row => {
    for (const [field, filterDef] of Object.entries(state.filters)) {
      const column = colMap.get(field);
      if (!column) continue;
      const value = row[field];
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

function clientApplySort(rows) {
  if (!state.sortBy) return rows;
  const col = state.schema.columns.find(c => c.field === state.sortBy);
  if (!col) return rows;
  const dir = state.sortDir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const va = a[state.sortBy];
    const vb = b[state.sortBy];
    if (va == null && vb == null) return 0;
    if (va == null) return -1 * dir;
    if (vb == null) return 1 * dir;
    if (col.type === 'number') return (Number(va) - Number(vb)) * dir;
    if (col.type === 'date') return (new Date(va) - new Date(vb)) * dir;
    if (col.type === 'boolean') return ((va === vb) ? 0 : va ? 1 : -1) * dir;
    return String(va).localeCompare(String(vb)) * dir;
  });
}

function populatePageSizeOptions() {
  const sel = document.getElementById('page-size');
  sel.innerHTML = '';
  const sizes = state.schema.allowedPageSizes || [10, 25, 50, 100];
  for (const s of sizes) {
    const o = document.createElement('option');
    o.value = String(s);
    o.textContent = String(s);
    if (s === state.pageSize) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => {
    state.pageSize = Number(sel.value);
    state.page = 1;
    refresh();
  });
}

async function refresh() {
  const mode = state.mode;
  if (mode === 'server') {
    const { items, page, pageSize, total, totalPages } = await api.getData({
      filters: state.filters,
      sortBy: state.sortBy,
      sortDir: state.sortDir,
      page: state.page,
      pageSize: state.pageSize,
      mode
    });
    state.page = page;
    state.pageSize = pageSize;
    state.total = total;
    state.totalPages = totalPages;
    state.pageItems = items;
  } else {
    // client: fetch all once when filters/sort/page changed? We can cache with current filters? For simplicity fetch all with filters/sort at server=none
    const { items } = await api.getData({
      filters: {},
      sortBy: null,
      sortDir: 'asc',
      page: 1,
      pageSize: 1,
      mode: 'client'
    });
    state.items = items;
    applyClientSideOps(state.items);
  }
  buildTable();
  renderPagination();
}

function debounce(fn, wait) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

async function init() {
  state.schema = await api.getSchema();
  state.pageSize = state.schema.defaultPageSize || 10;
  document.getElementById('table-title').textContent = state.schema.title || 'Table';

  // Mode select
  const modeSel = document.getElementById('mode-select');
  modeSel.value = state.schema.filterMode || 'server';
  state.mode = modeSel.value;
  modeSel.addEventListener('change', () => {
    state.mode = modeSel.value;
    state.page = 1;
    state.selectedIds.clear();
    refresh();
    renderBulkActions();
  });

  buildFilters();
  populatePageSizeOptions();
  wirePagination();
  await refresh();
  renderBulkActions();
}

init().catch(err => {
  console.error(err);
  alert('Failed to initialize application. See console for details.');
});