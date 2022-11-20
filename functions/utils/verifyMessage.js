const admin = require('firebase-admin')
const createMessageUtils = require('./createMessage')
const googleUtils = require('./google')
const onshapeUtils = require('./onshape')

module.exports = {

  verifyMessage:async(messageId,messageData)=>{

    const user=messageData.user
    const now=Date.now()
    var batch = admin.firestore().batch()

    try{

      const appSettingsCosts=await admin.firestore().doc('appSettings/costs').get()
      const appSettingsContract=await admin.firestore().doc('appSettings/contract').get()
      const appSettingsPERRINNLimited=await admin.firestore().doc('appSettings/PERRINNLimited').get()
      const appSettingsPayment=await admin.firestore().doc('appSettings/payment').get()

      //user chain
      let userChain={}
      let userPreviousMessageData={}
      userChain.currentMessage=messageId
      userChain.nextMessage='none'
      userChain.previousMessage='none'
      userChain.index=1
      userChain.newDay=true
      userChain.newMonth=true
      const userLastMessages=await admin.firestore().collection('PERRINNMessages').where('user','==',user).where('verified','==',true).orderBy('serverTimestamp','desc').limit(2).get()
      userLastMessages.forEach(message=>{
        if(message.id!=messageId&&userChain.previousMessage=='none'){
          userChain.previousMessage=message.id
          userPreviousMessageData=message.data()
          userChain.index=((userPreviousMessageData.userChain||{}).index+1)||1
          userChain.newDay=Math.floor(now/86400000)!=Math.floor(((userPreviousMessageData.verifiedTimestamp||{}).seconds/3600/24)||0)
          userChain.newMonth=Math.floor(now/86400000/30)!=Math.floor(((userPreviousMessageData.verifiedTimestamp||{}).seconds/3600/24/30)||0)
          batch.update(admin.firestore().doc('PERRINNMessages/'+userChain.previousMessage),{"userChain.nextMessage":admin.firestore.FieldValue.arrayUnion(messageId)},{create:true})
        }
      })

      //user chain correcting if number of messages with nextMessage='none' is more than 1
      let userNextMessageNoneMessagesCount=0
      const userNextMessageNoneMessages=await admin.firestore().collection('PERRINNMessages').where('user','==',user).where('verified','==',true).where('userChain.nextMessage','==','none').orderBy('serverTimestamp','desc').get()
      userNextMessageNoneMessages.forEach(message=>{
        userNextMessageNoneMessagesCount+=1
        if(userNextMessageNoneMessagesCount>1)batch.update(admin.firestore().doc('PERRINNMessages/'+message.id),{"userChain.nextMessage":'invalid'},{create:true})
      })

      //image data
      let userImageData={}
      if(messageData.userImageTimestamp){
        userImageData=await admin.firestore().doc('Images/'+messageData.userImageTimestamp).get()
        if(userImageData!=undefined&&userImageData.data()!=undefined){
          batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{imageResized:true},{create:true})
          userImageData=userImageData.data()
        }
        else userImageData={}
      }
      let chatImageData={}
      if(messageData.chatImageTimestamp){
        chatImageData=await admin.firestore().doc('Images/'+messageData.chatImageTimestamp).get()
        if(chatImageData!=undefined&&chatImageData.data()!=undefined){
          batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{imageResized:true},{create:true})
          chatImageData=chatImageData.data()
        }
        else chatImageData={}
      }

      //chat image
      batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{chatImageUrlThumb:chatImageData.imageUrlThumb||messageData.chatImageUrlThumb||null},{create:true})
      batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{chatImageUrlMedium:chatImageData.imageUrlMedium||messageData.chatImageUrlMedium||null},{create:true})

      //user data
      let authEmail=''
      if(!(messageData.userEmail||userPreviousMessageData.userEmail)){
        const userRecord=await admin.auth().getUser(user)
        if(userRecord)authEmail=userRecord.toJSON().email
      }
      let userEmail=messageData.userEmail||userPreviousMessageData.userEmail||authEmail
      messageData.createdTimestamp=messageData.createdTimestamp||userPreviousMessageData.createdTimestamp||now
      if((messageData.creatingUser!=undefined)&&(userPreviousMessageData.name)&&(userPreviousMessageData.imageUrlThumbUser)){
        messageData.text=(messageData.text||"")+" (duplicate)"
        messageData.name=userPreviousMessageData.name
        messageData.imageUrlThumbUser=userPreviousMessageData.imageUrlThumbUser
        messageData.imageUrlMedium=userPreviousMessageData.imageUrlMedium
        messageData.imageUrlOriginal=userPreviousMessageData.imageUrlOriginal
      }
      messageData.userPresentation=messageData.userPresentation||userPreviousMessageData.userPresentation||""
      messageData.userPresentation=messageData.userPresentation.substring(0,150)
      batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{userEmail:userEmail||null},{create:true})
      batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{name:messageData.name||userPreviousMessageData.name||null},{create:true})
      batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{userPresentation:messageData.userPresentation},{create:true})
      batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{nameLowerCase:(messageData.name||userPreviousMessageData.name||"null").toLowerCase()},{create:true})
      batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{userImageTimestamp:messageData.userImageTimestamp||userPreviousMessageData.userImageTimestamp||null},{create:true})
      batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{imageUrlThumbUser:userImageData.imageUrlThumb||messageData.imageUrlThumbUser||userPreviousMessageData.imageUrlThumbUser||null},{create:true})
      batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{imageUrlMedium:userImageData.imageUrlMedium||messageData.imageUrlMedium||userPreviousMessageData.imageUrlMedium||null},{create:true})
      batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{imageUrlOriginal:messageData.imageUrlOriginal||userPreviousMessageData.imageUrlOriginal||null},{create:true})
      batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{createdTimestamp:messageData.createdTimestamp},{create:true})
      batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{[`recipients.${user}.name`]:messageData.name||userPreviousMessageData.name||null},{create:true})
      batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{[`recipients.${user}.imageUrlThumb`]:messageData.imageUrlThumbUser||userPreviousMessageData.imageUrlThumbUser||null},{create:true})
      batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{isUserAnOrganisation:messageData.isUserAnOrganisation||userPreviousMessageData.isUserAnOrganisation||false},{create:true})

      //chat chain
      let chatPreviousMessageData={}
      const chatPreviousLastMessages=await admin.firestore().collection('PERRINNMessages').where('chain','==',messageData.chain).where('lastMessage','==',true).get()
      let chatLastMessage=true
      chatPreviousLastMessages.forEach(message=>{
        if(message.data().serverTimestamp<messageData.serverTimestamp&&messageId!=message.id){
          batch.update(admin.firestore().doc('PERRINNMessages/'+message.id),{lastMessage:false})
          chatPreviousMessageData=message.data()
        } else if (message.data().serverTimestamp>messageData.serverTimestamp&&messageId!=message.id) {
          chatLastMessage=false
        }
      })
      batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{lastMessage:chatLastMessage})

      //message chat Subject
      if(messageData.chain==user)messageData.chatSubject='User settings'
      if(messageData.chain=='PERRINNUsersStateSnapshot')messageData.chatSubject='User State Snapshot'
      messageData.chatSubject=messageData.chatSubject||chatPreviousMessageData.chatSubject||messageData.text||""
      messageData.chatSubject=messageData.chatSubject.substring(0,60)
      batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{chatSubject:messageData.chatSubject},{create:true})

      //tag chain
      messageData.tag=messageData.chatSubject.split(" ")[0]||null
      let tagPreviousMessageData={}
      const tagPreviousLastMessages=await admin.firestore().collection('PERRINNMessages').where('tag','==',messageData.tag).where('tagLastMessage','==',true).get()
      let tagLastMessage=true
      tagPreviousLastMessages.forEach(message=>{
        if(message.data().serverTimestamp<messageData.serverTimestamp&&messageId!=message.id){
          batch.update(admin.firestore().doc('PERRINNMessages/'+message.id),{tagLastMessage:false})
          tagPreviousMessageData=message.data()
        } else if (message.data().serverTimestamp>messageData.serverTimestamp&&messageId!=message.id) {
          tagLastMessage=false
        }
      })
      batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{tag:messageData.tag})
      batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{tagLastMessage:tagLastMessage})

      //settings
      batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{isSettings:messageData.chain==user})

      //message recipientList (merge with user, transactionOut user, previous chat list and remove duplicates and remove undefined and null and remove from the ToBeRemoved list)
      messageData.recipientList=[user].concat([(messageData.transactionOut||{}).user]||[]).concat(messageData.recipientList||[]).concat(chatPreviousMessageData.recipientList||[])
      messageData.recipientList=messageData.recipientList.filter((item,pos)=>messageData.recipientList.indexOf(item)===pos)
      messageData.recipientList.indexOf('undefined')!=-1&&messageData.recipientList.splice(messageData.recipientList.indexOf('undefined'),1)
      messageData.recipientList.indexOf(null)!=-1&&messageData.recipientList.splice(messageData.recipientList.indexOf(null),1)
      if(messageData.recipientListToBeRemoved)messageData.recipientListToBeRemoved.forEach(recipientToBeRemoved=>{
        const index=messageData.recipientList.indexOf(recipientToBeRemoved)
        if(index>-1)messageData.recipientList.splice(index,1)
      })
      batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{recipientList:messageData.recipientList||[]},{create:true})

      //message recipients data
      var reads=[]
      messageData.recipientList.forEach(recipient=>{
        if(recipient!=user)reads.push(admin.firestore().collection('PERRINNMessages').where('user','==',recipient||null).where('verified','==',true).orderBy('serverTimestamp','desc').limit(1).get())
      })
      const recipientsObj=await Promise.all(reads)
      recipientsObj.forEach((recipient)=>{
        if(recipient.docs[0]!=undefined)batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{[`recipients.${recipient.docs[0].data().user}.name`]:(recipient.docs[0].data()||{}).name||null},{create:true})
        if(recipient.docs[0]!=undefined)batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{[`recipients.${recipient.docs[0].data().user}.imageUrlThumb`]:(recipient.docs[0].data()||{}).imageUrlThumbUser||null},{create:true})
        if(recipient.docs[0]!=undefined)batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{[`recipients.${recipient.docs[0].data().user}.unreadMessages`]:((chatPreviousMessageData.reads||{})[recipient.docs[0].data().user]||null)?1:(((((chatPreviousMessageData.recipients||{})[recipient.docs[0].data().user]||{}).unreadMessages||1)+1)||null)},{create:true})
      })

      //*******SURVEY**********
      let survey={}
      survey.durationDays=((messageData.survey||{}).durationDays)||((chatPreviousMessageData.survey||{}).durationDays)||null
      survey.question=((messageData.survey||{}).question)||((chatPreviousMessageData.survey||{}).question)||null
      survey.answers=((messageData.survey||{}).answers)||((chatPreviousMessageData.survey||{}).answers)||[]
      survey.createdTimestamp=((messageData.survey||{}).createdTimestamp)||((chatPreviousMessageData.survey||{}).createdTimestamp)||null
      survey.expiryTimestamp=(survey.createdTimestamp+survey.durationDays*24*3600000)||null
      survey.voteIndexPlusOne=((messageData.survey||{}).voteIndexPlusOne)||null
      survey.totalVotes=0
      if (!survey.createdTimestamp&&survey.question)survey.createdTimestamp=now
      survey.answers.forEach((answer,i)=>{
        if(!survey.answers[i].votes)survey.answers[i].votes=[]
        if(survey.voteIndexPlusOne==(i+1)&&!survey.answers[i].votes.includes(user))survey.answers[i].votes.push(user)
        if(survey.voteIndexPlusOne&&survey.voteIndexPlusOne!=(i+1)&&survey.answers[i].votes.includes(user))survey.answers[i].votes.splice(survey.answers[i].votes.indexOf(user),1)
        survey.totalVotes+=survey.answers[i].votes.length
        answer.votes.forEach(voteUser=>{
          batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{[`recipients.${voteUser}.voteIndexPlusOne`]:i+1},{create:true})
        })
      })

      //*******INSTANT CREDIT/DEBIT*********************
        //message transaction out
        let transactionOut={}
        const transactionOutUserLastMessages=await admin.firestore().collection('PERRINNMessages').where('user','==',(messageData.transactionOut||{}).user||null).where('verified','==',true).orderBy('serverTimestamp','desc').limit(1).get()
        let transactionOutUserLastMessageData=(transactionOutUserLastMessages.docs[0]!=undefined)?(transactionOutUserLastMessages.docs[0]||{}).data():{}
        transactionOut.user=(messageData.transactionOut||{}).user||null
        transactionOut.message=(messageData.transactionOut||{}).message||null
        transactionOut.name=transactionOutUserLastMessageData.name||null
        transactionOut.imageUrlThumb=transactionOutUserLastMessageData.imageUrlThumbUser||null
        transactionOut.amount=Number(((messageData.transactionOut||{}).amount)||0)
        transactionOut.code=(messageData.transactionOut||{}).code||null
        transactionOut.amountCummulate=Number(((userPreviousMessageData.transactionOut||{}).amountCummulate)||0)+transactionOut.amount
        if(transactionOut.code=='PERRINNselfTRANSACTION'&&user=='QYm5NATKa6MGD87UpNZCTl6IolX2'){
          transactionOut.user='QYm5NATKa6MGD87UpNZCTl6IolX2'
          transactionOut.name=messageData.name||userPreviousMessageData.name||null
          transactionOut.imageUrlThumb=messageData.imageUrlThumbUser||userPreviousMessageData.imageUrlThumbUser||null
        }
        //message transaction in
        let transactionIn={}
        const transactionInUserLastMessages=await admin.firestore().collection('PERRINNMessages').where('user','==',(messageData.transactionIn||{}).user||null).where('verified','==',true).orderBy('serverTimestamp','desc').limit(1).get()
        let transactionInUserLastMessageData=(transactionInUserLastMessages.docs[0]!=undefined)?(transactionInUserLastMessages.docs[0]||{}).data():{}
        transactionIn.user=(messageData.transactionIn||{}).user||null
        transactionIn.message=(messageData.transactionIn||{}).message||null
        transactionIn.name=transactionInUserLastMessageData.name||null
        transactionIn.imageUrlThumb=transactionInUserLastMessageData.imageUrlThumbUser||null
        transactionIn.amount=Number(((messageData.transactionIn||{}).amount)||0)
        if(transactionOut.code=='PERRINN'&&user=='QYm5NATKa6MGD87UpNZCTl6IolX2')transactionIn.amount=transactionOut.amount
        if(transactionOut.code=='PERRINNselfTRANSACTION'&&user=='QYm5NATKa6MGD87UpNZCTl6IolX2'){
          transactionIn.amount=transactionOut.amount
        }
        transactionIn.amountCummulate=Number(((userPreviousMessageData.transactionIn||{}).amountCummulate)||0)+transactionIn.amount
        if(transactionIn.message&&transactionIn.amount>0&&transactionIn.user)batch.update(admin.firestore().doc('PERRINNMessages/'+transactionIn.message),{"transactionOut.message":messageId},{create:true})
        //COIN Purchase
        let purchaseCOIN={}
        purchaseCOIN.chargeID=(messageData.purchaseCOIN||{}).chargeID||null
        purchaseCOIN.amount=((messageData.purchaseCOIN||{}).amount)||0
        purchaseCOIN.amountCummulate=(((userPreviousMessageData.purchaseCOIN||{}).amountCummulate)||0)+purchaseCOIN.amount
        //contract
        let contract={}
        contract.position=(messageData.contract||{}).position||(userPreviousMessageData.contract||{}).position||null
        contract.level=((messageData.contract||{}).level)||((userPreviousMessageData.contract||{}).level)||0
        contract.message=(messageData.contract||{}).message||(userPreviousMessageData.contract||{}).message||null
        if(contract.level!=(((userPreviousMessageData.contract||{}).level)||0)||contract.position!=((userPreviousMessageData.contract||{}).position||null))contract.createdTimestamp=now
        else contract.createdTimestamp=(userPreviousMessageData.contract||{}).createdTimestamp||null
        contract.amount=0
        contract.signed=false
        contract.hoursDeclared=0
        contract.hoursAvailable=0
        contract.hoursValidated=0
        contract.levelTimeAdjusted=null
        contract.hourlyRate=0
        if(contract.level&&contract.position&&contract.message&&contract.createdTimestamp){
          const contractSignatureMessage=await admin.firestore().doc('PERRINNMessages/'+contract.message).get()
          let contractSignatureMessageData=(contractSignatureMessage!=undefined)?(contractSignatureMessage||{}).data():{}
          if((contractSignatureMessageData.user=='QYm5NATKa6MGD87UpNZCTl6IolX2')
            &&(((contractSignatureMessageData.contractSignature||{}).user||null)==user)
            &&((((contractSignatureMessageData.contractSignature||{}).contract||{}).createdTimestamp||null)<=contract.createdTimestamp)
            &&((((contractSignatureMessageData.contractSignature||{}).contract||{}).level||null)==contract.level)
          ){
            contract.signed=true
            contract.signedLevel=((contractSignatureMessageData.contractSignature||{}).contract||{}).level||null
            contract.levelTimeAdjusted=Math.min(10,Number(contract.level)+(now-contract.createdTimestamp)/3600000/24/365)
            contract.hourlyRate=appSettingsContract.data().hourlyRateLevel1*contract.levelTimeAdjusted
            contract.previousContractMessageHoursAvailable=((userPreviousMessageData.contract||{}).previousContractMessageHoursAvailable)||0
            contract.previousContractMessageServerTimestamp=((userPreviousMessageData.contract||{}).previousContractMessageServerTimestamp)||messageData.serverTimestamp
            contract.hoursSincePreviousContractMessage=(messageData.serverTimestamp.seconds-contract.previousContractMessageServerTimestamp.seconds)/3600
            contract.hoursDeclared=((messageData.text||"").match(/^[>]*/)||[""])[0].length
            contract.hoursAvailable=Math.min(appSettingsContract.data().hoursAvailable24HoursWindow,contract.previousContractMessageHoursAvailable+contract.hoursSincePreviousContractMessage*appSettingsContract.data().hoursAvailable24HoursWindow/24)
            contract.hoursValidated=Math.min(contract.hoursDeclared,contract.hoursAvailable)
            contract.amount=contract.hoursValidated*contract.hourlyRate
            contract.previousContractMessageHoursAvailable=contract.hoursAvailable-contract.hoursValidated
            contract.previousContractMessageServerTimestamp=messageData.serverTimestamp
          }
        }
        contract.hoursTotal=(((userPreviousMessageData.contract||{}).hoursTotal)||0)+contract.hoursValidated
        contract.amountCummulate=(((userPreviousMessageData.contract||{}).amountCummulate)||0)+contract.amount
        //message wallet
        let wallet={}
        wallet.previousBalance=((userPreviousMessageData.wallet||{}).balance)||0
        wallet.balance=wallet.previousBalance
        wallet.balance=Math.round((Number(wallet.balance)-Number(transactionOut.amount))*100000)/100000
        wallet.balance=Math.round((Number(wallet.balance)+Number(transactionIn.amount))*100000)/100000
        wallet.balance=Math.round((Number(wallet.balance)+Number(purchaseCOIN.amount))*100000)/100000
        wallet.balance=Math.round((Number(wallet.balance)+Number(contract.amount))*100000)/100000
        wallet.balance=Math.max(0,wallet.balance)

      //*******TIME BASED INTEREST*************************
        let interest={}
        interest.rateYear=((messageData.interest||{}).rateYear)||appSettingsCosts.data().interestRateYear
        interest.days=(now/1000/3600/24-(userPreviousMessageData.verifiedTimestamp||{}).seconds/3600/24)||0
        interest.amountBase=wallet.balance
        interest.amount=Math.max(0,interest.amountBase*(Math.exp(interest.rateYear/365*interest.days)-1))
        interest.amountCummulate=(((userPreviousMessageData.interest||{}).amountCummulate)||0)+interest.amount
        wallet.balance=Math.round((Number(wallet.balance)+Number((interest.amount)||0))*100000)/100000

      //*******PERRINN Limited*************************
        let PERRINNLimited={}
        if(appSettingsPERRINNLimited.data().shares[user]){
          PERRINNLimited.shares=appSettingsPERRINNLimited.data().shares[user]
          PERRINNLimited.sharesDistribution=PERRINNLimited.shares/appSettingsPERRINNLimited.data().sharesTotal
          PERRINNLimited.rateYear=appSettingsCosts.data().interestRateYear
          PERRINNLimited.shareToCOINDays=(now/1000/3600/24-appSettingsPERRINNLimited.data().shareToCOINTimestamp.seconds/3600/24)||0
          PERRINNLimited.shareToCOIN=Math.max(0,appSettingsPERRINNLimited.data().shareToCOIN*(Math.exp(PERRINNLimited.rateYear/365*PERRINNLimited.shareToCOINDays)))
          PERRINNLimited.amountTotal=appSettingsPERRINNLimited.data().sharesTotal*PERRINNLimited.shareToCOIN
          PERRINNLimited.loanAmountTotal=appSettingsPERRINNLimited.data().loanGBPTotal*appSettingsPayment.data().currencyList['gbp'].toCOIN
          PERRINNLimited.loanAmount=(appSettingsPERRINNLimited.data().loanGBP[user]*appSettingsPayment.data().currencyList['gbp'].toCOIN)||0
          PERRINNLimited.amount=(PERRINNLimited.amountTotal-PERRINNLimited.loanAmountTotal)*PERRINNLimited.sharesDistribution+PERRINNLimited.loanAmount
        }

      //*******PERRINN Share*************************
        let share={}
        share.amount=wallet.balance+(PERRINNLimited.amount||0)

      //*******TIME BASED CREDIT/DEBIT**********************
        //PERRINN membership
        if(wallet.balance>0){
          googleUtils.googleGroupMemberInsert(userEmail)
          onshapeUtils.onshapeTeamMemberPost(userEmail)
        }

      //user status
        let userStatus={}
        userStatus.isMember=false
        if(wallet.balance>0)userStatus.isMember=true

      //*******MESSAGE WRITES**********************
        //message event
        batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{eventDate:messageData.eventDate||chatPreviousMessageData.eventDate||null},{create:true})
        batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{eventDescription:messageData.eventDescription||chatPreviousMessageData.eventDescription||null},{create:true})
        //message objects
        batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{userChain:userChain},{create:true})
        batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{purchaseCOIN:purchaseCOIN},{create:true})
        batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{transactionOut:transactionOut},{create:true})
        batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{transactionIn:transactionIn},{create:true})
        batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{contract:contract},{create:true})
        batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{interest:interest},{create:true})
        batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{wallet:wallet},{create:true})
        batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{userStatus:userStatus},{create:true})
        batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{survey:survey},{create:true})
        batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{PERRINNLimited:PERRINNLimited},{create:true})
        batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{share:share},{create:true})
        //message verified
        batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{verified:true},{create:true})
        batch.update(admin.firestore().doc('PERRINNMessages/'+messageId),{verifiedTimestamp:admin.firestore.FieldValue.serverTimestamp()},{create:true})

        await batch.commit()

      //*******MESSAGES CREATION**********
        //transaction out
        if(!transactionOut.message&&transactionOut.amount>0&&transactionOut.user){
          createMessageUtils.createMessageAFS({
            user:transactionOut.user,
            text:transactionOut.amount+" COINS received",
            chain:messageData.chain,
            transactionIn:{
              user:user,
              message:messageId,
              amount:transactionOut.amount
            }
          })
        }

        //contract Signature
        if((messageData.contractSignature||{}).user||null){
          const contractSignatureUserLastMessage=await admin.firestore().collection('PERRINNMessages').where('user','==',messageData.contractSignature.user).where('verified','==',true).orderBy('serverTimestamp','desc').limit(1).get()
          createMessageUtils.createMessageAFS({
            user:messageData.contractSignature.user,
            text:'Contract signed',
            chain:messageData.contractSignature.user,
            contract:{
              message:messageId
            }
          })
        }

        //user state snapshot
        if(interest.rateYear!=appSettingsCosts.data().interestRateYear){
          createMessageUtils.createMessageAFS({
            user:user,
            text:'Taking a snapshot of user state',
            chain:'PERRINNUsersStateSnapshot',
          })
        }

      return {
        user:user,
        userEmail:userEmail||null,
        wallet:wallet,
        transactionIn:transactionIn,
        transactionOut:transactionOut,
        purchaseCOIN:purchaseCOIN,
        contract:contract,
        interest:interest,
        userStatus:userStatus,
        PERRINNLimited:PERRINNLimited,
        share:share
      }

    }
    catch(error){
      console.log('user '+user+' error '+error)
      return admin.firestore().doc('PERRINNMessages/'+messageId).update({verified:false})
    }

  },

}
