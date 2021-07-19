const functions = require('firebase-functions')
const admin = require('firebase-admin')
try { admin.initializeApp() } catch (e) {}
const verifyMessageUtils = require('../../utils/verifyMessage')

exports=module.exports=functions.firestore.document('PERRINNMessages/{message}').onCreate(async(data,context)=>{
  const messageId=context.params.message;
  const messageData=data.data();
  try{
    await verifyMessageUtils.verifyMessage(messageId,messageData)
  }
  catch(error){
    console.log('user '+user+' error '+error);
    return admin.firestore().doc('PERRINNMessages/'+messageId).update({verified:false})
  }
});
