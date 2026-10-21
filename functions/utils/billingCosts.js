const PROJECT_ID = 'perrinn-d5fc1'
const MAX_BYTES_BILLED = String(100 * 1024 * 1024)
const UNAVAILABLE = 'Cloud cost unavailable.'

async function queryBilling(request) {
  const { google } = require('googleapis')
  const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/bigquery'] })
  const client = await auth.getClient()
  // Use the REST request directly: the existing googleapis version predates
  // maximumBytesBilled on jobs.query. Do not retry an ambiguous submission.
  return client.request({
    url: `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries`,
    method: 'POST', data: request, timeout: 25000, retry: false,
  })
}

async function dailyCloudCostText({ table, location, now = new Date(), query = queryBilling, logger = console }) {
  if (!table || !location) return UNAVAILABLE
  // Only identifiers are interpolated. All values use typed query parameters.
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]\.[A-Za-z0-9_]+\.gcp_billing_export_v1_[A-Za-z0-9_]+$/.test(table)) return UNAVAILABLE
  try {
    const day = offset => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset)).toISOString().slice(0, 10)
    const reportDate = day(2), previousDate = day(3), endDate = day(1)
    const parameter = (name, type, value) => ({ name, parameterType: { type }, parameterValue: { value } })
    const response = await query({
      location, useLegacySql: false, maximumBytesBilled: MAX_BYTES_BILLED,
      timeoutMs: 15000, jobTimeoutMs: '20000', maxResults: 3,
      parameterMode: 'NAMED',
      queryParameters: [parameter('project', 'STRING', PROJECT_ID), parameter('start', 'DATE', previousDate), parameter('end', 'DATE', endDate)],
      query: `SELECT CAST(DATE(usage_start_time, 'UTC') AS STRING) AS day, currency,
        CAST(SUM(CAST(cost AS NUMERIC) + IFNULL((SELECT SUM(CAST(credit.amount AS NUMERIC)) FROM UNNEST(credits) AS credit), 0)) AS STRING) AS net_cost
        FROM \`${table}\`
        WHERE project.id = @project
          AND usage_start_time >= TIMESTAMP(@start, 'UTC')
          AND usage_start_time < TIMESTAMP(@end, 'UTC')
        GROUP BY day, currency
        ORDER BY day, currency
        LIMIT 3`,
    })
    const data = response.data || {}
    if (data.jobComplete !== true || data.errors?.length || data.pageToken) return UNAVAILABLE
    const rows = (data.rows || []).map(row => {
      const [date, currency, amount] = (row.f || []).map(field => field.v)
      return { date, currency, amount: amount == null || amount === '' ? NaN : Number(amount) }
    })
    if (rows.length > 2 || rows.some(row => ![previousDate, reportDate].includes(row.date) || !/^[A-Z]{3}$/.test(row.currency) || !Number.isFinite(row.amount))) return UNAVAILABLE
    const current = rows.find(row => row.date === reportDate)
    if (!current || rows.filter(row => row.date === reportDate).length !== 1) return UNAVAILABLE
    const previous = rows.find(row => row.date === previousDate)
    if (previous && previous.currency !== current.currency) return UNAVAILABLE
    const money = value => new Intl.NumberFormat('en-GB', { style: 'currency', currency: current.currency }).format(value)
    let change = ''
    if (previous) {
      const difference = Math.round((current.amount - previous.amount) * 100) / 100
      change = difference === 0 ? ' · unchanged from previous day' : ` · ${difference > 0 ? 'up' : 'down'} ${money(Math.abs(difference))} from previous day`
    }
    return `Cloud cost: ${money(current.amount)} on ${reportDate} UTC${change} · provisional, after credits.`
  } catch (error) {
    // API errors can contain billing rows or request details; log only a status.
    logger.warn('Daily cloud cost unavailable', { status: String(error.code || error.response?.status || 'unknown').slice(0, 32) })
    return UNAVAILABLE
  }
}

module.exports = { dailyCloudCostText }
