(function(global){
  class JsonSchemaTable {
    constructor(rootElement, options){
      if (!rootElement) throw new Error('rootElement is required');
      this.root = rootElement;
      this.options = Object.assign({
        schema: null,
        schemaUrl: 'api/schema',
        dataUrl: 'api/data',
        actionsBaseUrl: 'api/actions',
        mode: 'server',
      }, options || {});

      this.state = {
        schema: this.options.schema || null,
        filters: {},
        sortBy: null,
        sortDir: 'asc',
        page: 1,
        pageSize: 10,
        totalPages: 1,
        total: 0,
        mode: this.options.mode || 'server',
        items: [],
        pageItems: [],
        selectedIds: new Set(),
      };

      this._buildDOM();
      this._wirePagination();
    }

    async init(){
      await this._loadSchemaIfNeeded();
      this.state.pageSize = this.state.schema.defaultPageSize || 10;
      this._updateTitle(this.state.schema.title || 'Table');
      this._buildFilters();
      this._populatePageSizeOptions();
      await this.refresh();
      this._renderBulkActions();
      return this;
    }

    destroy(){
      this.root.innerHTML = '';
    }

    setMode(mode){
      this.state.mode = mode === 'client' ? 'client' : 'server';
      this.state.page = 1;
      this.state.selectedIds.clear();
      this.refresh();
      this._renderBulkActions();
    }

    setSchema(schema){
      this.state.schema = schema;
      this.state.page = 1;
      this._updateTitle(schema.title || 'Table');
      this._buildFilters();
      this._populatePageSizeOptions();
      this.refresh();
    }

    async _loadSchemaIfNeeded(){
      if (this.state.schema) return;
      const res = await fetch(this.options.schemaUrl);
      this.state.schema = await res.json();
    }

    async refresh(){
      const mode = this.state.mode;
      if (mode === 'server') {
        const { items, page, pageSize, total, totalPages } = await this._getData({
          filters: this.state.filters,
          sortBy: this.state.sortBy,
          sortDir: this.state.sortDir,
          page: this.state.page,
          pageSize: this.state.pageSize,
          mode
        });
        this.state.page = page;
        this.state.pageSize = pageSize;
        this.state.total = total;
        this.state.totalPages = totalPages;
        this.state.pageItems = items;
      } else {
        // client: fetch all, then filter/sort/paginate locally
        const { items } = await this._getData({
          filters: {}, sortBy: null, sortDir: 'asc', page: 1, pageSize: 1, mode: 'client'
        });
        this.state.items = items;
        this._applyClientSideOps(this.state.items);
      }
      this._buildTable();
      this._renderPagination();
    }

    async _getData({ filters, sortBy, sortDir, page, pageSize, mode }){
      const params = new URLSearchParams();
      if (filters && Object.keys(filters).length > 0) params.set('filters', JSON.stringify(filters));
      if (sortBy) params.set('sortBy', sortBy);
      if (sortDir) params.set('sortDir', sortDir);
      if (mode === 'client') params.set('all', 'true');
      else {
        params.set('page', String(page));
        params.set('pageSize', String(pageSize));
      }
      const res = await fetch(`${this.options.dataUrl}?${params.toString()}`);
      return res.json();
    }

    async _action(action, ids){
      const res = await fetch(`${this.options.actionsBaseUrl}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });
      return res.json();
    }

    _buildDOM(){
      this.root.innerHTML = '';
      const container = document.createElement('div');
      container.className = 'json-schema-table container-fluid p-0';

      const header = document.createElement('div');
      header.className = 'd-flex align-items-center justify-content-between mb-3';
      this.titleEl = document.createElement('h2');
      this.titleEl.className = 'h4 m-0';
      this.titleEl.textContent = 'Table';
      header.appendChild(this.titleEl);
      container.appendChild(header);

      this.filtersContainer = document.createElement('div');
      this.filtersContainer.className = 'card card-body mb-3';
      container.appendChild(this.filtersContainer);

      const card = document.createElement('div');
      card.className = 'card';
      const tableWrap = document.createElement('div');
      tableWrap.className = 'table-responsive';
      this.tableEl = document.createElement('table');
      this.tableEl.className = 'table table-sm table-hover align-middle mb-0';
      this.theadEl = document.createElement('thead');
      this.theadEl.className = 'table-light';
      this.tbodyEl = document.createElement('tbody');
      this.tableEl.append(this.theadEl, this.tbodyEl);
      tableWrap.appendChild(this.tableEl);

      const footer = document.createElement('div');
      footer.className = 'card-footer d-flex flex-wrap align-items-center justify-content-between gap-2';
      const left = document.createElement('div');
      left.className = 'd-flex align-items-center gap-2';
      this.prevBtn = document.createElement('button');
      this.prevBtn.className = 'btn btn-outline-secondary btn-sm';
      this.prevBtn.textContent = 'Prev';
      this.pageInfoEl = document.createElement('span');
      this.pageInfoEl.textContent = 'Page 1 of 1';
      this.nextBtn = document.createElement('button');
      this.nextBtn.className = 'btn btn-outline-secondary btn-sm';
      this.nextBtn.textContent = 'Next';
      left.append(this.prevBtn, this.pageInfoEl, this.nextBtn);

      const right = document.createElement('div');
      right.className = 'd-flex align-items-center gap-2';
      const label = document.createElement('label');
      label.className = 'form-label m-0';
      label.textContent = 'Rows per page';
      this.pageSizeSel = document.createElement('select');
      this.pageSizeSel.className = 'form-select form-select-sm';
      this.pageSizeSel.style.width = '100px';
      right.append(label, this.pageSizeSel);

      footer.append(left, right);

      card.append(tableWrap, footer);
      container.appendChild(card);

      this.bulkActionsEl = document.createElement('div');
      this.bulkActionsEl.className = 'sticky-actions card card-body mt-3 d-flex flex-wrap gap-2';
      container.appendChild(this.bulkActionsEl);

      this.root.appendChild(container);
    }

    _updateTitle(text){
      this.titleEl.textContent = text;
    }

    _buildFilters(){
      const schema = this.state.schema;
      const container = this.filtersContainer;
      container.innerHTML = '';
      const row = document.createElement('div');
      row.className = 'filter-row';

      for (const col of schema.columns) {
        if (!col.filter) continue;
        row.appendChild(this._buildFilterControl(col));
      }

      const clearBtn = document.createElement('button');
      clearBtn.className = 'btn btn-sm btn-outline-secondary';
      clearBtn.textContent = 'Clear Filters';
      clearBtn.addEventListener('click', () => {
        this.state.filters = {};
        this.refresh();
        this._buildFilters();
      });
      const actions = document.createElement('div');
      actions.className = 'd-flex gap-2 align-items-end';
      actions.appendChild(clearBtn);

      const outer = document.createElement('div');
      outer.className = 'd-grid gap-2';
      outer.append(row, actions);
      container.appendChild(outer);
    }

    _buildFilterControl(column){
      const wrapper = document.createElement('div');
      wrapper.className = 'filter-item';
      const id = `filter-${column.field}-${Math.random().toString(36).slice(2)}`;
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
        control.addEventListener('input', this._debounce(() => {
          const val = control.value.trim();
          this._setFilter(column.field, { type: 'text', value: val });
        }, 250));
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
        const onChange = this._debounce(() => {
          const min = minI.value !== '' ? Number(minI.value) : undefined;
          const max = maxI.value !== '' ? Number(maxI.value) : undefined;
          this._setFilter(column.field, { type: 'numberRange', min, max });
        }, 250);
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
        const onChange = this._debounce(() => {
          const from = fromI.value || undefined;
          const to = toI.value || undefined;
          this._setFilter(column.field, { type: 'dateRange', from, to });
        }, 250);
        fromI.addEventListener('input', onChange);
        toI.addEventListener('input', onChange);
        control.append(fromI, toI);
      } else if (fType === 'select') {
        const multiple = column.filter?.multiple;
        const select = document.createElement('select');
        select.className = 'form-select form-select-sm';
        if (multiple) select.multiple = true;
        if (!multiple) {
          const allOpt = document.createElement('option');
          allOpt.value = '';
          allOpt.textContent = 'Any';
          select.appendChild(allOpt);
        }
        for (const opt of column.options || []) {
          const o = document.createElement('option'); o.value = opt; o.textContent = opt; select.appendChild(o);
        }
        select.addEventListener('change', () => {
          if (multiple) {
            const values = Array.from(select.selectedOptions).map(o => o.value);
            this._setFilter(column.field, { type: 'select', values });
          } else {
            const value = select.value || undefined;
            this._setFilter(column.field, { type: 'select', value });
          }
        });
        control = select;
      } else if (fType === 'boolean') {
        const select = document.createElement('select');
        select.className = 'form-select form-select-sm';
        select.innerHTML = '<option value="">Any</option><option value="true">True</option><option value="false">False</option>';
        select.addEventListener('change', () => {
          const v = select.value;
          this._setFilter(column.field, { type: 'boolean', value: v === '' ? undefined : v === 'true' });
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

    _setFilter(field, def){
      if (def == null) delete this.state.filters[field];
      else this.state.filters[field] = def;
      this.state.page = 1;
      this.refresh();
    }

    _buildTable(){
      const head = this.theadEl;
      const body = this.tbodyEl;
      head.innerHTML = '';
      body.innerHTML = '';

      const headerRow = document.createElement('tr');
      // Select all
      const selectTh = document.createElement('th');
      selectTh.className = 'select-all-cell';
      const selectAll = document.createElement('input');
      selectAll.type = 'checkbox';
      selectAll.addEventListener('change', () => {
        const idsOnPage = this.state.pageItems.map(r => r.id);
        if (selectAll.checked) idsOnPage.forEach(id => this.state.selectedIds.add(id));
        else idsOnPage.forEach(id => this.state.selectedIds.delete(id));
        this._renderBody();
        this._renderBulkActions();
      });
      selectTh.appendChild(selectAll);
      headerRow.appendChild(selectTh);

      for (const col of this.state.schema.columns) {
        const th = document.createElement('th');
        th.textContent = col.label;
        if (col.sortable) {
          th.classList.add('sortable');
          const sortInd = document.createElement('span');
          sortInd.className = 'sort-ind';
          if (this.state.sortBy === col.field) sortInd.textContent = this.state.sortDir === 'asc' ? '▲' : '▼';
          th.appendChild(sortInd);
          th.addEventListener('click', () => {
            if (this.state.sortBy === col.field) this.state.sortDir = this.state.sortDir === 'asc' ? 'desc' : 'asc';
            else { this.state.sortBy = col.field; this.state.sortDir = 'asc'; }
            this.state.page = 1;
            this.refresh();
          });
        }
        headerRow.appendChild(th);
      }

      if (Array.isArray(this.state.schema.rowActions) && this.state.schema.rowActions.length > 0) {
        const th = document.createElement('th');
        th.textContent = 'Actions';
        headerRow.appendChild(th);
      }

      head.appendChild(headerRow);
      this._renderBody();
    }

    _renderBody(){
      const body = this.tbodyEl;
      body.innerHTML = '';
      for (const row of this.state.pageItems) {
        const tr = document.createElement('tr');
        const selectTd = document.createElement('td');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = this.state.selectedIds.has(row.id);
        cb.addEventListener('change', () => {
          if (cb.checked) this.state.selectedIds.add(row.id); else this.state.selectedIds.delete(row.id);
          this._renderBulkActions();
        });
        selectTd.appendChild(cb);
        tr.appendChild(selectTd);

        for (const col of this.state.schema.columns) {
          const td = document.createElement('td');
          td.textContent = this._formatValue(row[col.field], col);
          tr.appendChild(td);
        }

        if (Array.isArray(this.state.schema.rowActions) && this.state.schema.rowActions.length > 0) {
          const td = document.createElement('td');
          td.className = 'actions-cell';
          for (const action of this.state.schema.rowActions) {
            const btn = document.createElement('button');
            btn.className = 'btn btn-sm btn-outline-primary me-1';
            btn.textContent = action.label;
            btn.addEventListener('click', async () => {
              if (action.confirm && !confirm(`Are you sure to ${action.name} #${row.id}?`)) return;
              const result = await this._action(action.name, [row.id]);
              if (action.name === 'delete' || action.name === 'deactivate') await this.refresh();
              if (action.name === 'view') alert(JSON.stringify(result.items?.[0] ?? row, null, 2));
            });
            td.appendChild(btn);
          }
          tr.appendChild(td);
        }

        body.appendChild(tr);
      }
    }

    _renderPagination(){
      this.pageInfoEl.textContent = `Page ${this.state.page} of ${this.state.totalPages} — ${this.state.total} rows`;
      this.prevBtn.disabled = this.state.page <= 1;
      this.nextBtn.disabled = this.state.page >= this.state.totalPages;
    }

    _wirePagination(){
      this.prevBtn?.addEventListener('click', () => {
        if (this.state.page > 1) { this.state.page--; this.refresh(); }
      });
      this.nextBtn?.addEventListener('click', () => {
        if (this.state.page < this.state.totalPages) { this.state.page++; this.refresh(); }
      });
    }

    _renderBulkActions(){
      const container = this.bulkActionsEl;
      container.innerHTML = '';
      const selected = Array.from(this.state.selectedIds);
      const info = document.createElement('div');
      info.className = 'text-muted';
      info.textContent = `${selected.length} selected`;
      container.appendChild(info);

      for (const action of this.state.schema.bulkActions || []) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm btn-primary';
        btn.textContent = action.label;
        btn.disabled = selected.length === 0;
        btn.addEventListener('click', async () => {
          if (action.name === 'export') { this._exportCSV(selected); return; }
          if (action.confirm && !confirm(`Apply ${action.name} to ${selected.length} rows?`)) return;
          await this._action(action.name, selected);
          await this.refresh();
          this.state.selectedIds.clear();
          this._renderBulkActions();
        });
        container.appendChild(btn);
      }
    }

    _populatePageSizeOptions(){
      const sel = this.pageSizeSel;
      sel.innerHTML = '';
      const sizes = this.state.schema.allowedPageSizes || [10, 25, 50, 100];
      for (const s of sizes) {
        const o = document.createElement('option');
        o.value = String(s); o.textContent = String(s);
        if (s === this.state.pageSize) o.selected = true;
        sel.appendChild(o);
      }
      sel.onchange = () => {
        this.state.pageSize = Number(sel.value);
        this.state.page = 1;
        this.refresh();
      };
    }

    _applyClientSideOps(allItems){
      let rows = allItems;
      rows = this._clientApplyFilters(rows);
      rows = this._clientApplySort(rows);
      this.state.total = rows.length;
      this.state.totalPages = Math.max(1, Math.ceil(rows.length / this.state.pageSize));
      if (this.state.page > this.state.totalPages) this.state.page = this.state.totalPages;
      const start = (this.state.page - 1) * this.state.pageSize;
      this.state.pageItems = rows.slice(start, start + this.state.pageSize);
    }

    _clientApplyFilters(rows){
      if (!this.state.filters || Object.keys(this.state.filters).length === 0) return rows;
      const colMap = new Map(this.state.schema.columns.map(c => [c.field, c]));
      return rows.filter(row => {
        for (const [field, filterDef] of Object.entries(this.state.filters)) {
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

    _clientApplySort(rows){
      if (!this.state.sortBy) return rows;
      const col = this.state.schema.columns.find(c => c.field === this.state.sortBy);
      if (!col) return rows;
      const dir = this.state.sortDir === 'desc' ? -1 : 1;
      return [...rows].sort((a, b) => {
        const va = a[this.state.sortBy];
        const vb = b[this.state.sortBy];
        if (va == null && vb == null) return 0;
        if (va == null) return -1 * dir;
        if (vb == null) return 1 * dir;
        if (col.type === 'number') return (Number(va) - Number(vb)) * dir;
        if (col.type === 'date') return (new Date(va) - new Date(vb)) * dir;
        if (col.type === 'boolean') return ((va === vb) ? 0 : va ? 1 : -1) * dir;
        return String(va).localeCompare(String(vb)) * dir;
      });
    }

    _formatValue(value, column){
      if (value == null) return '';
      if (column.type === 'date') {
        try { return new Date(value).toLocaleDateString(); } catch { return String(value); }
      }
      if (column.type === 'boolean') return value ? 'Yes' : 'No';
      return String(value);
    }

    _exportCSV(selectedIds){
      const rows = this.state.mode === 'server' ? this.state.pageItems : this.state.items;
      const rowsToExport = (selectedIds && selectedIds.length > 0) ? rows.filter(r => selectedIds.includes(r.id)) : rows;
      const headers = this.state.schema.columns.map(c => c.label);
      const fields = this.state.schema.columns.map(c => c.field);
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
      a.href = url; a.download = 'export.csv'; a.click(); URL.revokeObjectURL(url);
    }

    _debounce(fn, wait){
      let t = null; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
    }
  }

  global.JsonSchemaTable = JsonSchemaTable;
})(window);