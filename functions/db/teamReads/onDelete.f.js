const functions = require('firebase-functions')
const admin = require('firebase-admin')
try { admin.initializeApp() } catch (e) {}

exports=module.exports=functions.firestore.document('PERRINNTeams/{team}/reads/{message}').onDelete((data,context)=>{
  return admin.firestore().doc('PERRINNMessages/'+context.params.message).set({
    reads:{
      [context.params.team]:null
    }
  },{merge:true}).catch(error=>{
    console.log(error)
  })
})
