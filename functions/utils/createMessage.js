const admin = require('firebase-admin')

module.exports = {

  createMessageAFS:async(messageObj)=>{
    try{
      const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
      let autoId=''
      for(let i=0;i<20;i++){
        autoId+=chars.charAt(Math.floor(Math.random()*chars.length))
      }
      messageObj.serverTimestamp=admin.firestore.FieldValue.serverTimestamp()
      messageObj.chain=messageObj.chain||autoId
      return admin.firestore().collection('PERRINNMessages').add(messageObj)
    }
    catch(error){
      console.log(error)
      return error
    }
  },

}
