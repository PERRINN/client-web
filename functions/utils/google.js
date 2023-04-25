const admin = require('firebase-admin')
const createMessageUtils = require('./createMessage')
const {google} = require('googleapis')

module.exports = {

  googleGroupMemberInsert:(email)=>{
    var SERVICE_ACCOUNT_EMAIL = 'perrinn-service-account@perrinn.iam.gserviceaccount.com'
    var SERVICE_ACCOUNT_KEY_FILE = 'perrinn-62d6932fce8e.json'
    const jwt = new google.auth.JWT(
        SERVICE_ACCOUNT_EMAIL,
        SERVICE_ACCOUNT_KEY_FILE,
        null,
        ['https://www.googleapis.com/auth/admin.directory.group'],
        'nicolas@perrinn.com'
    )
    const googleAdmin = google.admin({
      version:'directory_v1',
      jwt,
    })
    return jwt.authorize().then(() => {
      return googleAdmin.members.insert({
        auth:jwt,
        groupKey:"perrinn-google-group@perrinn.com",
        requestBody:{
          email:email,
          role:'MEMBER'
        }
      })
    }).catch(error=>{
      console.log('Google INSERT email '+email+' error '+error)
      return
    })
  },

  googleGroupMemberDelete:(email)=>{
    if(email=='nicolas@perrinn.com')return
    var SERVICE_ACCOUNT_EMAIL = 'perrinn-service-account@perrinn.iam.gserviceaccount.com'
    var SERVICE_ACCOUNT_KEY_FILE = 'perrinn-62d6932fce8e.json'
    const jwt = new google.auth.JWT(
        SERVICE_ACCOUNT_EMAIL,
        SERVICE_ACCOUNT_KEY_FILE,
        null,
        ['https://www.googleapis.com/auth/admin.directory.group'],
        'nicolas@perrinn.com'
    )
    const googleAdmin = google.admin({
      version:'directory_v1',
      jwt,
    })
    return jwt.authorize().then(() => {
      return googleAdmin.members.delete({
        auth:jwt,
        groupKey:"perrinn-google-group@perrinn.com",
        memberKey:email
      })
    }).catch(error=>{
      console.log('Google DELETE email '+email+' error '+error)
      return
    })
  },

  googleGroupMembersGet:()=>{
    var SERVICE_ACCOUNT_EMAIL = 'perrinn-service-account@perrinn.iam.gserviceaccount.com'
    var SERVICE_ACCOUNT_KEY_FILE = 'perrinn-62d6932fce8e.json'
    const jwt = new google.auth.JWT(
        SERVICE_ACCOUNT_EMAIL,
        SERVICE_ACCOUNT_KEY_FILE,
        null,
        ['https://www.googleapis.com/auth/admin.directory.group'],
        'nicolas@perrinn.com'
    )
    const googleAdmin = google.admin({
      version:'directory_v1',
      jwt,
    })
    return jwt.authorize().then(() => {
      return googleAdmin.members.list({
        auth:jwt,
        groupKey:"perrinn-google-group@perrinn.com"
      })
    }).catch(error=>{
      console.log('Google GET error '+error)
      return
    })
  }

}
