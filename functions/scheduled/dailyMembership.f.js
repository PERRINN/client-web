const functions = require('firebase-functions')
const admin = require('firebase-admin')
try { admin.initializeApp() } catch (e) {}
const verifyMessageUtils = require('../utils/verifyMessage')
const onshapeUtils = require('../utils/onshape')
const googleUtils = require('../utils/google')
const createMessageUtils = require('../utils/createMessage')
const stripeObj = require('stripe')(functions.config().stripe.token)

const runtimeOpts={timeoutSeconds:540,memory:'1GB'}

exports=module.exports=functions.runWith(runtimeOpts).pubsub.schedule('every 24 hours').onRun(async(context) => {
  try{
    const now=Date.now()
    let statistics={}
    statistics.wallet={}
    statistics.PERRINNLimited={}
    statistics.interest={}
    statistics.contract={}
    statistics.transactionIn={}
    statistics.transactionOut={}
    statistics.purchaseCOIN={}
    statistics.emailsMembersAuth=[]
    statistics.emailsMembersGoogle=[]
    statistics.emailsMembersOnshape=[]
    statistics.emailsAPIGoogle=[]
    statistics.emailsAPIOnshape=[]
    statistics.emailsInvalidGoogle=[]
    statistics.emailsMissingGoogle=[]
    statistics.emailsMissingOnshape=[]
    statistics.onshapeUids=[]
    statistics.onshapeUidsInvalid=[]
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
      if (result.userStatus.isMember){
        statistics.emailsMembersAuth.push(result.emails.auth)
        statistics.emailsMembersGoogle.push(result.emails.google)
        statistics.emailsMembersOnshape.push(result.emails.onshape)
      }
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
    const googleUsers=await googleUtils.googleGroupMembersGet()
    googleUsers.data.members.forEach(member=>{
      statistics.emailsAPIGoogle.push(member.email)
    })
    statistics.emailsAPIGoogle.forEach(email=>{
      if(!statistics.emailsMembersGoogle.includes(email))statistics.emailsInvalidGoogle.push(email)
    })
    for(const email of statistics.emailsInvalidGoogle){
      await googleUtils.googleGroupMemberDelete(email)
    }
    statistics.emailsMembersGoogle.forEach(email=>{
      if(!statistics.emailsAPIGoogle.includes(email))statistics.emailsMissingGoogle.push(email)
    })
    const onshapeUsers=await onshapeUtils.onshapeTeamMembersGet()
    onshapeUsers.items.forEach(item=>{
      statistics.emailsAPIOnshape.push(item.member.email)
      statistics.onshapeUids.push(item.member.id)
    })
    statistics.emailsAPIOnshape.forEach(email=>{
      if(!statistics.emailsMembersOnshape.includes(email))statistics.onshapeUidsInvalid.push(statistics.onshapeUids[statistics.emailsAPIOnshape.indexOf(email)])
    })
    for(const uid of statistics.onshapeUidsInvalid){
      await onshapeUtils.onshapeTeamMemberDelete(uid)
    }
    statistics.emailsMembersOnshape.forEach(email=>{
      if(!statistics.emailsAPIOnshape.includes(email))statistics.emailsMissingOnshape.push(email)
    })
    statistics.serverTimestamp=admin.firestore.FieldValue.serverTimestamp()
    await admin.firestore().collection('statistics').add(statistics);
    let stripeBalance=await stripeObj.balance.retrieve()

    let messageText=
      statistics.userCount+' visitors. '+
      statistics.emailsMembersAuth.length+' members. '+
      Math.round(statistics.wallet.shareBalance).toFixed(0).replace(/\d(?=(\d{3})+\.)/g, '$&,')+' Shares distributed. '+
      Math.round(statistics.interest.rateDay).toFixed(0).replace(/\d(?=(\d{3})+\.)/g, '$&,')+' Shares created from interest per day. '+
      (stripeBalance.available[0].amount/100)+stripeBalance.available[0].currency+' available in the PERRINN cash reserve. '+
      (stripeBalance.pending[0].amount/100)+stripeBalance.pending[0].currency+' pending in the PERRINN cash reserve.'

    createMessageUtils.createMessageAFS({
      user:'FHk0zgOQUja7rsB9jxDISXzHaro2',
      text:messageText,
      statistics:statistics,
      chain:'PERRINNStatistics',
      chatSubject:'PERRINN statistics'
    })

    console.log(statistics.userCount+' users processed.')
    console.log(statistics.emailsMembersAuth.length+' PERRINN members.')
    console.log(statistics.emailsAPIGoogle.length+' Google users.')
    console.log(statistics.emailsAPIOnshape.length+' Onshape users.')
    console.log('Members Emails: '+JSON.stringify(statistics.emailsMembersAuth))
    console.log('Google Emails: '+JSON.stringify(statistics.emailsAPIGoogle))
    console.log('Onshape Emails: '+JSON.stringify(statistics.emailsAPIOnshape))
    console.log('invalid Google Emails: '+JSON.stringify(statistics.emailsInvalidGoogle))
    console.log('invalid Onshape Uids: '+JSON.stringify(statistics.onshapeUidsInvalid))
    console.log('missing Google Emails: '+JSON.stringify(statistics.emailsMissingGoogle))
    console.log('missing Onshape Emails: '+JSON.stringify(statistics.emailsMissingOnshape))

  }
  catch(error){
    console.log(error)
  }
})
