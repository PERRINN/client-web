import { Injectable }    from '@angular/core'
import { AngularFireAuth } from '@angular/fire/auth'
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/firestore'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import * as firebase from 'firebase/app'
import { formatNumber } from '@angular/common'

@Injectable()
export class UserInterfaceService {
  loading:boolean
  currentUser:string
  currentUserLastMessageObj:any
  nowSeconds:number
  tagFilters:any

  constructor(
    private afAuth:AngularFireAuth,
    public afs:AngularFirestore
  ) {
    this.tagFilters=[]
    this.nowSeconds=Math.floor(Date.now()/1000)
    setInterval(()=>{this.nowSeconds=Math.floor(Date.now()/1000)},60000)
    this.afAuth.user.subscribe((auth) => {
      if (auth != null) {
        this.currentUser=auth.uid
        afs.collection<any>('PERRINNMessages',ref=>ref.where('user','==',this.currentUser).where('verified','==',true).orderBy('serverTimestamp','desc').limit(1)).valueChanges().subscribe(snapshot=>{
          this.currentUserLastMessageObj=snapshot[0]
        })
      } else {
        this.currentUser=null
      }
    })
  }

  createMessage(messageObj){
    if (!messageObj.text&&!messageObj.chatImageTimestamp) return null
    messageObj.serverTimestamp=firebase.firestore.FieldValue.serverTimestamp()
    messageObj.user=this.currentUser
    messageObj.name=messageObj.name||this.currentUserLastMessageObj.name||''
    messageObj.imageUrlThumbUser=messageObj.imageUrlThumbUser||this.currentUserLastMessageObj.imageUrlThumbUser||''
    messageObj.reads={[this.currentUser]:true}
    return this.afs.collection('PERRINNMessages').add(messageObj)
  }

  formatCOINS(amount){
    if(amount<100)return formatNumber(amount,"en-US","1.2-2")
    if(amount<1000)return formatNumber(amount,"en-US","1.1-1")
    if(amount<100000)return formatNumber(amount/1000,"en-US","1.1-1")+'K'
    if(amount<1000000)return formatNumber(amount/1000,"en-US","1.0-0")+'K'
    else return formatNumber(amount/1000000,"en-US","1.2-2")+'M'
  }

  formatSecondsToDhm2(seconds){
    seconds= Number(seconds)
    var d=Math.floor(seconds/(3600*24))
    var h=Math.floor(seconds%(3600*24)/3600)
    var m=Math.floor(seconds%3600/60)
    var dDisplay=d>0?d+'d ':''
    var hDisplay=h>0?h+'h ':''
    var mDisplay=(m>=0&&d==0)?m+'m ':''
    return dDisplay+hDisplay+mDisplay
  }

  formatSecondsToDhm1(seconds){
    seconds= Number(seconds)
    var d=Math.floor(seconds/(3600*24))
    var h=Math.floor(seconds%(3600*24)/3600)
    var m=Math.floor(seconds%3600/60)
    var dDisplay=d>0?d+'d ':''
    var hDisplay=(h>0&&d==0)?h+'h ':''
    var mDisplay=(m>=0&&d==0&&h==0)?m+'m ':''
    return dDisplay+hDisplay+mDisplay
  }

  newId():string{
    const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let autoId=''
    for(let i=0;i<20;i++){
      autoId+=chars.charAt(Math.floor(Math.random()*chars.length))
    }
    return autoId
  }

}
