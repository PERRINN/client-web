const { getFirestore, FieldValue } = require('firebase-admin/firestore')

module.exports = {

  createMessageAFS:async(messageObj)=>{
    try{
      const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
      let autoId=''
      for(let i=0;i<20;i++){
        autoId+=chars.charAt(Math.floor(Math.random()*chars.length))
      }

      messageObj.serverTimestamp=FieldValue.serverTimestamp()
      messageObj.isBackendMessage=true
      messageObj.chain=messageObj.chain||autoId
      if (typeof messageObj.text === 'string') {
        const text = messageObj.text.replace(/\s*\((?:Backend message|System)\)\s*$/, '').trimEnd()
        messageObj.text = text ? `${text}\n(System)` : '(System)'
      }
      return getFirestore().collection('PERRINNMessages').add(messageObj)
    }
    catch(error){
      console.log(error)
      return error
    }
  },

}
