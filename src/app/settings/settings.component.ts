import { Component } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { UserInterfaceService } from '../userInterface.service';
import { AngularFireStorage } from '@angular/fire/compat/storage';
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';

@Component({
  selector: 'settings',
  templateUrl: 'settings.component.html'
})
export class SettingsComponent {
  name:string
  userPresentation:string
  emailsAuth:string
  contract:any
  searchFilter:string
  publicLink:any

  constructor(
    public afAuth:AngularFireAuth,
    public afs:AngularFirestore,
    private storage:AngularFireStorage,
    public UI:UserInterfaceService
  ) {
    this.contract={}
    this.name=(this.UI.currentUserLastMessageObj||{}).name||null
    this.userPresentation=(this.UI.currentUserLastMessageObj||{}).userPresentation||null
    this.publicLink=(this.UI.currentUserLastMessageObj||{}).publicLink||null
    this.emailsAuth=((this.UI.currentUserLastMessageObj||{}).emails||{}).auth||null
    this.contract.level=((this.UI.currentUserLastMessageObj||{}).contract||{}).level||null
  }

  ngOnInit() {
    this.afAuth.user.subscribe((auth) => {
      if (!auth) return;
      this.afs
        .collection<any>('PERRINNMessages', (ref) =>
          ref
            .where('user', '==', auth.uid)
            .where('verified', '==', true)
            .orderBy('serverTimestamp', 'desc')
            .limit(1)
        )
        .valueChanges()
        .subscribe((snapshot) => {
          const profile = (snapshot && snapshot[0]) || {};
          this.name = profile.name || null;
          this.userPresentation = profile.userPresentation || null;
          this.publicLink = profile.publicLink || null;
          this.emailsAuth = (profile.emails || {}).auth || null;
          this.contract.level = (profile.contract || {}).level || null;
        });
    });
  }

  updateName(){
    if(!this.name)return
    this.UI.createMessage({
      chain:this.UI.currentUser,
      text:'Updating my name to '+this.name,
      name:this.name
    })
    this.UI.currentUserLastMessageObj = {
      ...(this.UI.currentUserLastMessageObj || {}),
      name: this.name
    }
  }

  updateUserCurrency(currency){
    if(!currency)return
    this.UI.createMessage({
      chain:this.UI.currentUser,
      text:'Updating my preferred currency to '+((this.UI.PERRINNAdminLastMessageObj?.currencyList||{})[currency]||{}).designation,
      userCurrency:currency
    })
    this.UI.currentUserLastMessageObj = {
      ...(this.UI.currentUserLastMessageObj || {}),
      userCurrency: currency
    }
  }

  updateUserPresentation(){
    if(!this.userPresentation)return
    this.UI.createMessage({
      chain:this.UI.currentUser,
      text:'Updating my presentation to '+this.userPresentation,
      userPresentation:this.userPresentation
    })
    this.UI.currentUserLastMessageObj = {
      ...(this.UI.currentUserLastMessageObj || {}),
      userPresentation: this.userPresentation
    }
  }

  updatePublicLink(){
    if(this.publicLink==(this.UI.currentUserLastMessageObj.publicLink||null))return
    this.UI.createMessage({
      chain:this.UI.currentUser,
      text:'Updating my public link.',
      publicLink:this.publicLink
    })
    this.UI.currentUserLastMessageObj = {
      ...(this.UI.currentUserLastMessageObj || {}),
      publicLink: this.publicLink
    }
  }

  updateEmails(){
    if(this.emailsAuth!=this.UI.currentUserLastMessageObj.emails.auth){
      this.UI.createMessage({
        chain:this.UI.currentUser,
        text:'Updating my email addresses.',
        emails:{
          auth:this.emailsAuth
        }
      })
      this.UI.currentUserLastMessageObj = {
        ...(this.UI.currentUserLastMessageObj || {}),
        emails: {
          ...((this.UI.currentUserLastMessageObj || {}).emails || {}),
          auth: this.emailsAuth
        }
      }
      return
    }
    else return
  }

  updateContract(){
    const level = Number(this.contract.level);
    if(!(level >= 1 && level <= 10)) return;
    this.UI.createMessage({
      chain:this.UI.currentUser,
      text:'Updating my contract details to level '+level,
      contract:{
        level:level
      }
    })
    this.UI.currentUserLastMessageObj = {
      ...(this.UI.currentUserLastMessageObj || {}),
      contract: {
        ...((this.UI.currentUserLastMessageObj || {}).contract || {}),
        level: level
      }
    }
  }

  isValidEmail(email: string): boolean {
    if (!email) return false;
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  }

  onContractLevelInput(event: Event) {
    const inputElement = event.target as HTMLInputElement;
    const digitsOnlyValue = (inputElement.value || '').replace(/\D/g, '').slice(0, 2);
    inputElement.value = digitsOnlyValue;
    this.contract.level = digitsOnlyValue;
  }

  addChild(team){
  }

  onImageChange(event:any) {
    const image = event.target.files[0];
    const uploader = document.getElementById('uploader') as HTMLInputElement;
    const storageRef = this.storage.ref('images/'+Date.now()+image.name);
    const task = storageRef.put(image);

    task.snapshotChanges().subscribe((snapshot) => {
      document.getElementById('buttonFile').style.visibility = 'hidden';
      document.getElementById('uploader').style.visibility = 'visible';

      const percentage = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
      uploader.value = percentage.toString();
    },
    (err:any) => {
      document.getElementById('buttonFile').style.visibility = 'visible';
      document.getElementById('uploader').style.visibility = 'hidden';
      uploader.value = '0';
    },
    () => {
      uploader.value = '0';
      document.getElementById('buttonFile').style.visibility = 'visible';
      document.getElementById('uploader').style.visibility = 'hidden';
      let imageTimestamp = task.task.snapshot.ref.name.substring(0, 13);
      storageRef.getDownloadURL().subscribe(url => {
        this.UI.createMessage({
          chain:this.UI.currentUser,
          text:'updating my profile picture',
          userImageTimestamp:imageTimestamp,
          chatImageTimestamp:imageTimestamp,
          chatImageUrlThumb:url,
          chatImageUrlMedium:url,
          chatImageUrlOriginal:url,
          imageUrlThumbUser:url,
          imageUrlMedium:url,
          imageUrlOriginal:url
        })
        this.UI.currentUserLastMessageObj = {
          ...(this.UI.currentUserLastMessageObj || {}),
          userImageTimestamp:imageTimestamp,
          imageUrlThumbUser:url,
          imageUrlMedium:url,
          imageUrlOriginal:url
        }
      });
    });
  }

  objectToArray(obj) {
    if (obj == null) { return []; }
    return Object.keys(obj).map(function(key) {
      return [key, obj[key]];
    });
  }

}
