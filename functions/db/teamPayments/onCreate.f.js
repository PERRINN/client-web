const functions = require('firebase-functions')
const admin = require('firebase-admin')
try { admin.initializeApp() } catch (e) {}
const stripeObj = require('stripe')(functions.config().stripe.token)
const createMessageUtils = require('../../utils/createMessage')

exports=module.exports=functions.firestore.document('PERRINNTeams/{user}/payments/{chargeID}').onCreate((data,context)=>{
  return admin.auth().getUser(context.params.user).then(function(userRecord) {
    var email=userRecord.toJSON().email
    const val = data.data()
    if (val === null || val.id || val.error) return null
    const amount=val.amountCharge
    const currency=val.currency
    const source=val.source
    const description=val.amountSharesPurchased+" Shares to "+email
    const receipt_email=email
    const idempotency_key=context.params.chargeID
    let charge = {amount,currency,source,description,receipt_email}
    return stripeObj.charges.create(charge, {idempotency_key})
    .then(response=>{
      if (response.outcome.seller_message=='Payment complete.'){
        let messageObj={
          user:context.params.user,
          chain:context.params.user,
          text:"Invested "+val.amountCharge/100+val.currency,
          purchaseCOIN:{
            chargeID:context.params.chargeID,
            amount:val.amountSharesPurchased
          }
        }
        createMessageUtils.createMessageAFS(messageObj)
      }
      return data.ref.set(response,{merge:true})
    }, error=>{
      return data.ref.update({
        errorMessage:error.message,
        errorType:error.type
      })
    })
  })
})
