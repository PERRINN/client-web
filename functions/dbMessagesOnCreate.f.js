const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const admin = require('firebase-admin')
try { admin.initializeApp() } catch (e) {}
const verifyMessageUtils = require('./utils/verifyMessage')
const { defineSecret } = require('firebase-functions/params')
const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY')
const stripe = require('stripe')

exports.dbMessagesOnCreate=onDocumentCreated('PERRINNMessages/{message}',async(event)=>{
  const messageId=event.params.message;
  const messageData=event.data?.data();
  try{
    const stripeObj = stripe(STRIPE_SECRET_KEY.value())
    await verifyMessageUtils.verifyMessage(messageId,messageData,stripeObj)
  }
  catch(error){
    console.log('error '+error);
    return admin.firestore().doc('PERRINNMessages/'+messageId).update({verified:false})
  }
});
