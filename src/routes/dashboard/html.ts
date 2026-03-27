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

    .chart-controls {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }

    .chart-control-label {
      font-size: 11px;
      color: #484f58;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-right: 2px;
    }

    .section-title {
      font-size: 14px;
      font-weight: 600;
      color: #8b949e;
      margin-bottom: 16px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .chart-wrap canvas { max-height: 260px; }

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
    .period-selector-right {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 8px;
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

    /* --- Summary cards --- */
    .stats-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 28px;
    }
    .stat-card {
      position: relative;
      overflow: hidden;
      width: 150px;
      flex-shrink: 0;
      background: #161b22;
      border: 1px solid #30363d;
      border-left: 3px solid transparent;
      border-radius: 8px;
      padding: 14px 16px;
      transition: background 0.15s, border-color 0.15s;
      text-align: right;
    }
    .stat-card:hover { background: #1c2128; }
    .stat-card[data-accent="blue"]   { border-left-color: #388bfd; }
    .stat-card[data-accent="teal"]   { border-left-color: #2dd4bf; }
    .stat-card[data-accent="green"]  { border-left-color: #3fb950; }
    .stat-card[data-accent="yellow"] { border-left-color: #d29922; }
    .stat-card[data-accent="purple"] { border-left-color: #bc8cff; }
    .stat-card[data-accent="slate"]  { border-left-color: #8b949e; }
    .stat-card[data-accent="blue"]   .stat-icon-bg { color: #388bfd; }
    .stat-card[data-accent="teal"]   .stat-icon-bg { color: #2dd4bf; }
    .stat-card[data-accent="green"]  .stat-icon-bg { color: #3fb950; }
    .stat-card[data-accent="yellow"] .stat-icon-bg { color: #d29922; }
    .stat-card[data-accent="purple"] .stat-icon-bg { color: #bc8cff; }
    .stat-card[data-accent="slate"]  .stat-icon-bg { color: #8b949e; }
    .stat-card[data-accent="blue"]   .stat-label { color: #388bfd; }
    .stat-card[data-accent="teal"]   .stat-label { color: #2dd4bf; }
    .stat-card[data-accent="green"]  .stat-label { color: #3fb950; }
    .stat-card[data-accent="yellow"] .stat-label { color: #d29922; }
    .stat-card[data-accent="purple"] .stat-label { color: #bc8cff; }
    .stat-card[data-accent="slate"]  .stat-label { color: #8b949e; }
    .stat-icon-bg {
      position: absolute;
      bottom: -8px;
      left: 6px;
      font-size: 72px;
      font-style: normal;
      line-height: 1;
      opacity: 0.22;
      pointer-events: none;
      user-select: none;
    }
    .stat-label {
      position: relative;
      font-size: 11px;
      color: #8b949e;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      font-weight: 600;
      text-align: left;
    }
    .stat-value { font-size: 22px; font-weight: 600; color: #f0f6fc; font-variant-numeric: tabular-nums; line-height: 1.1; }
    .stat-value-row { position: relative; display: flex; align-items: baseline; justify-content: flex-end; gap: 6px; margin-top: 2px; flex-wrap: wrap; }
    .delta { font-size: 11px; font-weight: 500; padding: 1px 5px; border-radius: 3px; white-space: nowrap; }
    .delta.green  { color: #3fb950; background: #3fb95018; }
    .delta.red    { color: #f85149; background: #f8514918; }
    .delta.gray   { color: #484f58; background: transparent; }

    /* --- Device rows --- */
    .device-section { margin-bottom: 28px; }
    .device-row {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 12px;
    }
    .device-row-label {
      width: 150px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      min-height: 80px;
      padding: 0 4px;
    }
    .device-name {
      font-size: 15px;
      font-weight: 700;
      color: #e6edf3;
      font-family: ui-monospace, monospace;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 142px;
    }
    .device-row .stat-card { padding: 10px 14px; }
    .device-row .stat-value { font-size: 18px; }
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
    <div class="period-selector-right">
      <span class="chart-control-label">Agrupar</span>
      <div class="period-group">
        <button class="period-btn active" data-chart-group="total">Total</button>
        <button class="period-btn" data-chart-group="device">Device</button>
      </div>
    </div>
  </div>
  <div id="summary-cards" class="stats-grid"></div>

  <div class="chart-wrap">
    <div class="chart-controls">
      <span class="chart-control-label">Tipo</span>
      <div class="period-group">
        <button class="period-btn active" data-chart-type="bar">Barras</button>
        <button class="period-btn" data-chart-type="line">Linha</button>
        <button class="period-btn" data-chart-type="area">Área</button>
      </div>
    </div>
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
    let currentChartType = 'bar'   // 'bar' | 'line' | 'area'
    let currentChartGroup = 'total' // 'total' | 'device'
    let lastStatsData = null  // cache to re-render on control change

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

    function deviceLabelForChart(device_id) {
      if (!device_id || device_id === '__unknown__') return '(sem device)'
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
      if (d === null) return ''
      if (Math.abs(d) < 0.5) return '<span class="delta gray">—</span>'
      const sign = d > 0 ? '↑' : '↓'
      const cls  = d > 0 ? 'green' : 'red'
      return \`<span class="delta \${cls}">\${sign}\${Math.abs(d).toFixed(1)}%</span>\`
    }

    const CARD_META = [
      { key: 'requests',      label: 'Requests',      icon: '↗',  accent: 'blue'   },
      { key: 'inputTokens',   label: 'Input',         icon: '⬇',  accent: 'teal'   },
      { key: 'outputTokens',  label: 'Output',        icon: '⬆',  accent: 'green'  },
      { key: 'estimatedCost', label: 'Custo Est.',    icon: '$',   accent: 'yellow' },
      { key: 'avgDurationMs', label: 'Duração',       icon: '◷',  accent: 'purple' },
      { key: 'activeSessions',label: 'Sessions',      icon: '⬡',  accent: 'slate'  },
    ]

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

    // Palette: distinct colors for input/output and per-device
    const PALETTE = [
      ['#388bfd', '#1f6feb'],  // blue pair  (output, input)
      ['#3fb950', '#2ea043'],  // green pair
      ['#d29922', '#bb8009'],  // yellow pair
      ['#f78166', '#da3633'],  // red pair
      ['#bc8cff', '#8957e5'],  // purple pair
      ['#39d353', '#26a641'],  // lime pair
      ['#58a6ff', '#1158c7'],  // light-blue pair
      ['#ffa657', '#e3702c'],  // orange pair
    ]

    function deviceLabelForChart(device_id) {
      if (!device_id || device_id === '__unknown__') return '(sem device)'
      return deviceMap.get(device_id) ?? device_id.slice(0, 8)
    }

    function fmtLabel(ts, granularity) {
      const d = new Date(ts)
      if (granularity === 'hour') return d.toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    }

    function buildDatasets(series, deviceSeries, granularity, chartType, groupBy) {
      const isArea = chartType === 'area'
      const isLine = chartType === 'line'
      const isBar  = chartType === 'bar'

      if (groupBy === 'device' && deviceSeries) {
        const deviceIds = Object.keys(deviceSeries)

        if (isArea) {
          // Stacked area por device — valores absolutos, Chart.js empilha via fill:'-1'
          return deviceIds.map((deviceId, i) => {
            const [, colorIn] = PALETTE[i % PALETTE.length]
            const totalData = deviceSeries[deviceId].map(b => b.inputTokens + b.outputTokens)
            return {
              label: deviceLabelForChart(deviceId),
              data: totalData,
              backgroundColor: colorIn + '88',
              borderColor: colorIn,
              borderWidth: 1.5,
              fill: i === 0 ? 'origin' : '-1',
              tension: 0.3,
              pointRadius: 2,
              type: 'line',
            }
          })
        }

        if (isLine) {
          // Linha separada por device — input+output juntos (total por device)
          return deviceIds.flatMap((deviceId, i) => {
            const [colorOut, colorIn] = PALETTE[i % PALETTE.length]
            const label = deviceLabelForChart(deviceId)
            const inputData  = deviceSeries[deviceId].map(b => b.inputTokens)
            const outputData = deviceSeries[deviceId].map(b => b.outputTokens)
            return [
              {
                label: label + ' (entrada)',
                data: inputData,
                borderColor: colorIn,
                backgroundColor: colorIn,
                borderWidth: 1.5,
                tension: 0.3,
                pointRadius: 2,
                fill: false,
              },
              {
                label: label + ' (saída)',
                data: outputData,
                borderColor: colorOut,
                backgroundColor: colorOut,
                borderWidth: 1.5,
                borderDash: [4, 3],
                tension: 0.3,
                pointRadius: 2,
                fill: false,
              },
            ]
          })
        }

        // Bar por device — barras lado a lado, entrada e saída separadas
        return deviceIds.flatMap((deviceId, i) => {
          const [colorOut, colorIn] = PALETTE[i % PALETTE.length]
          const label = deviceLabelForChart(deviceId)
          const inputData  = deviceSeries[deviceId].map(b => b.inputTokens)
          const outputData = deviceSeries[deviceId].map(b => b.outputTokens)
          return [
            {
              label: label + ' (entrada)',
              data: inputData,
              backgroundColor: colorIn,
              borderRadius: 2,
              stack: 'device_' + deviceId,
            },
            {
              label: label + ' (saída)',
              data: outputData,
              backgroundColor: colorOut,
              borderRadius: 2,
              stack: 'device_' + deviceId,
            },
          ]
        })
      }

      // ── groupBy === 'total' ──────────────────────────────────────────────
      const inputData  = series.map(b => b.inputTokens)
      const outputData = series.map(b => b.outputTokens)

      if (isArea) {
        return [
          {
            label: 'Entrada',
            data: inputData,
            backgroundColor: '#1f6feb55',
            borderColor: '#1f6feb',
            borderWidth: 1.5,
            fill: 'origin',
            tension: 0.3,
            pointRadius: 2,
          },
          {
            label: 'Saída',
            data: outputData,
            backgroundColor: '#3fb95055',
            borderColor: '#3fb950',
            borderWidth: 1.5,
            fill: '-1',
            tension: 0.3,
            pointRadius: 2,
          },
        ]
      }

      if (isLine) {
        return [
          {
            label: 'Entrada',
            data: inputData,
            borderColor: '#1f6feb',
            backgroundColor: '#1f6feb',
            borderWidth: 2,
            tension: 0.3,
            pointRadius: 3,
            fill: false,
          },
          {
            label: 'Saída',
            data: outputData,
            borderColor: '#3fb950',
            backgroundColor: '#3fb950',
            borderWidth: 2,
            tension: 0.3,
            pointRadius: 3,
            fill: false,
          },
        ]
      }

      // Bar total
      return [
        { label: 'Entrada', data: inputData,  backgroundColor: '#1f6feb', borderRadius: 3, stack: 'tokens' },
        { label: 'Saída',   data: outputData, backgroundColor: '#3fb950', borderRadius: 3, stack: 'tokens' },
      ]
    }

    function updateChart(series, deviceSeries, granularity) {
      const labels   = series.map(b => fmtLabel(b.ts, granularity))
      const datasets = buildDatasets(series, deviceSeries, granularity, currentChartType, currentChartGroup)

      const isBar     = currentChartType === 'bar'
      const isArea    = currentChartType === 'area'
      const isStacked = isBar || isArea

      const chartJsType = isBar ? 'bar' : 'line'

      if (chart) {
        chart.destroy()
        chart = null
      }

      chart = new Chart(document.getElementById('tokensChart'), {
        type: chartJsType,
        data: { labels, datasets },
        options: {
          responsive: true,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { labels: { color: '#8b949e', boxWidth: 12 } },
            tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) + ' tokens' } },
          },
          scales: {
            x: {
              stacked: isStacked,
              ticks: { color: '#8b949e' },
              grid: { color: '#21262d' },
            },
            y: {
              stacked: isStacked,
              ticks: { color: '#8b949e', callback: v => fmt(v) },
              grid: { color: '#21262d' },
            },
          },
        },
      })
    }

    function cardVal(key, d) {
      if (key === 'requests')       return d.requests?.toLocaleString('pt-BR') ?? '—'
      if (key === 'inputTokens')    return formatTokens(d.inputTokens)
      if (key === 'outputTokens')   return formatTokens(d.outputTokens)
      if (key === 'estimatedCost')  return formatCost(d.estimatedCost)
      if (key === 'avgDurationMs')  return formatDuration(d.avgDurationMs)
      if (key === 'activeSessions') return d.activeSessions?.toLocaleString('pt-BR') ?? '—'
      return '—'
    }

    function renderTotalCards(cur, prev) {
      const cells = CARD_META.map(m => {
        const val   = cardVal(m.key, cur)
        const delta = m.key === 'estimatedCost' && cur.estimatedCost == null
          ? ''
          : deltaHtml(cur[m.key], prev[m.key])
        return \`<div class="stat-card" data-accent="\${m.accent}">
          <i class="stat-icon-bg">\${m.icon}</i>
          <div class="stat-label">\${m.label}</div>
          <div class="stat-value-row">
            <span class="stat-value">\${val}</span>
            \${delta}
          </div>
        </div>\`
      }).join('')
      return \`<div class="stats-grid">\${cells}</div>\`
    }

    function renderDeviceCards(deviceAggregates, cur) {
      if (!deviceAggregates || deviceAggregates.length === 0) {
        return \`<div class="stats-grid">
          <div class="stat-card"><div class="stat-label">Sem dados por device</div>
          <div class="stat-value muted">—</div></div></div>\`
      }
      function makeDeviceRow(label, d) {
        const cells = CARD_META.map(m => \`
          <div class="stat-card" data-accent="\${m.accent}">
            <i class="stat-icon-bg">\${m.icon}</i>
            <div class="stat-label">\${m.label}</div>
            <div class="stat-value-row">
              <span class="stat-value">\${cardVal(m.key, d)}</span>
            </div>
          </div>\`).join('')
        return \`<div class="device-row">
          <div class="device-row-label">\${label}</div>
          \${cells}
        </div>\`
      }
      const totalRow = makeDeviceRow('', cur)
      const rows = deviceAggregates.map(d => {
        const name = deviceLabelForChart(d.deviceId)
        const lbl = \`<span class="device-name" title="\${esc(name)}">\${esc(name)}</span>\`
        return makeDeviceRow(lbl, d)
      }).join('')
      return \`<div class="device-section">\${totalRow}\${rows}</div>\`
    }

    function renderSummaryCards(cur, prev) {
      const el = document.getElementById('summary-cards')
      if (currentChartGroup === 'device') {
        el.innerHTML = renderDeviceCards(cur.deviceAggregates, cur)
      } else {
        el.innerHTML = renderTotalCards(cur, prev)
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

        lastStatsData = data
        renderSummaryCards(cur, prev)
        updateChart(cur.series, cur.deviceSeries, data.granularity)
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

    // Chart type selector
    document.querySelectorAll('[data-chart-type]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-chart-type]').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        currentChartType = btn.dataset.chartType
        if (lastStatsData) {
          updateChart(lastStatsData.current.series, lastStatsData.current.deviceSeries, lastStatsData.granularity)
        }
      })
    })

    // Chart group selector
    document.querySelectorAll('[data-chart-group]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-chart-group]').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        currentChartGroup = btn.dataset.chartGroup
        if (lastStatsData) {
          renderSummaryCards(lastStatsData.current, lastStatsData.previous)
          updateChart(lastStatsData.current.series, lastStatsData.current.deviceSeries, lastStatsData.granularity)
        }
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
