const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const admin = require('firebase-admin')
try { admin.initializeApp() } catch (e) {}
const verifyMessageUtils = require('./utils/verifyMessage')

exports.dbMessagesOnCreate=onDocumentCreated('PERRINNMessages/{message}',async(event)=>{
  const messageId=event.params.message;
  const messageData=event.data?.data();
  try{
    await verifyMessageUtils.verifyMessage(messageId,messageData)
  }
  catch(error){
    console.log('error '+error);
    return admin.firestore().doc('PERRINNMessages/'+messageId).update({verified:false})
  }
});
