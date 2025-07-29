const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const admin = require('firebase-admin')
try { admin.initializeApp() } catch (e) {}

exports.dbTeamReadsOnCreate=onDocumentCreated('PERRINNTeams/{team}/reads/{message}',(event)=>{
  return admin.firestore().doc('PERRINNMessages/'+event.params.message).set({
    reads:{
      [event.params.team]:event.data?.data().serverTimestamp||true
    }
  },{merge:true}).catch(error=>{
    console.log(error)
  })
})
