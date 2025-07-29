const { onSchedule } = require('firebase-functions/v2/scheduler')
const admin = require('firebase-admin')
try { admin.initializeApp() } catch (e) {}
const verifyMessageUtils = require('./utils/verifyMessage')
const createMessageUtils = require('./utils/createMessage')
const { defineSecret } = require('firebase-functions/params')
const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY')
const stripe = require('stripe')

exports.scheduledDailyMembership = onSchedule(
  {
    schedule: 'every 24 hours',
    timeoutSeconds: 540,
    memory: '1GiB',
    timeZone: 'Etc/UTC',
    secrets: [STRIPE_SECRET_KEY] // 🔥 this makes the secret available
  },
  async (context) => {
    try {
      const stripeObj = stripe(STRIPE_SECRET_KEY.value())
      const appSettingsCosts=await admin.firestore().doc('appSettings/costs').get()
      const appSettingsContract=await admin.firestore().doc('appSettings/contract').get()
      const appSettingsPayment=await admin.firestore().doc('appSettings/payment').get()
      const now=Date.now()
      let statistics={}
      statistics.wallet={}
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
          verifyMessageBatch.push(verifyMessageUtils.verifyMessage(lastUserMessage.docs[0].id,lastUserMessage.docs[0].data(),stripeObj))
        }
      })
      const results=await Promise.all(verifyMessageBatch)
      results.forEach((result)=>{
        if (((result.wallet||{}).balance||0)>0)statistics.emailsContributorsAuth.push(result.emails.auth)
        statistics.wallet.balance=((statistics.wallet||{}).balance||0)+((result.wallet||{}).balance||0)
        statistics.interest.amount=((statistics.interest||{}).amount||0)+((result.interest||{}).amount||0)
        statistics.interest.rateDay=statistics.wallet.balance*(Math.exp(((result.interest||{}).yearRate||0)/365)-1)
        statistics.interest.amountCummulate=((statistics.interest||{}).amountCummulate||0)+((result.interest||{}).amountCummulate||0)
        statistics.contract.amount=((statistics.contract||{}).amount||0)+((result.contract||{}).amount||0)
        statistics.contract.amountCummulate=((statistics.contract||{}).amountCummulate||0)+((result.contract||{}).amountCummulate||0)
        statistics.transactionIn.amount=((statistics.transactionIn||{}).amount||0)+((result.transactionIn||{}).amount||0)
        statistics.transactionIn.amountCummulate=((statistics.transactionIn||{}).amountCummulate||0)+((result.transactionIn||{}).amountCummulate||0)
        statistics.transactionOut.amount=((statistics.transactionOut||{}).amount||0)+((result.transactionOut||{}).amount||0)
        statistics.transactionOut.amountCummulate=((statistics.transactionOut||{}).amountCummulate||0)+((result.transactionOut||{}).amountCummulate||0)
        statistics.purchaseCOIN.amount=((statistics.purchaseCOIN||{}).amount||0)+((result.purchaseCOIN||{}).amount||0)
        statistics.purchaseCOIN.amountCummulate=((statistics.purchaseCOIN||{}).amountCummulate||0)+((result.purchaseCOIN||{}).amountCummulate||0)
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
      } catch (error) {
      console.error('Scheduled function error:', error);
    }
  }
)