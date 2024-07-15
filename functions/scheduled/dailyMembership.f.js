const functions = require('firebase-functions')
const admin = require('firebase-admin')
try { admin.initializeApp() } catch (e) {}
const verifyMessageUtils = require('../utils/verifyMessage')
const createMessageUtils = require('../utils/createMessage')
const stripeObj = require('stripe')(functions.config().stripe.token)

const runtimeOpts={timeoutSeconds:540,memory:'1GB'}

exports=module.exports=functions.runWith(runtimeOpts).pubsub.schedule('every 24 hours').onRun(async(context) => {
  try{
    const appSettingsCosts=await admin.firestore().doc('appSettings/costs').get()
    const appSettingsContract=await admin.firestore().doc('appSettings/contract').get()
    const appSettingsPayment=await admin.firestore().doc('appSettings/payment').get()
    const now=Date.now()
    let statistics={}
    statistics.wallet={}
    statistics.PERRINNLimited={}
    statistics.interest={}
    statistics.contract={}
    statistics.transactionIn={}
    statistics.transactionOut={}
    statistics.purchaseCOIN={}
    statistics.emailsContributorsAuth=[]
    let listUsersResult1={}
    let listUsersResult2={}
    listUsersResult1=await admin.auth().listUsers(1000)
    if(listUsersResult1.pageToken)listUsersResult2=await admin.auth().listUsers(1000,listUsersResult1.pageToken)
    let listUsersResult=listUsersResult1.users.concat(listUsersResult2.users)
    var reads=[]
    listUsersResult.forEach(userRecord=>{
      reads.push(admin.firestore().collection('PERRINNMessages').where('user','==',userRecord.uid).orderBy('serverTimestamp','desc').limit(1).get())
    })
    const lastUserMessages=await Promise.all(reads)
    var verifyMessageBatch=[]
    lastUserMessages.forEach((lastUserMessage)=>{
      if(lastUserMessage.docs[0]!=undefined){
        verifyMessageBatch.push(verifyMessageUtils.verifyMessage(lastUserMessage.docs[0].id,lastUserMessage.docs[0].data()))
      }
    })
    const results=await Promise.all(verifyMessageBatch)
    results.forEach((result)=>{
      if (result.wallet.shareBalance>0)statistics.emailsContributorsAuth.push(result.emails.auth)
      statistics.wallet.shareBalance=((statistics.wallet||{}).shareBalance||0)+result.wallet.shareBalance
      statistics.PERRINNLimited.balance=((statistics.PERRINNLimited||{}).balance||0)+(result.PERRINNLimited.amount||0)
      statistics.interest.amount=((statistics.interest||{}).amount||0)+result.interest.amount
      statistics.interest.rateDay=statistics.wallet.shareBalance*(Math.exp(result.interest.rateYear/365)-1)
      statistics.interest.amountCummulate=((statistics.interest||{}).amountCummulate||0)+result.interest.amountCummulate
      statistics.contract.amount=((statistics.contract||{}).amount||0)+result.contract.amount
      statistics.contract.amountCummulate=((statistics.contract||{}).amountCummulate||0)+result.contract.amountCummulate
      statistics.transactionIn.amount=((statistics.transactionIn||{}).amount||0)+result.transactionIn.amount
      statistics.transactionIn.amountCummulate=((statistics.transactionIn||{}).amountCummulate||0)+result.transactionIn.amountCummulate
      statistics.transactionOut.amount=((statistics.transactionOut||{}).amount||0)+result.transactionOut.amount
      statistics.transactionOut.amountCummulate=((statistics.transactionOut||{}).amountCummulate||0)+result.transactionOut.amountCummulate
      statistics.purchaseCOIN.amount=((statistics.purchaseCOIN||{}).amount||0)+result.purchaseCOIN.amount
      statistics.purchaseCOIN.amountCummulate=((statistics.purchaseCOIN||{}).amountCummulate||0)+result.purchaseCOIN.amountCummulate
      statistics.userCount=(statistics.userCount||0)+1
    })
    statistics.serverTimestamp=admin.firestore.FieldValue.serverTimestamp()
    statistics.stripeBalance=await stripeObj.balance.retrieve()

    createMessageUtils.createMessageAFS({
      user:'FHk0zgOQUja7rsB9jxDISXzHaro2',
      text:"New statistics:",
      statistics:statistics,
      chain:'PERRINNStatistics',
      chatSubject:'PERRINN statistics'
    })

    console.log(statistics.userCount+' users processed.')
    console.log(statistics.emailsContributorsAuth.length+' PRN holders.')
    console.log('PRN holders emails: '+JSON.stringify(statistics.emailsContributorsAuth))

  }
  catch(error){
    console.log(error)
  }
})
