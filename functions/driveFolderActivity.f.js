const { onSchedule } = require('firebase-functions/v2/scheduler')
const admin = require('firebase-admin')
const { defineSecret } = require('firebase-functions/params')
const { google } = require('googleapis')
const createMessageUtils = require('./utils/createMessage')

try { admin.initializeApp() } catch (e) {}

const DRIVE_SERVICE_ACCOUNT_JSON = defineSecret('DRIVE_SERVICE_ACCOUNT_JSON')
const DRIVE_FOLDER_ID = defineSecret('DRIVE_FOLDER_ID')

const ADMIN_USER_ID = 'FHk0zgOQUja7rsB9jxDISXzHaro2'
const DRIVE_ACTIVITY_CHAIN = 'google-drive-activity'
const STATE_DOC_PATH = 'Integrations/googleDriveActivityState'

async function parentTreeContainsFolder(drive, parentIds, targetFolderId, membershipCache) {
  if (!parentIds || parentIds.length === 0) return false

  for (const parentId of parentIds) {
    if (parentId === targetFolderId) return true

    if (membershipCache.has(parentId)) {
      if (membershipCache.get(parentId) === true) return true
      continue
    }

    try {
      const parentRes = await drive.files.get({
        fileId: parentId,
        supportsAllDrives: true,
        fields: 'id,parents',
      })
      const parentParents = (parentRes.data || {}).parents || []
      const isInside = await parentTreeContainsFolder(drive, parentParents, targetFolderId, membershipCache)
      membershipCache.set(parentId, isInside)
      if (isInside) return true
    }
    catch (error) {
      membershipCache.set(parentId, false)
    }
  }

  return false
}

function createActivityText(change) {
  const file = change.file || {}
  const fileName = file.name || 'Unknown file'
  const actor = (file.lastModifyingUser || {}).displayName || ((file.owners || [])[0] || {}).displayName || 'Someone'
  const isFolder = file.mimeType === 'application/vnd.google-apps.folder'
  const itemUrl = change.fileId
    ? (isFolder
      ? `https://drive.google.com/drive/folders/${change.fileId}`
      : `https://drive.google.com/file/d/${change.fileId}`)
    : null
  const urlText = itemUrl ? ` (${itemUrl})` : ''
  if (change.removed || file.trashed) {
    return `${actor} removed ${fileName}${urlText}`
  }
  return `${actor} updated ${fileName}${urlText}`
}

exports.driveFolderActivity = onSchedule(
  {
    schedule: 'every 60 minutes',
    timeZone: 'Etc/UTC',
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [DRIVE_SERVICE_ACCOUNT_JSON, DRIVE_FOLDER_ID],
  },
  async () => {
    try {
      const folderId = DRIVE_FOLDER_ID.value()
      const serviceAccountRaw = DRIVE_SERVICE_ACCOUNT_JSON.value()
      if (!folderId || !serviceAccountRaw) {
        console.log('Missing DRIVE_FOLDER_ID or DRIVE_SERVICE_ACCOUNT_JSON secret')
        return
      }

      const serviceAccount = JSON.parse(serviceAccountRaw)
      const auth = new google.auth.JWT(
        serviceAccount.client_email,
        null,
        serviceAccount.private_key,
        ['https://www.googleapis.com/auth/drive.readonly']
      )
      const drive = google.drive({ version: 'v3', auth })

      const stateRef = admin.firestore().doc(STATE_DOC_PATH)
      const stateSnap = await stateRef.get()
      const state = stateSnap.exists ? (stateSnap.data() || {}) : {}

      let pageToken = state.pageToken || null
      if (!pageToken) {
        const startTokenResponse = await drive.changes.getStartPageToken({
          supportsAllDrives: true,
        })
        pageToken = startTokenResponse.data.startPageToken
        if (!pageToken) {
          console.log('No startPageToken received from Drive API')
          return
        }
        await stateRef.set({
          pageToken,
          initializedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true })
        console.log('Drive activity watcher initialized, no backfill processed')
        return
      }

      let nextPageToken = pageToken
      let newStartPageToken = null
      let activityCount = 0
      const activityLines = []
      const membershipCache = new Map()
      membershipCache.set(folderId, true)

      do {
        const res = await drive.changes.list({
          pageToken: nextPageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          fields: 'nextPageToken,newStartPageToken,changes(changeType,removed,time,fileId,file(name,mimeType,parents,trashed,lastModifyingUser(displayName),owners(displayName)))',
          pageSize: 100,
        })

        const changes = res.data.changes || []
        for (const change of changes) {
          const parents = (change.file || {}).parents || []
          const isInsideTargetFolder = await parentTreeContainsFolder(drive, parents, folderId, membershipCache)
          if (!isInsideTargetFolder) continue

          activityLines.push(createActivityText(change))
          activityCount += 1
        }

        nextPageToken = res.data.nextPageToken || null
        newStartPageToken = res.data.newStartPageToken || newStartPageToken
      } while (nextPageToken)

      if (activityLines.length > 0) {
        await createMessageUtils.createMessageAFS({
          user: ADMIN_USER_ID,
          chain: DRIVE_ACTIVITY_CHAIN,
          text: activityLines.join('\n'),
        })
      }

      if (newStartPageToken) {
        await stateRef.set({
          pageToken: newStartPageToken,
          lastRunCreatedCount: activityCount,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true })
      }

      console.log(`Drive activity processed, ${activityCount} activity item(s), ${activityLines.length > 0 ? 1 : 0} message created`)
    }
    catch (error) {
      console.error('driveFolderActivity error:', error)
    }
  }
)
