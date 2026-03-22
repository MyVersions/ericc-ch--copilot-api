export const SQLITE_HTML = /* html */ `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Copilot API — SQLite</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0d1117;
      color: #e6edf3;
      min-height: 100vh;
      padding: 24px;
    }

    .navbar {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid #30363d;
    }

    .navbar-brand {
      font-size: 15px;
      font-weight: 600;
      color: #f0f6fc;
      margin-right: 12px;
    }

    .nav-link {
      font-size: 13px;
      font-weight: 500;
      color: #8b949e;
      text-decoration: none;
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 4px 12px;
      transition: color 0.15s, background 0.15s, border-color 0.15s;
    }
    .nav-link:hover { color: #e6edf3; }
    .nav-link.active {
      color: #58a6ff;
      background: #1f2d3d;
      border-color: #1f4e8c44;
    }

    h1 { font-size: 20px; font-weight: 600; margin-bottom: 24px; color: #f0f6fc; }
    h1 span { color: #58a6ff; }

    .editor {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }

    textarea {
      width: 100%;
      min-height: 140px;
      background: #0d1117;
      color: #e6edf3;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 12px;
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
      font-size: 13px;
      line-height: 1.6;
      resize: vertical;
      outline: none;
      transition: border-color 0.15s;
    }
    textarea:focus { border-color: #58a6ff; }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 12px;
    }

    button {
      background: #238636;
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 8px 20px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    }
    button:hover { background: #2ea043; }
    button:disabled { background: #21262d; color: #8b949e; cursor: not-allowed; }

    .hint {
      font-size: 12px;
      color: #8b949e;
    }

    .result {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 16px;
      min-height: 60px;
    }

    .result-empty { color: #8b949e; font-size: 13px; }

    .result-success {
      color: #3fb950;
      font-size: 13px;
      font-family: "SFMono-Regular", Consolas, monospace;
    }

    .result-error {
      color: #f85149;
      font-size: 13px;
      font-family: "SFMono-Regular", Consolas, monospace;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .table-wrap {
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      font-family: "SFMono-Regular", Consolas, monospace;
    }

    thead th {
      background: #21262d;
      color: #8b949e;
      text-align: left;
      padding: 8px 12px;
      border-bottom: 1px solid #30363d;
      white-space: nowrap;
      font-weight: 600;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.04em;
    }

    tbody tr:hover { background: #1c2128; }

    tbody td {
      padding: 7px 12px;
      border-bottom: 1px solid #21262d;
      color: #e6edf3;
      max-width: 360px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .row-count {
      margin-top: 10px;
      font-size: 12px;
      color: #8b949e;
    }

    .spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid #30363d;
      border-top-color: #58a6ff;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      vertical-align: middle;
      margin-right: 6px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <nav class="navbar">
    <span class="navbar-brand">Copilot API</span>
    <a href="/dashboard" class="nav-link">Dashboard</a>
    <a href="/devices" class="nav-link">Devices</a>
    <a href="/sqlite" class="nav-link active">SQLite</a>
  </nav>

  <h1>SQLite</h1>

  <div class="editor">
    <textarea id="sql" placeholder="SELECT * FROM request_logs LIMIT 10" spellcheck="false"></textarea>
    <div class="toolbar">
      <button id="run-btn" onclick="runQuery()">Executar</button>
      <span class="hint">Ctrl+Enter para executar</span>
    </div>
  </div>

  <div class="result" id="result">
    <span class="result-empty">Os resultados aparecerão aqui.</span>
  </div>

  <script>
    const sqlEl = document.getElementById('sql')
    const resultEl = document.getElementById('result')
    const runBtn = document.getElementById('run-btn')

    sqlEl.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') runQuery()
    })

    async function runQuery() {
      const sql = sqlEl.value.trim()
      if (!sql) return

      runBtn.disabled = true
      resultEl.innerHTML = '<span class="spinner"></span><span style="color:#8b949e;font-size:13px">Executando...</span>'

      try {
        const res = await fetch('/sqlite/api/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql }),
        })
        const data = await res.json()

        if (data.error) {
          resultEl.innerHTML = '<div class="result-error">Erro: ' + escHtml(data.error) + '</div>'
        } else if (data.rows !== undefined) {
          renderTable(data.rows)
        } else {
          resultEl.innerHTML = '<div class="result-success">OK — ' + data.changes + ' linha(s) afetada(s).</div>'
        }
      } catch (err) {
        resultEl.innerHTML = '<div class="result-error">Falha na requisição: ' + escHtml(String(err)) + '</div>'
      } finally {
        runBtn.disabled = false
      }
    }

    function renderTable(rows) {
      if (!rows.length) {
        resultEl.innerHTML = '<span class="result-empty">Nenhum resultado.</span>'
        return
      }
      const cols = Object.keys(rows[0])
      let html = '<div class="table-wrap"><table><thead><tr>'
      for (const col of cols) html += '<th>' + escHtml(col) + '</th>'
      html += '</tr></thead><tbody>'
      for (const row of rows) {
        html += '<tr>'
        for (const col of cols) {
          const val = row[col]
          html += '<td title="' + escHtml(String(val ?? '')) + '">' + escHtml(val === null ? 'NULL' : String(val)) + '</td>'
        }
        html += '</tr>'
      }
      html += '</tbody></table></div>'
      html += '<div class="row-count">' + rows.length + ' linha(s)</div>'
      resultEl.innerHTML = html
    }

    function escHtml(str) {
      return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    }
  </script>
</body>
</html>`
