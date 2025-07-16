const { onDocumentDeleted } = require('firebase-functions/v2/firestore')
const admin = require('firebase-admin')
try { admin.initializeApp() } catch (e) {}

exports.dbTeamReadsOnDelete=onDocumentDeleted('PERRINNTeams/{team}/reads/{message}',(event)=>{
  return admin.firestore().doc('PERRINNMessages/'+event.params.message).set({
    reads:{
      [event.params.team]:null
    }
  },{merge:true}).catch(error=>{
    console.log(error)
  })
})
