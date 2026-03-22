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
  </style>
</head>
<body>
  <h1>Copilot API <span>/ Dashboard</span></h1>

  <div class="cards">
    <div class="card"><div class="label">Total de requests</div><div class="value" id="total-requests">—</div></div>
    <div class="card"><div class="label">Tokens de entrada</div><div class="value" id="total-input">—</div></div>
    <div class="card"><div class="label">Tokens de saída</div><div class="value" id="total-output">—</div></div>
    <div class="card"><div class="label">Período</div><div class="value">30d</div></div>
  </div>

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
          <th>Chamador</th>
          <th>Rota</th>
          <th>Modelo</th>
          <th>Entrada</th>
          <th>Saída</th>
          <th>Duração</th>
        </tr>
      </thead>
      <tbody id="requests-tbody">
        <tr><td colspan="7" style="text-align:center;color:#484f58;padding:24px;">Carregando…</td></tr>
      </tbody>
    </table>
  </div>

  <script>
    let chart = null

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

    function createRow(r) {
      const tr = document.createElement('tr')

      const cells = [
        { text: fmtDate(r.timestamp), cls: 'num' },
        { text: r.caller || r.client_ip || null, muted: true },
        { html: r.route === '/v1/messages'
            ? '<span class="tag tag-anth">anthropic</span>'
            : '<span class="tag tag-openai">openai</span>' },
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
        } else {
          td.textContent = '—'
          td.className = 'muted'
        }
        tr.appendChild(td)
      }

      return tr
    }

    async function loadStats() {
      try {
        const res = await fetch('/dashboard/api/stats')
        const data = await res.json()

        document.getElementById('total-requests').textContent = fmt(data.totals.request_count)
        document.getElementById('total-input').textContent = fmt(data.totals.input_tokens)
        document.getElementById('total-output').textContent = fmt(data.totals.output_tokens)

        const labels = data.days.map(d => d.day.slice(5))
        const inputData = data.days.map(d => d.input_tokens)
        const outputData = data.days.map(d => d.output_tokens)

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
                { label: 'Entrada', data: inputData, backgroundColor: '#1f6feb', borderRadius: 3, stack: 'tokens' },
                { label: 'Saída',   data: outputData, backgroundColor: '#388bfd', borderRadius: 3, stack: 'tokens' }
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
          td.colSpan = 7
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

    Promise.all([loadStats(), loadRequests()])

    let countdown = 30
    setInterval(() => {
      countdown--
      if (countdown <= 0) {
        countdown = 30
        loadRequests()
      }
      document.getElementById('refresh-note').textContent = 'Atualizando em ' + countdown + 's\u2026'
    }, 1000)
  </script>
</body>
</html>`
