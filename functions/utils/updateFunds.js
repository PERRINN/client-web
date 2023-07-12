const functions = require('firebase-functions')
const admin = require('firebase-admin')
const createMessageUtils = require('./createMessage')
const stripeObj = require('stripe')(functions.config().stripe.token)

module.exports = {

  updateFunds:async(messageObj)=>{
    try{
      let stripeBalance=await stripeObj.balance.retrieve()
      let amountGBPRaisedPERRINN=stripeBalance.available[0].amount/100+stripeBalance.pending[0].amount/100
      const fundLastMessages=await admin.firestore().collection('PERRINNMessages').where('fund.active','==',true).where('lastMessage','==',true).get()
      let funds=[]
      fundLastMessages.forEach(fundLastMessage=>{
        let fund={
          amountGBPTarget:((fundLastMessage.data().fund||{}).amountGBPTarget||0),
          amountGBPRaisedOld:((fundLastMessage.data().fund||{}).amountGBPRaised||0),
          chain:fundLastMessage.data().chain
        }
        funds.push(fund)
      })
      if (funds.length==0)return
      let amountGBPRaisedPerFund=Number(amountGBPRaisedPERRINN)/funds.length
      let amountGBPFullTotal=0
      let fundsCountFull=0
      funds.forEach(fund=>{
        if(fund.amountGBPTarget<amountGBPRaisedPerFund){
          fund['amountGBPRaised']=fund.amountGBPTarget
          amountGBPFullTotal=Number(amountGBPFullTotal)+Number(fund.amountGBPTarget)
          fundsCountFull=Number(fundsCountFull)+Number(1)
        }
      })
      amountGBPRaisedPerFund=Number(amountGBPRaisedPERRINN-amountGBPFullTotal)/Number(funds.length-fundsCountFull)
      funds.forEach(fund=>{
        if(!fund.amountGBPRaised)fund['amountGBPRaised']=Number(amountGBPRaisedPerFund)
      })
      funds.forEach(fund=>{
        if(fund['amountGBPRaised']!=fund['amountGBPRaisedOld'])createMessageUtils.createMessageAFS({
          user:'FHk0zgOQUja7rsB9jxDISXzHaro2',
          text:'Updating fund amount raised',
          chain:fund['chain'],
          fund:{amountGBPRaised:fund['amountGBPRaised']}
        })
      })
      return
    }
    catch(error){
      console.log('error update Funds: '+error)
      return error
    }
  },

}
