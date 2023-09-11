const functions = require('firebase-functions')
const admin = require('firebase-admin')
const createMessageUtils = require('./createMessage')
const stripeObj = require('stripe')(functions.config().stripe.token)

module.exports = {

  updateFunds:async(messageObj)=>{
    try{
      let stripeBalance=await stripeObj.balance.retrieve()
      let amountGBPRaisedPERRINN=stripeBalance.available[0].amount/100+stripeBalance.pending[0].amount/100
      const fundLastMessages=await admin.firestore().collection('PERRINNMessages').where('fund.active','==',true).where('lastMessage','==',true).where('verified','==',true).orderBy('fund.daysLeft','asc').get()
      fundLastMessages.forEach(fundLastMessage=>{
        let amountRaised=Math.min(amountGBPRaisedPERRINN,((fundLastMessage.data().fund||{}).amountGBPTarget||0))
        amountGBPRaisedPERRINN=amountGBPRaisedPERRINN-amountRaised
        if(amountRaised!=((fundLastMessage.data().fund||{}).amountGBPRaised||0))createMessageUtils.createMessageAFS({
          user:'FHk0zgOQUja7rsB9jxDISXzHaro2',
          text:'Updating fund amount raised',
          chain:fundLastMessage.data().chain,
          fund:{amountGBPRaised:amountRaised}
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
