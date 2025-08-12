(async function(){
  const container = document.getElementById('demo1');

  // Build a simple header with a mode toggle
  const top = document.createElement('div');
  top.className = 'd-flex align-items-center justify-content-between mb-3';
  const title = document.createElement('h1');
  title.className = 'h3 m-0';
  title.textContent = 'JSON Schema Table Demo';
  const controls = document.createElement('div');
  controls.className = 'd-flex gap-2 align-items-center';
  const label = document.createElement('label');
  label.className = 'form-label m-0 me-2';
  label.textContent = 'Mode';
  const select = document.createElement('select');
  select.className = 'form-select form-select-sm';
  select.style.width = '150px';
  select.innerHTML = '<option value="server">Server</option><option value="client">Client</option>';
  controls.append(label, select);
  top.append(title, controls);
  container.appendChild(top);

  // Create the table instance
  const tableRoot = document.createElement('div');
  container.appendChild(tableRoot);

  const table = new JsonSchemaTable(tableRoot, {
    schemaUrl: '/api/schema',
    dataUrl: '/api/data',
    actionsBaseUrl: '/api/actions',
    mode: 'server'
  });
  await table.init();

  select.addEventListener('change', () => {
    table.setMode(select.value);
  });
})();