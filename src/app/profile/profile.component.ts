import { Component } from '@angular/core'
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/compat/firestore'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { Router, ActivatedRoute } from '@angular/router'
import { UserInterfaceService } from './../userInterface.service'
import { AngularFireAuth } from '@angular/fire/compat/auth'
import firebase from 'firebase/compat/app'

@Component({
  selector:'profile',
  templateUrl:'./profile.component.html',
})

export class ProfileComponent {
  messages:Observable<any[]>
  comingEvents:Observable<any[]>
  currentFunds:Observable<any[]>
  currentSurveys:Observable<any[]>
  latestImages:Observable<any[]>
  tags:Observable<any[]>
  scrollTeam:string
  focusUserLastMessageObj:any
  scope:string
  mode:string
  previousBalance:string
  previousTimestamp:string
  previousIndex:string
  previousPurchaseCOINAmountCummulate:number
  previousContractAmountCummulate:number
  previousAmountInterestCummulate:number
  previousAmountTransactionCummulate:number
  math:any
  messageNumberDisplay:number
  showTags:boolean

  constructor(
    public afAuth:AngularFireAuth,
    public afs:AngularFirestore,
    public router:Router,
    public UI:UserInterfaceService,
    private route:ActivatedRoute
  ) {
    this.showTags=false
    this.math=Math
    this.messageNumberDisplay=30
    this.scope=''
    this.mode='inbox'
    this.scrollTeam=''
    this.route.params.subscribe(params => {
      this.scope=params.id
      afs.collection<any>('PERRINNMessages',ref=>ref
        .where('user','==',this.scope)
        .where('verified','==',true)
        .orderBy('serverTimestamp','desc').limit(1)
      ).valueChanges().subscribe(snapshot=>{
        this.focusUserLastMessageObj=snapshot[0]
      })
      this.tags=this.afs.collection<any>('PERRINNMessages',ref=>ref
        .where('lastMessage','==',true)
        .where('tagLastMessage','==',true)
        .where('verified','==',true)
        .orderBy('tag','asc')
      ).snapshotChanges().pipe(map(changes=>{
        return changes.map(c=>({payload:c.payload}))
      }))
      this.refreshMessages()
    })
  }

  ngOnInit() {
  }

  refreshMessages(){
    this.UI.loading=true
    if(this.scope=='all'){
      if(this.UI.tagFilters.length==0){
        this.comingEvents=this.afs.collection<any>('PERRINNMessages',ref=>ref
          .where('lastMessage','==',true)
          .where('verified','==',true)
          .orderBy('eventDateEnd')
          .where('eventDateEnd','>',this.UI.nowSeconds*1000)
        ).snapshotChanges().pipe(map(changes=>{
          return changes.map(c=>({payload:c.payload}))
        }))
        this.currentFunds=this.afs.collection<any>('PERRINNMessages',ref=>ref
          .where('lastMessage','==',true)
          .where('verified','==',true)
          .where('fund.active','==',true)
          .orderBy('fund.daysLeft','asc')
        ).snapshotChanges().pipe(map(changes=>{
          return changes.map(c=>({payload:c.payload}))
        }))
        this.currentSurveys=this.afs.collection<any>('PERRINNMessages',ref=>ref
          .where('lastMessage','==',true)
          .where('verified','==',true)
          .orderBy('survey.expiryTimestamp')
          .where('survey.expiryTimestamp','>=',this.UI.nowSeconds*1000)
        ).snapshotChanges().pipe(map(changes=>{
          return changes.map(c=>({payload:c.payload}))
        }))
        this.latestImages=this.afs.collection<any>('PERRINNMessages',ref=>ref
          .where('verified','==',true)
          .orderBy('chatImageTimestamp','desc')
          .limit(5)
        ).snapshotChanges().pipe(map(changes=>{
          return changes.map(c=>({payload:c.payload}))
        }))
        this.messages=this.afs.collection<any>('PERRINNMessages',ref=>ref
          .where('lastMessage','==',true)
          .where('verified','==',true)
          .orderBy('serverTimestamp','desc')
          .limit(this.messageNumberDisplay)
        ).snapshotChanges().pipe(map(changes=>{
          this.UI.loading=false
          return changes.map(c=>({payload:c.payload}))
        }))
      }
      else{
        this.comingEvents=this.afs.collection<any>('PERRINNMessages',ref=>ref
          .where('lastMessage','==',true)
          .where('tag','in',this.UI.tagFilters)
          .where('verified','==',true)
          .orderBy('eventDateEnd')
          .where('eventDateEnd','>',this.UI.nowSeconds*1000)
        ).snapshotChanges().pipe(map(changes=>{
          return changes.map(c=>({payload:c.payload}))
        }))
        this.currentFunds=this.afs.collection<any>('PERRINNMessages',ref=>ref
          .where('lastMessage','==',true)
          .where('tag','in',this.UI.tagFilters)
          .where('verified','==',true)
          .where('fund.active','==',true)
          .orderBy('fund.daysLeft','asc')
        ).snapshotChanges().pipe(map(changes=>{
          return changes.map(c=>({payload:c.payload}))
        }))
        this.currentSurveys=this.afs.collection<any>('PERRINNMessages',ref=>ref
          .where('lastMessage','==',true)
          .where('tag','in',this.UI.tagFilters)
          .where('verified','==',true)
          .orderBy('survey.expiryTimestamp')
          .where('survey.expiryTimestamp','>=',this.UI.nowSeconds*1000)
        ).snapshotChanges().pipe(map(changes=>{
          return changes.map(c=>({payload:c.payload}))
        }))
        this.latestImages=this.afs.collection<any>('PERRINNMessages',ref=>ref
          .where('verified','==',true)
          .where('tag','in',this.UI.tagFilters)
          .orderBy('chatImageTimestamp','desc')
          .limit(5)
        ).snapshotChanges().pipe(map(changes=>{
          return changes.map(c=>({payload:c.payload}))
        }))
        this.messages=this.afs.collection<any>('PERRINNMessages',ref=>ref
          .where('lastMessage','==',true)
          .where('tag','in',this.UI.tagFilters)
          .where('verified','==',true)
          .orderBy('serverTimestamp','desc')
          .limit(this.messageNumberDisplay)
        ).snapshotChanges().pipe(map(changes=>{
          this.UI.loading=false
          return changes.map(c=>({payload:c.payload}))
        }))
      }
    }
    else if(this.mode=='30days'){
      this.messages=this.afs.collection<any>('PERRINNMessages',ref=>ref
        .where('user','==',this.scope)
        .where('verified','==',true)
        .where('userChain.newDay','==',true)
        .orderBy('serverTimestamp','desc')
        .limit(this.messageNumberDisplay)
      ).snapshotChanges().pipe(map(changes=>{
        this.UI.loading=false
        return changes.reverse().map(c=>({payload:c.payload}))
      }))
    }
    else if(this.mode=='24months'){
      this.messages=this.afs.collection<any>('PERRINNMessages',ref=>ref
        .where('user','==',this.scope)
        .where('verified','==',true)
        .where('userChain.newMonth','==',true)
        .orderBy('serverTimestamp','desc')
        .limit(24)
      ).snapshotChanges().pipe(map(changes=>{
        this.UI.loading=false
        return changes.reverse().map(c=>({payload:c.payload}))
      }))
    }
    else if(this.mode=='chain'){
      this.messages=this.afs.collection<any>('PERRINNMessages',ref=>ref
        .where('user','==',this.scope)
        .where('verified','==',true)
        .orderBy('serverTimestamp','desc')
        .limit(this.messageNumberDisplay)
      ).snapshotChanges().pipe(map(changes=>{
        this.UI.loading=false
        return changes.reverse().map(c=>({payload:c.payload}))
      }))
    }
    else{
      this.comingEvents=this.afs.collection<any>('PERRINNMessages',ref=>ref
        .where('recipientList','array-contains-any',[this.scope])
        .where('lastMessage','==',true)
        .where('verified','==',true)
        .orderBy('eventDateEnd')
        .where('eventDateEnd','>',this.UI.nowSeconds*1000)
      ).snapshotChanges().pipe(map(changes=>{
        return changes.map(c=>({payload:c.payload}))
      }))
      this.currentFunds=this.afs.collection<any>('PERRINNMessages',ref=>ref
        .where('recipientList','array-contains-any',[this.scope])
        .where('lastMessage','==',true)
        .where('verified','==',true)
        .where('fund.active','==',true)
        .orderBy('fund.daysLeft','asc')
      ).snapshotChanges().pipe(map(changes=>{
        return changes.map(c=>({payload:c.payload}))
      }))
      this.currentSurveys=this.afs.collection<any>('PERRINNMessages',ref=>ref
        .where('recipientList','array-contains-any',[this.scope])
        .where('lastMessage','==',true)
        .where('verified','==',true)
        .orderBy('survey.expiryTimestamp')
        .where('survey.expiryTimestamp','>=',this.UI.nowSeconds*1000)
      ).snapshotChanges().pipe(map(changes=>{
        return changes.map(c=>({payload:c.payload}))
      }))
      this.latestImages=this.afs.collection<any>('PERRINNMessages',ref=>ref
        .where('recipientList','array-contains-any',[this.scope])
        .where('verified','==',true)
        .orderBy('chatImageTimestamp','desc')
        .limit(5)
      ).snapshotChanges().pipe(map(changes=>{
        return changes.map(c=>({payload:c.payload}))
      }))
      this.messages=this.afs.collection<any>('PERRINNMessages',ref=>ref
        .where('recipientList','array-contains-any',[this.scope])
        .where('verified','==',true)
        .where('lastMessage','==',true)
        .orderBy('serverTimestamp','desc')
        .limit(this.messageNumberDisplay)
      ).snapshotChanges().pipe(map(changes=>{
        this.UI.loading=false
        return changes.map(c=>({payload:c.payload}))
      }))
    }
  }

  readFlagClick(messageId,readFlag){
    event.stopPropagation()
    if(readFlag)return this.afs.firestore.collection('PERRINNTeams').doc(this.UI.currentUser).collection('reads').doc(messageId).delete()
    return this.afs.firestore.collection('PERRINNTeams').doc(this.UI.currentUser).collection('reads').doc(messageId).set({
      serverTimestamp:firebase.firestore.FieldValue.serverTimestamp()
    })
  }

  newMessageToUser() {
    let ID=this.UI.newId()
    this.UI.createMessage({
      text:'Starting a new chat.',
      chain:ID,
      recipientList:[this.focusUserLastMessageObj.user]
    })
    this.router.navigate(['chat',ID])
  }

  storeMessageValues(message) {
    this.previousBalance=((message.wallet||{}).balance)||0
    this.previousTimestamp=message.verifiedTimestamp
    this.previousIndex=message.userChain.index
    this.previousPurchaseCOINAmountCummulate=(message.purchaseCOIN||{}).amountCummulate||0
    this.previousContractAmountCummulate=(message.contract||{}).amountCummulate||0
    this.previousAmountInterestCummulate=(message.interest||{}).amountCummulate||0
    this.previousAmountTransactionCummulate=((message.transactionIn||{}).amountCummulate||0)-((message.transactionOut||{}).amountCummulate||0)
  }

  signContract(){
    this.UI.createMessage({
      chain:this.focusUserLastMessageObj.user,
      text:'Contract signature for level '+((this.focusUserLastMessageObj.contract||{}).level||0),
      contractSignature:{
        user:this.focusUserLastMessageObj.user,
        contract:this.focusUserLastMessageObj.contract||{}
      }
    })
    this.router.navigate(['chat',this.focusUserLastMessageObj.user])
  }

  loadMore() {
    this.messageNumberDisplay+=15
    this.refreshMessages()
  }

}
