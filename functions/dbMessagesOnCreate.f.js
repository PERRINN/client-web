const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const admin = require('firebase-admin')
const { getFirestore } = require('firebase-admin/firestore')

try { admin.initializeApp() } catch (e) {}

const db = getFirestore()

const verifyMessageUtils = require('./utils/verifyMessage')
const { defineSecret } = require('firebase-functions/params')

exports.dbMessagesOnCreate = onDocumentCreated('PERRINNMessages/{message}', async (event) => {
  const messageId = event.params.message
  const messageData = event.data?.data()

  try {
    await verifyMessageUtils.verifyMessage(messageId, messageData)
  }
  catch (error) {
    console.log('error ' + error)
    return db.doc('PERRINNMessages/' + messageId).update({ verified: false })
  }
})
