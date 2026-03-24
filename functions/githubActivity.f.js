const { onSchedule } = require('firebase-functions/v2/scheduler')
const admin = require('firebase-admin')
const { defineSecret } = require('firebase-functions/params')
const createMessageUtils = require('./utils/createMessage')

try { admin.initializeApp() } catch (e) {}

const GITHUB_TOKEN = defineSecret('GITHUB_TOKEN')
const GITHUB_ORG = defineSecret('GITHUB_ORG')

const ADMIN_USER_ID = 'FHk0zgOQUja7rsB9jxDISXzHaro2'
const GITHUB_ACTIVITY_CHAIN = 'github-activity'
const STATE_DOC_PATH = 'Integrations/githubActivityState'

function trimSha(sha) {
  if (!sha || typeof sha !== 'string') return ''
  return sha.slice(0, 7)
}

function commitTitleFromMessage(message) {
  return String(message || '').split('\n')[0].trim()
}

function extractCommitTitles(commits) {
  if (!Array.isArray(commits) || commits.length === 0) return ''
  const titles = commits
    .map(commit => {
      const message = (commit || {}).message || ''
      return commitTitleFromMessage(message)
    })
    .filter(Boolean)
    .slice(0, 3)

  if (titles.length === 0) return ''
  return titles.join(' | ')
}

async function githubApiFetchJson(url, token, errorPrefix) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })

  if (!response.ok) {
    const bodyText = await response.text()
    throw new Error(`${errorPrefix} ${response.status}: ${bodyText}`)
  }

  return response.json()
}

async function resolvePushCommitDetails(event, token) {
  const payload = event.payload || {}
  const repoName = (event.repo || {}).name || ''
  const before = payload.before || ''
  const head = payload.head || ''

  let commitCount = Number.isFinite(Number(payload.size)) ? Number(payload.size) : 0
  if (!commitCount) {
    commitCount = Number.isFinite(Number(payload.distinct_size)) ? Number(payload.distinct_size) : 0
  }

  let commitTitles = extractCommitTitles(payload.commits)
  if (Array.isArray(payload.commits) && payload.commits.length > 0 && commitCount === 0) {
    commitCount = payload.commits.length
  }

  if (!repoName) {
    return { commitCount, commitTitles }
  }

  if (!commitTitles && before && head && !before.startsWith('0000000')) {
    try {
      const compareUrl = `https://api.github.com/repos/${repoName}/compare/${before}...${head}`
      const compareData = await githubApiFetchJson(compareUrl, token, 'GitHub compare API error')
      const compareCommits = Array.isArray(compareData.commits) ? compareData.commits : []
      const titles = compareCommits
        .map(commit => commitTitleFromMessage(((commit.commit || {}).message || '')))
        .filter(Boolean)
        .slice(0, 3)
      if (titles.length > 0) commitTitles = titles.join(' | ')
      if (!commitCount) {
        commitCount = Number.isFinite(Number(compareData.total_commits))
          ? Number(compareData.total_commits)
          : compareCommits.length
      }
    }
    catch (error) {
      console.log('Unable to enrich push event via compare endpoint:', error.message || error)
    }
  }

  if (!commitTitles && head) {
    try {
      const commitUrl = `https://api.github.com/repos/${repoName}/commits/${head}`
      const commitData = await githubApiFetchJson(commitUrl, token, 'GitHub commit API error')
      const singleTitle = commitTitleFromMessage(((commitData.commit || {}).message || ''))
      if (singleTitle) commitTitles = singleTitle
      if (!commitCount) commitCount = 1
    }
    catch (error) {
      console.log('Unable to enrich push event via commit endpoint:', error.message || error)
    }
  }

  return { commitCount, commitTitles }
}

function eventUrl(event) {
  const repoName = (event.repo || {}).name || ''
  const repoUrl = repoName ? `https://github.com/${repoName}` : 'https://github.com'
  const payload = event.payload || {}

  if (event.type === 'PushEvent') {
    const before = payload.before
    const head = payload.head
    if (before && head && !before.startsWith('0000000')) {
      return `${repoUrl}/compare/${before}...${head}`
    }
    return repoUrl
  }
  if (event.type === 'PullRequestEvent') return ((payload.pull_request || {}).html_url) || repoUrl
  if (event.type === 'IssuesEvent') return ((payload.issue || {}).html_url) || repoUrl
  if (event.type === 'IssueCommentEvent') return ((payload.comment || {}).html_url) || ((payload.issue || {}).html_url) || repoUrl
  if (event.type === 'PullRequestReviewEvent') return ((payload.review || {}).html_url) || ((payload.pull_request || {}).html_url) || repoUrl
  if (event.type === 'PullRequestReviewCommentEvent') return ((payload.comment || {}).html_url) || ((payload.pull_request || {}).html_url) || repoUrl
  if (event.type === 'ReleaseEvent') return ((payload.release || {}).html_url) || repoUrl
  if (event.type === 'ForkEvent') return ((payload.forkee || {}).html_url) || repoUrl

  return repoUrl
}

async function eventSummary(event, token) {
  const actor = ((event.actor || {}).login) || 'Someone'
  const repoName = (event.repo || {}).name || 'a repository'
  const payload = event.payload || {}
  const branch = payload.ref ? payload.ref.replace('refs/heads/', '') : ''

  switch (event.type) {
    case 'PushEvent': {
      const pushDetails = await resolvePushCommitDetails(event, token)
      const commitCount = pushDetails.commitCount
      const commitLabel = commitCount === 1 ? 'commit' : 'commits'
      const head = trimSha(payload.head)
      const commitTitles = pushDetails.commitTitles
      return `${actor} pushed ${commitCount} ${commitLabel} to ${repoName}${branch ? ` (${branch})` : ''}${head ? ` [${head}]` : ''}${commitTitles ? `: ${commitTitles}` : ''}`
    }
    case 'PullRequestEvent': {
      const action = payload.action || 'updated'
      const number = (payload.pull_request || {}).number || ''
      const title = (payload.pull_request || {}).title || 'Pull request'
      return `${actor} ${action} PR #${number} in ${repoName}: ${title}`
    }
    case 'IssuesEvent': {
      const action = payload.action || 'updated'
      const number = (payload.issue || {}).number || ''
      const title = (payload.issue || {}).title || 'Issue'
      return `${actor} ${action} issue #${number} in ${repoName}: ${title}`
    }
    case 'IssueCommentEvent': {
      const number = (payload.issue || {}).number || ''
      return `${actor} commented on issue #${number} in ${repoName}`
    }
    case 'PullRequestReviewEvent': {
      const action = payload.action || 'reviewed'
      const number = (payload.pull_request || {}).number || ''
      return `${actor} ${action} review on PR #${number} in ${repoName}`
    }
    case 'PullRequestReviewCommentEvent': {
      const number = (payload.pull_request || {}).number || ''
      return `${actor} commented on PR #${number} in ${repoName}`
    }
    case 'CreateEvent': {
      const refType = payload.ref_type || 'resource'
      const ref = payload.ref ? ` ${payload.ref}` : ''
      return `${actor} created ${refType}${ref} in ${repoName}`
    }
    case 'DeleteEvent': {
      const refType = payload.ref_type || 'resource'
      const ref = payload.ref ? ` ${payload.ref}` : ''
      return `${actor} deleted ${refType}${ref} in ${repoName}`
    }
    case 'ReleaseEvent': {
      const action = payload.action || 'published'
      const tag = (payload.release || {}).tag_name || ''
      return `${actor} ${action} release${tag ? ` ${tag}` : ''} in ${repoName}`
    }
    case 'WatchEvent':
      return `${actor} starred ${repoName}`
    case 'ForkEvent':
      return `${actor} forked ${repoName}`
    default:
      return `${actor} triggered ${event.type || 'activity'} in ${repoName}`
  }
}

async function createActivityText(event, token) {
  const summary = await eventSummary(event, token)
  return `${summary} (${eventUrl(event)})`
}

async function fetchOrganizationEvents(org, token, lastEventId) {
  const collected = []
  let reachedKnownEvent = false
  const maxPages = 5

  for (let page = 1; page <= maxPages; page += 1) {
    const url = `https://api.github.com/orgs/${encodeURIComponent(org)}/events?per_page=100&page=${page}`
    const events = await githubApiFetchJson(url, token, 'GitHub API error')
    if (!Array.isArray(events) || events.length === 0) break

    for (const event of events) {
      if (lastEventId && event.id === lastEventId) {
        reachedKnownEvent = true
        break
      }
      collected.push(event)
    }

    if (reachedKnownEvent || events.length < 100) break
  }

  return collected
}

exports.githubActivity = onSchedule(
  {
    schedule: 'every 60 minutes',
    timeZone: 'Etc/UTC',
    timeoutSeconds: 540,
    memory: '256MiB',
    secrets: [GITHUB_TOKEN, GITHUB_ORG],
  },
  async () => {
    try {
      const token = GITHUB_TOKEN.value()
      const org = GITHUB_ORG.value()
      if (!token || !org) {
        console.log('Missing GITHUB_TOKEN or GITHUB_ORG secret')
        return
      }

      const stateRef = admin.firestore().doc(STATE_DOC_PATH)
      const stateSnap = await stateRef.get()
      const state = stateSnap.exists ? (stateSnap.data() || {}) : {}
      const lastEventId = state.lastEventId || null

      const latestEvents = await fetchOrganizationEvents(org, token, lastEventId)

      if (!lastEventId) {
        const initialEvents = await githubApiFetchJson(
          `https://api.github.com/orgs/${encodeURIComponent(org)}/events?per_page=1`,
          token,
          'GitHub init error'
        )
        const initialLastEventId = (Array.isArray(initialEvents) && initialEvents[0] && initialEvents[0].id) || null

        await stateRef.set({
          lastEventId: initialLastEventId,
          initializedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true })

        console.log('GitHub activity watcher initialized, no backfill processed')
        return
      }

      if (latestEvents.length > 0) {
        const ordered = latestEvents.slice().reverse()
        const lines = await Promise.all(ordered.map(event => createActivityText(event, token)))

        await createMessageUtils.createMessageAFS({
          user: ADMIN_USER_ID,
          chain: GITHUB_ACTIVITY_CHAIN,
          text: lines.join('\n'),
        })
      }

      const newestEventId = latestEvents[0] ? latestEvents[0].id : lastEventId
      await stateRef.set({
        lastEventId: newestEventId,
        lastRunCreatedCount: latestEvents.length,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true })

      console.log(`GitHub activity processed, ${latestEvents.length} new event(s), ${latestEvents.length > 0 ? 1 : 0} message created`)
    }
    catch (error) {
      console.error('githubActivity error:', error)
    }
  }
)
