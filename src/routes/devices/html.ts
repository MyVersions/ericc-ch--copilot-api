export const DEVICES_HTML = /* html */ `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Copilot API — Devices</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0d1117;
      color: #e6edf3;
      min-height: 100vh;
      padding: 24px;
    }

    .header {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 24px;
    }

    h1 { font-size: 20px; font-weight: 600; color: #f0f6fc; }
    h1 span { color: #58a6ff; }

    .back-link {
      font-size: 13px;
      color: #8b949e;
      text-decoration: none;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 3px 10px;
      transition: color 0.15s;
    }
    .back-link:hover { color: #e6edf3; }

    .panel {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      overflow: hidden;
      max-width: 860px;
    }

    .panel-header {
      padding: 14px 16px;
      border-bottom: 1px solid #30363d;
      font-size: 12px;
      font-weight: 600;
      color: #8b949e;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    table { width: 100%; border-collapse: collapse; font-size: 13px; }

    thead th {
      padding: 10px 14px;
      text-align: left;
      background: #0d1117;
      color: #8b949e;
      font-weight: 500;
      font-size: 12px;
      border-bottom: 1px solid #30363d;
    }

    tbody tr { border-bottom: 1px solid #21262d; transition: background 0.1s, outline 0.15s; }
    tbody tr:last-child { border-bottom: none; }
    tbody tr:hover { background: #1c2128; }

    tbody td { padding: 8px 14px; color: #c9d1d9; vertical-align: middle; }

    .col-id {
      font-family: "SFMono-Regular", Consolas, monospace;
      font-size: 12px;
      color: #8b949e;
      max-width: 220px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .col-name { width: 100%; }

    .col-action { white-space: nowrap; text-align: right; }

    .name-input {
      width: 100%;
      background: transparent;
      color: #e6edf3;
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 5px 8px;
      font-size: 13px;
      outline: none;
      transition: border-color 0.15s, background 0.15s;
    }
    .name-input:hover { border-color: #30363d; background: #0d1117; }
    .name-input:focus { border-color: #58a6ff; background: #0d1117; }
    .name-input::placeholder { color: #484f58; }

    .btn-save {
      background: #21262d;
      color: #8b949e;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 4px 12px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .btn-save:hover { background: #238636; color: #fff; border-color: #238636; }

    .row-saved { outline: 1px solid #2ea04366; outline-offset: -1px; }

    .badge-saved {
      display: inline-block;
      font-size: 11px;
      color: #3fb950;
      margin-left: 8px;
      opacity: 0;
      transition: opacity 0.2s;
    }
    .badge-saved.visible { opacity: 1; }

    .empty-state {
      text-align: center;
      color: #484f58;
      padding: 32px;
      font-size: 13px;
    }

    .loading { color: #484f58; padding: 24px 14px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="header">
    <a href="/dashboard" class="back-link">← Dashboard</a>
    <h1>Copilot API <span>/ Devices</span></h1>
  </div>

  <div class="panel">
    <div class="panel-header">Devices conhecidos</div>
    <table>
      <thead>
        <tr>
          <th>Device ID</th>
          <th>Nome</th>
          <th></th>
        </tr>
      </thead>
      <tbody id="tbody">
        <tr><td class="loading" colspan="3">Carregando…</td></tr>
      </tbody>
    </table>
  </div>

  <script>
    function esc(str) {
      const d = document.createElement('div')
      d.textContent = str
      return d.innerHTML
    }

    async function load() {
      const res = await fetch('/dashboard/api/known-devices')
      const data = await res.json()
      const tbody = document.getElementById('tbody')
      tbody.replaceChildren()

      if (!data.devices.length) {
        const tr = document.createElement('tr')
        tr.innerHTML = '<td colspan="3" class="empty-state">Nenhum device encontrado nos logs ainda.</td>'
        tbody.appendChild(tr)
        return
      }

      for (const d of data.devices) {
        const tr = document.createElement('tr')
        tr.dataset.deviceId = d.device_id
        tr.innerHTML =
          '<td class="col-id" title="' + esc(d.device_id) + '">' + esc(d.device_id) + '</td>' +
          '<td class="col-name">' +
            '<input class="name-input" type="text" value="' + esc(d.name ?? '') + '" placeholder="Informe um nome…" />' +
            '<span class="badge-saved">✓ Salvo</span>' +
          '</td>' +
          '<td class="col-action"><button class="btn-save" onclick="save(this)">Salvar</button></td>'
        tbody.appendChild(tr)
      }
    }

    async function save(btn) {
      const tr = btn.closest('tr')
      const device_id = tr.dataset.deviceId
      const input = tr.querySelector('.name-input')
      const name = input.value.trim()
      if (!name) { input.focus(); return }

      btn.disabled = true
      const res = await fetch('/dashboard/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id, name }),
      })
      btn.disabled = false

      if (res.ok) {
        tr.classList.add('row-saved')
        const badge = tr.querySelector('.badge-saved')
        badge.classList.add('visible')
        setTimeout(() => {
          tr.classList.remove('row-saved')
          badge.classList.remove('visible')
        }, 2000)
      }
    }

    // Save on Enter key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.classList.contains('name-input')) {
        const btn = e.target.closest('tr').querySelector('.btn-save')
        btn.click()
      }
    })

    load()
  </script>
</body>
</html>`
