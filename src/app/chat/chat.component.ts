import { Component } from '@angular/core'
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/compat/firestore'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { Router, ActivatedRoute } from '@angular/router'
import { UserInterfaceService } from '../userInterface.service'
import { AngularFireStorage } from '@angular/fire/compat/storage'
import firebase from 'firebase/compat/app'

@Component({
  selector:'chat',
  templateUrl:'./chat.component.html',
})

export class ChatComponent {
  draftMessage:string
  imageTimestamp:string
  imageDownloadUrl:string
  messageNumberDisplay:number
  lastChatVisitTimestamp:number
  scrollMessageTimestamp:number
  previousMessageServerTimestamp:any
  previousMessageUser:string
  messageShowDetails:[]
  messages:Observable<any[]>
  teams:Observable<any[]>
  searchFilter:string
  reads:any[]
  chatSubject:string
  chatLastMessageObj:any
  chatChain:string
  showChatDetails:boolean
  math:any
  eventDateList:any
  eventDateStart:any
  eventDateEnd:any
  eventDescription:string
  eventDuration:number
  eventLocation:string
  fund:any
  surveyDefault:any
  survey:any
  messageShowActions:[]
  lastRead:string
  showImageGallery:boolean

  constructor(
    public afs:AngularFirestore,
    public router:Router,
    public UI:UserInterfaceService,
    private route:ActivatedRoute,
    private storage:AngularFireStorage,
  ) {
    this.math=Math
    this.UI.loading=true
    this.reads=[]
    this.route.params.subscribe(params=>{
      this.lastRead=null
      this.chatChain=params.id
      this.messageShowActions=[]
      this.messageShowDetails=[]
      this.chatLastMessageObj={}
      this.previousMessageServerTimestamp={seconds:this.UI.nowSeconds*1000}
      this.previousMessageUser=''
      this.messageNumberDisplay=15
      this.chatSubject=''
      this.eventDescription=''
      this.eventDuration=1
      this.eventLocation=""
      this.fund={
        description:'add a description',
        amountGBPTarget:0,
        daysLeft:30
      }
      this.surveyDefault={
        question:'Survey question',
        durationDays:7,
        answers:[
          {answer:'Answer A',votes:[]},
          {answer:'Answer B',votes:[]},
          {answer:'Answer C',votes:[]}
        ]
      }
      this.survey=this.surveyDefault
      this.refreshMessages(params.id)
      this.refresheventDateList()
      this.resetChat()
    })
  }

  ngOnInit(){
    this.refreshSearchLists()
  }

  showImageGalleryClick(){
    event.stopPropagation()
    this.showImageGallery=!this.showImageGallery
    this.refreshMessages(this.chatLastMessageObj.chain||this.chatChain)
  }

  loadMore(){
    this.UI.loading=true
    this.messageNumberDisplay+=15
    this.refreshMessages(this.chatLastMessageObj.chain||this.chatChain)
  }

  refresheventDateList(){
    var i
    this.eventDateList=[]
    for(i=0;i<1010;i++){
      this.eventDateList[i]=(Math.ceil(this.UI.nowSeconds/3600)+i/2)*3600000
    }
  }

  refreshMessages(chain) {
    if(!this.showImageGallery)this.messages=this.afs.collection('PERRINNMessages',ref=>ref
      .where('chain','==',chain)
      .orderBy('serverTimestamp','desc')
      .limit(this.messageNumberDisplay)
    ).snapshotChanges().pipe(map(changes=>{
      this.UI.loading=false
      var batch=this.afs.firestore.batch()
      var nextMessageRead=true
      changes.forEach(c=>{
        if(this.UI.currentUser&&!this.lastRead&&!nextMessageRead&&(c.payload.doc.data()['reads']||[])[this.UI.currentUser])this.lastRead=c.payload.doc.id
        nextMessageRead=(c.payload.doc.data()['reads']||[])[this.UI.currentUser]
        if(c.payload.doc.data()['lastMessage']){
          if(this.UI.currentUser&&!this.reads.includes(c.payload.doc.id))batch.set(this.afs.firestore.collection('PERRINNTeams').doc(this.UI.currentUser).collection('reads').doc(c.payload.doc.id),{serverTimestamp:firebase.firestore.FieldValue.serverTimestamp()},{merge:true})
          this.reads.push(c.payload.doc.id)
          this.chatLastMessageObj=c.payload.doc.data()
          this.chatSubject=c.payload.doc.data()['chatSubject']
          this.eventDescription=c.payload.doc.data()['eventDescription']
          this.eventDateStart=c.payload.doc.data()['eventDateStart']
          this.eventDateEnd=c.payload.doc.data()['eventDateEnd']
          this.eventDuration=c.payload.doc.data()['eventDuration']
          this.eventLocation=c.payload.doc.data()['eventLocation']
          this.fund=c.payload.doc.data()['fund']||this.fund
          this.survey=((c.payload.doc.data()['survey']||{})['createdTimestamp'])?c.payload.doc.data()['survey']:this.survey
        }
      })
      batch.commit()
      return changes.reverse().map(c=>({
        key:c.payload.doc.id,
        payload:c.payload.doc.data()
      }))
    }))
    else this.messages=this.afs.collection('PERRINNMessages',ref=>ref
      .where('chain','==',chain)
      .orderBy('chatImageTimestamp','desc')
      .limit(this.messageNumberDisplay)
    ).snapshotChanges().pipe(map(changes=>{
      this.UI.loading=false
      var batch=this.afs.firestore.batch()
      var nextMessageRead=true
      changes.forEach(c=>{
        if(this.UI.currentUser&&!this.lastRead&&!nextMessageRead&&(c.payload.doc.data()['reads']||[])[this.UI.currentUser])this.lastRead=c.payload.doc.id
        nextMessageRead=(c.payload.doc.data()['reads']||[])[this.UI.currentUser]
        if(c.payload.doc.data()['lastMessage']){
          if(this.UI.currentUser&&!this.reads.includes(c.payload.doc.id))batch.set(this.afs.firestore.collection('PERRINNTeams').doc(this.UI.currentUser).collection('reads').doc(c.payload.doc.id),{serverTimestamp:firebase.firestore.FieldValue.serverTimestamp()},{merge:true})
          this.reads.push(c.payload.doc.id)
          this.chatLastMessageObj=c.payload.doc.data()
          this.chatSubject=c.payload.doc.data()['chatSubject']
          this.eventDescription=c.payload.doc.data()['eventDescription']
          this.eventDateStart=c.payload.doc.data()['eventDateStart']
          this.eventDuration=c.payload.doc.data()['eventDuration']
          this.eventLocation=c.payload.doc.data()['eventLocation']
          this.fund=c.payload.doc.data()['fund']||this.fund
          this.survey=((c.payload.doc.data()['survey']||{})['createdTimestamp'])?c.payload.doc.data()['survey']:this.survey
        }
      })
      batch.commit()
      return changes.map(c=>({
        key:c.payload.doc.id,
        payload:c.payload.doc.data()
      }))
    }))
  }

  isMessageNewTimeGroup(messageServerTimestamp:any) {
    let isMessageNewTimeGroup:boolean
    isMessageNewTimeGroup=Math.abs(messageServerTimestamp.seconds - this.previousMessageServerTimestamp.seconds) > 60 * 60 * 4
    return isMessageNewTimeGroup
  }

  isMessageNewUserGroup(user:any,messageServerTimestamp:any) {
    let isMessageNewUserGroup:boolean
    isMessageNewUserGroup=Math.abs(messageServerTimestamp.seconds - this.previousMessageServerTimestamp.seconds) > 60 * 5 || (user != this.previousMessageUser)
    return isMessageNewUserGroup
  }

  storeMessageValues(message) {
    this.previousMessageUser=message.user
    this.previousMessageServerTimestamp=message.serverTimestamp||{seconds:this.UI.nowSeconds*1000}
  }

  scrollToBottom(scrollMessageTimestamp:number) {
    if (scrollMessageTimestamp != this.scrollMessageTimestamp) {
      const element=document.getElementById('chat_window')
      element.scrollTop=element.scrollHeight
      this.scrollMessageTimestamp=scrollMessageTimestamp
    }
  }

  saveNewSubject() {
    this.UI.createMessage({
      text:'Changing subject to '+this.chatSubject,
      chain:this.chatLastMessageObj.chain||this.chatChain,
      chatSubject:this.chatSubject,
    })
    this.resetChat()
  }

  sendCredit(transactionAmount,transactionCode,transactionUser,transactionUserName){
    this.UI.createMessage({
      text:'sending '+this.UI.appSettingsPayment.currencyList[this.UI.currentUserLastMessageObj.userCurrency].symbol+transactionAmount+' to '+transactionUserName+((transactionCode||null)?' using code ':'')+((transactionCode||null)?transactionCode:''),
      chain:this.chatLastMessageObj.chain||this.chatChain,
      transactionOut:{
        user:transactionUser,
        amount:transactionAmount*this.UI.appSettingsPayment.currencyList[this.UI.currentUserLastMessageObj.userCurrency].toCOIN,
        code:transactionCode||null
      }
    })
    this.resetChat()
  }

  saveEvent() {
    this.UI.createMessage({
      text:'new event',
      chain:this.chatLastMessageObj.chain||this.chatChain,
      eventDateStart:this.eventDateStart,
      eventDateEnd:this.eventDateStart+this.eventDuration*3600000,
      eventDescription:this.eventDescription,
      eventDuration:this.eventDuration,
      eventLocation:this.eventLocation
    })
    this.resetChat()
  }

  cancelEvent() {
    this.UI.createMessage({
      text:'cancelling event',
      chain:this.chatLastMessageObj.chain||this.chatChain,
      eventDateStart:this.UI.nowSeconds*1000-3600000,
      eventDateEnd:this.UI.nowSeconds*1000-3600000
    })
    this.resetChat()
  }

  saveFund() {
    this.UI.createMessage({
      text:'edited fund',
      chain:this.chatLastMessageObj.chain||this.chatChain,
      fund:this.fund
    })
    this.resetChat()
  }

  saveSurvey() {
    this.UI.createMessage({
      text:'Survey saved',
      chain:this.chatLastMessageObj.chain||this.chatChain,
      survey:this.survey
    })
    this.resetChat()
  }

  voteSurvey(i) {
    this.UI.createMessage({
      text:'Survey vote '+this.survey.answers[i].answer,
      chain:this.chatLastMessageObj.chain||this.chatChain,
      survey:{voteIndexPlusOne:i+1}
    })
    this.resetChat()
  }

  addMessage() {
    this.UI.createMessage({
      text:this.draftMessage,
      chain:this.chatLastMessageObj.chain||this.chatChain,
      chatImageTimestamp:this.imageTimestamp,
      chatImageUrlThumb:this.imageDownloadUrl,
      chatImageUrlMedium:this.imageDownloadUrl,
      chatImageUrlOriginal:this.imageDownloadUrl
    })
    this.resetChat()
  }

  addRecipient(user,name) {
    this.UI.createMessage({
      text:'adding '+name+' to this chat.',
      chain:this.chatLastMessageObj.chain||this.chatChain,
      recipientList:[user]
    })
    this.resetChat()
  }

  removeRecipient(user,name){
    this.UI.createMessage({
      text:'removing '+name+' from this chat.',
      chain:this.chatLastMessageObj.chain||this.chatChain,
      recipientListToBeRemoved:[user]
    })
    this.resetChat()
  }

  onImageChange(event:any) {
    const image=event.target.files[0]
    const uploader=document.getElementById('uploader') as HTMLInputElement
    const storageRef=this.storage.ref('images/' + Date.now() + image.name)
    const task=storageRef.put(image)

    task.snapshotChanges().subscribe((snapshot)=>{
      document.getElementById('buttonFile').style.visibility='hidden'
      document.getElementById('uploader').style.visibility='visible'

      const percentage=(snapshot.bytesTransferred / snapshot.totalBytes) * 100
      uploader.value=percentage.toString()
    },
    (err:any)=>{
      document.getElementById('buttonFile').style.visibility='visible'
      document.getElementById('uploader').style.visibility='hidden'
      uploader.value='0'
    },
    ()=>{
      uploader.value='0'
      document.getElementById('buttonFile').style.visibility='visible'
      document.getElementById('uploader').style.visibility='hidden'
      this.imageTimestamp=task.task.snapshot.ref.name.substring(0, 13)
      storageRef.getDownloadURL().subscribe(url=>{
        this.imageDownloadUrl=url
        event.target.value=''
      })
    })
  }

  refreshSearchLists() {
    if (this.searchFilter) {
      if (this.searchFilter.length > 1) {
        this.teams=this.afs.collection('PERRINNMessages', ref=>ref
        .where('userChain.nextMessage','==','none')
        .where('verified','==',true)
        .where('nameLowerCase','>=',this.searchFilter.toLowerCase())
        .where('nameLowerCase','<=',this.searchFilter.toLowerCase()+'\uf8ff')
        .orderBy('nameLowerCase')
        .limit(20))
        .snapshotChanges().pipe(map(changes=>{
          return changes.map(c=>({
            key:c.payload.doc.id,
            values:c.payload.doc.data()
          }))
        }))
      }
    } else {
      this.teams=null
    }
  }

  resetChat(){
    this.searchFilter=null
    this.teams=null
    this.draftMessage=''
    this.imageTimestamp=null
    this.imageDownloadUrl=null
    this.showChatDetails=false
    this.messageShowDetails=[]
    this.messageShowActions=[]
  }

}
