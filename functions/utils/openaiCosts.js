const UNAVAILABLE = 'OpenAI cost unavailable.'
const DAY_SECONDS = 86400

async function dailyOpenaiCostText({ apiKey, projectId, now = new Date(), fetcher = fetch, logger = console }) {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000
  const reportStart = midnight - 2 * DAY_SECONDS
  const previousStart = reportStart - DAY_SECONDS
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000
  const requestStart = Math.min(monthStart, previousStart)
  const date = time => new Date(time * 1000).toISOString().slice(0, 10)
  const periodLabel = `OpenAI month-to-date (${date(monthStart).slice(0, 7)})`
  const unavailable = `${UNAVAILABLE}\n${periodLabel}: unavailable.`
  // Never fall back to organization-wide costs when the project is missing.
  if (!apiKey || !/^proj_[A-Za-z0-9_-]+$/.test(projectId || '')) return unavailable
  try {
    const url = new URL('https://api.openai.com/v1/organization/costs')
    url.search = new URLSearchParams({
      start_time: String(requestStart), end_time: String(reportStart + DAY_SECONDS),
      bucket_width: '1d', limit: '31', 'project_ids[]': projectId,
    }).toString()
    const response = await fetcher(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(25000), redirect: 'error',
    })
    if (!response.ok) {
      logger.warn('Daily OpenAI cost unavailable', { status: response.status })
      return unavailable
    }
    const data = await response.json()
    if (data.object !== 'page' || data.has_more !== false || data.next_page ||
        !Array.isArray(data.data) || data.data.length > 31) return unavailable
    const totals = new Map()
    for (const bucket of data.data) {
      if (bucket.object !== 'bucket' || !Number.isInteger(bucket.start_time) || bucket.start_time < requestStart || bucket.start_time > reportStart || (bucket.start_time - requestStart) % DAY_SECONDS !== 0 ||
          bucket.end_time !== bucket.start_time + DAY_SECONDS || totals.has(bucket.start_time) ||
          !Array.isArray(bucket.results) || bucket.results.length > 1) return unavailable
      // Empty buckets are unavailable rather than an assumed zero bill.
      const row = bucket.results[0]
      if (!row) { totals.set(bucket.start_time, null); continue }
      if (row.object !== 'organization.costs.result' ||
          (row.project_id != null && row.project_id !== projectId) ||
          !/^[a-z]{3}$/.test(row.amount?.currency || '') ||
          typeof row.amount.value !== 'number' || !Number.isFinite(row.amount.value)) return unavailable
      totals.set(bucket.start_time, row.amount)
    }
    const current = totals.get(reportStart), previous = totals.get(previousStart)
    if (!current) return unavailable
    const amounts = [...totals.values()].filter(Boolean)
    if (new Set(amounts.map(amount => amount.currency)).size > 1) return unavailable
    const money = value => new Intl.NumberFormat('en-GB', {
      style: 'currency', currency: current.currency.toUpperCase(), currencyDisplay: 'code',
    }).format(value)
    let change = ''
    if (previous) {
      const difference = Math.round((current.value - previous.value) * 100) / 100
      change = difference === 0 ? ' · unchanged from previous day' : ` · ${difference > 0 ? 'up' : 'down'} ${money(Math.abs(difference))} from previous day`
    }
    const daily = `OpenAI cost: ${money(current.value)} on ${date(reportStart)} UTC${change} · provisional.`
    const periodDays = Math.max(0, (reportStart + DAY_SECONDS - monthStart) / DAY_SECONDS)
    const periodAmounts = [...totals].filter(([time, amount]) => time >= monthStart && amount).map(([, amount]) => amount)
    const period = periodDays > 0 && periodAmounts.length === periodDays
      ? `OpenAI month-to-date (${date(monthStart)}–${date(reportStart)} UTC): ${money(periodAmounts.reduce((sum, amount) => sum + amount.value, 0))} · provisional.`
      : `${periodLabel}: unavailable.`
    return `${daily}\n${period}`
  } catch {
    // Provider errors may contain credentials or private billing information.
    logger.warn('Daily OpenAI cost unavailable')
    return unavailable
  }
}

module.exports = { dailyOpenaiCostText }
