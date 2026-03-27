export const DASHBOARD_HTML = /* html */ `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Copilot API — Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
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

    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 16px;
      margin-bottom: 28px;
    }

    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 16px;
    }

    .card .label {
      font-size: 12px;
      color: #8b949e;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .card .value { font-size: 24px; font-weight: 600; color: #f0f6fc; }

    .chart-wrap {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 28px;
    }

    .section-title {
      font-size: 14px;
      font-weight: 600;
      color: #8b949e;
      margin-bottom: 16px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .chart-wrap canvas { max-height: 220px; }

    .table-wrap {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      overflow: hidden;
    }

    .table-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 16px 12px;
      border-bottom: 1px solid #30363d;
    }

    .refresh-note { font-size: 11px; color: #484f58; }

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

    tbody tr { border-bottom: 1px solid #21262d; transition: background 0.1s; }
    tbody tr:last-child { border-bottom: none; }
    tbody tr:hover { background: #1c2128; }
    tbody td { padding: 10px 14px; color: #c9d1d9; }

    .tag {
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 11px;
      font-family: monospace;
    }
    .tag-model  { background: #1f2d3d; color: #58a6ff; }
    .tag-anth   { background: #2d1f3d; color: #bc8cff; }
    .tag-openai { background: #1f2d1f; color: #56d364; }

    .num { color: #e6edf3; font-variant-numeric: tabular-nums; }
    .muted { color: #484f58; }

    /* --- Period selector --- */
    .period-selector {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }
    .period-group {
      display: flex;
      gap: 2px;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 2px;
    }
    .period-btn {
      background: transparent;
      border: none;
      color: #8b949e;
      padding: 4px 10px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-family: inherit;
      transition: background 0.15s, color 0.15s;
    }
    .period-btn:hover  { background: #21262d; color: #e6edf3; }
    .period-btn.active { background: #21262d; color: #e6edf3; font-weight: 600; }
    .period-range-label { font-size: 12px; color: #8b949e; margin-left: 4px; }

    /* --- Summary cards (6-up grid) --- */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 16px;
      margin-bottom: 28px;
    }
    .stat-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 16px;
    }
    .stat-label {
      font-size: 12px;
      color: #8b949e;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .stat-value { font-size: 24px; font-weight: 600; color: #f0f6fc; }
    .delta { font-size: 11px; margin-top: 4px; display: block; }
    .delta.green { color: #3fb950; }
    .delta.red   { color: #f85149; }
    .delta.gray  { color: #8b949e; }
</style>
</head>
<body>
  <nav class="navbar">
    <span class="navbar-brand">Copilot API</span>
    <a href="/dashboard" class="nav-link active">Dashboard</a>
    <a href="/devices" class="nav-link">Devices</a>
    <a href="/sqlite" class="nav-link">SQLite</a>
  </nav>

  <h1>Dashboard</h1>

  <div class="period-selector">
    <div class="period-group">
      <button class="period-btn" data-period="today">Hoje</button>
      <button class="period-btn" data-period="yesterday">Ontem</button>
      <button class="period-btn active" data-period="7d">7d</button>
      <button class="period-btn" data-period="15d">15d</button>
      <button class="period-btn" data-period="30d">30d</button>
    </div>
    <div class="period-group">
      <button class="period-btn" data-period="current-month">Mês atual</button>
      <button class="period-btn" data-period="prev-month">Mês ant.</button>
      <button class="period-btn" data-period="ytd">YTD</button>
    </div>
    <span id="period-range" class="period-range-label"></span>
  </div>
  <div id="summary-cards" class="stats-grid"></div>

  <div class="chart-wrap">
    <div class="section-title">Tokens por dia (últimos 30 dias)</div>
    <canvas id="tokensChart"></canvas>
  </div>

  <div class="table-wrap">
    <div class="table-header">
      <div class="section-title" style="margin:0">Requisições recentes</div>
      <span class="refresh-note" id="refresh-note">Atualizando em 30s…</span>
    </div>
    <table>
      <thead>
        <tr>
          <th>Horário</th>
          <th>Device</th>
          <th>Modelo</th>
          <th>Entrada</th>
          <th>Saída</th>
          <th>Duração</th>
        </tr>
      </thead>
      <tbody id="requests-tbody">
        <tr><td colspan="6" style="text-align:center;color:#484f58;padding:24px;">Carregando…</td></tr>
      </tbody>
    </table>
  </div>

  <script>
    let chart = null
    let deviceMap = new Map() // device_id → name

    function esc(str) {
      const div = document.createElement('div')
      div.textContent = str
      return div.innerHTML
    }

    function fmt(n) {
      if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
      if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
      return String(n)
    }

    function fmtDate(ts) {
      return new Date(ts).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      })
    }

    function fmtDuration(ms) {
      return ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms'
    }

    function deviceLabel(device_id) {
      if (!device_id) return null
      return deviceMap.get(device_id) ?? device_id.slice(0, 8)
    }

    function createRow(r) {
      const tr = document.createElement('tr')

      const cells = [
        { text: fmtDate(r.timestamp), cls: 'num' },
        { text: deviceLabel(r.device_id), muted: !deviceMap.has(r.device_id) },
        { html: '<span class="tag tag-model">' + esc(r.model) + '</span>' },
        { text: fmt(r.input_tokens), cls: 'num' },
        { text: fmt(r.output_tokens), cls: 'num' },
        { text: fmtDuration(r.duration_ms), cls: 'num' },
      ]

      for (const cell of cells) {
        const td = document.createElement('td')
        if (cell.cls) td.className = cell.cls
        if (cell.html !== undefined) {
          td.innerHTML = cell.html
        } else if (cell.text != null) {
          td.textContent = cell.text
          if (cell.muted) td.className = (td.className + ' muted').trim()
        } else {
          td.textContent = '—'
          td.className = 'muted'
        }
        tr.appendChild(td)
      }

      return tr
    }

    let currentPeriod = '7d'

    function pctDelta(cur, prev) {
      if (prev == null || prev === 0) return null
      return ((cur - prev) / Math.abs(prev)) * 100
    }

    function deltaHtml(cur, prev) {
      const d = pctDelta(cur, prev)
      if (d === null) return '<span class="delta gray">—</span>'
      if (Math.abs(d) < 0.5) return '<span class="delta gray">— igual</span>'
      const sign = d > 0 ? '↑' : '↓'
      const cls  = d > 0 ? 'green' : 'red'
      return \`<span class="delta \${cls}">\${sign} \${Math.abs(d).toFixed(1)}%</span>\`
    }

    function formatTokens(n) {
      if (n == null) return '—'
      if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
      if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
      return String(n)
    }

    function formatCost(v) {
      return v == null ? 'N/A' : '$' + v.toFixed(2)
    }

    function formatDuration(ms) {
      if (ms == null) return '—'
      return ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms'
    }

    function updateChart(series, granularity) {
      const labels = series.map(b => {
        const d = new Date(b.ts)
        if (granularity === 'hour') {
          return d.toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        }
        if (granularity === 'week') {
          return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
        }
        // day (default)
        return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
      })
      const inputData  = series.map(b => b.inputTokens)
      const outputData = series.map(b => b.outputTokens)

      if (chart) {
        chart.data.labels = labels
        chart.data.datasets[0].data = inputData
        chart.data.datasets[1].data = outputData
        chart.update()
      } else {
        chart = new Chart(document.getElementById('tokensChart'), {
          type: 'bar',
          data: {
            labels,
            datasets: [
              { label: 'Entrada', data: inputData,  backgroundColor: '#1f6feb', borderRadius: 3, stack: 'tokens' },
              { label: 'Saída',   data: outputData, backgroundColor: '#388bfd', borderRadius: 3, stack: 'tokens' },
            ]
          },
          options: {
            responsive: true,
            plugins: {
              legend: { labels: { color: '#8b949e', boxWidth: 12 } },
              tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) + ' tokens' } }
            },
            scales: {
              x: { stacked: true, ticks: { color: '#8b949e' }, grid: { color: '#21262d' } },
              y: { stacked: true, ticks: { color: '#8b949e', callback: v => fmt(v) }, grid: { color: '#21262d' } }
            }
          }
        })
      }
    }

    async function loadStats() {
      try {
        const res  = await fetch('/dashboard/api/stats?period=' + currentPeriod)
        const data = await res.json()
        const cur  = data.current
        const prev = data.previous

        // Period range label
        const fmtDate = d => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
        document.getElementById('period-range').textContent =
          fmtDate(data.period.from) + ' – ' + fmtDate(data.period.to)

        // 6 summary cards
        const cards = [
          { label: 'Requests',       val: cur.requests.toLocaleString('pt-BR'),        delta: deltaHtml(cur.requests,      prev.requests) },
          { label: 'Input Tokens',   val: formatTokens(cur.inputTokens),               delta: deltaHtml(cur.inputTokens,   prev.inputTokens) },
          { label: 'Output Tokens',  val: formatTokens(cur.outputTokens),              delta: deltaHtml(cur.outputTokens,  prev.outputTokens) },
          { label: 'Custo Estimado', val: formatCost(cur.estimatedCost),               delta: cur.estimatedCost != null ? deltaHtml(cur.estimatedCost, prev.estimatedCost) : '' },
          { label: 'Duração Média',  val: formatDuration(cur.avgDurationMs),           delta: deltaHtml(cur.avgDurationMs, prev.avgDurationMs) },
          { label: 'Sessions',       val: cur.activeSessions.toLocaleString('pt-BR'),  delta: deltaHtml(cur.activeSessions, prev.activeSessions) },
        ]

        document.getElementById('summary-cards').innerHTML = cards.map(card => \`
          <div class="stat-card">
            <div class="stat-label">\${card.label}</div>
            <div class="stat-value">\${card.val}</div>
            \${card.delta}
          </div>
        \`).join('')

        updateChart(cur.series, data.granularity)
      } catch (e) {
        console.error('Erro ao carregar stats:', e)
      }
    }

    async function loadRequests() {
      try {
        const res = await fetch('/dashboard/api/requests')
        const data = await res.json()
        const tbody = document.getElementById('requests-tbody')

        tbody.replaceChildren()

        if (!data.requests.length) {
          const tr = document.createElement('tr')
          const td = document.createElement('td')
          td.colSpan = 6
          td.textContent = 'Nenhuma requisição registrada ainda.'
          td.style.cssText = 'text-align:center;color:#484f58;padding:24px'
          tr.appendChild(td)
          tbody.appendChild(tr)
          return
        }

        for (const r of data.requests) {
          tbody.appendChild(createRow(r))
        }
      } catch (e) {
        console.error('Erro ao carregar requests:', e)
      }
    }

    async function loadDevices() {
      try {
        const res = await fetch('/dashboard/api/devices')
        const data = await res.json()
        deviceMap = new Map(data.devices.map(d => [d.device_id, d.name]))
      } catch (e) {
        console.error('Erro ao carregar devices:', e)
      }
    }

    // Period selector
    document.querySelectorAll('.period-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        currentPeriod = btn.dataset.period
        loadStats()
      })
    })

    Promise.all([loadStats(), loadDevices().then(loadRequests)])

    let countdown = 30
    setInterval(() => {
      countdown--
      if (countdown <= 0) {
        countdown = 30
        loadStats()
        loadDevices().then(loadRequests)
      }
      document.getElementById('refresh-note').textContent = 'Atualizando em ' + countdown + 's\u2026'
    }, 1000)
  </script>
</body>
</html>`
