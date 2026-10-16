const { onSchedule } = require('firebase-functions/v2/scheduler')
const admin = require('firebase-admin')
try { admin.initializeApp() } catch (e) {}
const verifyMessageUtils = require('./utils/verifyMessage')
const createMessageUtils = require('./utils/createMessage')

exports.scheduledDailyMembership = onSchedule(
  {
    schedule: 'every 24 hours',
    timeoutSeconds: 540,
    memory: '1GiB',
    timeZone: 'Etc/UTC',
  },
  async (context) => {
    try {
      const adminUserId='FHk0zgOQUja7rsB9jxDISXzHaro2'
      let statistics={}
      statistics.wallet={}
      statistics.interest={}
      statistics.contract={}
      statistics.transactionIn={}
      statistics.transactionOut={}
      statistics.purchaseCOIN={}
      const listUsersResult=[]
      let pageToken
      do {
        const page=await admin.auth().listUsers(1000,pageToken)
        listUsersResult.push(...page.users)
        pageToken=page.pageToken
      } while(pageToken)
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

      const usersCount=statistics.userCount||0
      const investedAmount=((statistics.wallet||{}).balance)||0
      const investedAmountRounded=Math.round(Number(investedAmount||0)*1000)/1000
      const statisticsSummaryText=`${usersCount} people. ${investedAmountRounded} total PRN balance.`
  
      await createMessageUtils.createMessageAFS({
        user:adminUserId,
        text:statisticsSummaryText,
        statistics:statistics,
        chain:"Daily-updates"
      })
  
      console.log(statistics.userCount+' users processed.')
      } catch (error) {
      console.error('Scheduled function error:', error);
    }
  }
)