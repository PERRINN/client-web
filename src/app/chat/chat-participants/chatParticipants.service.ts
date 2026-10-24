import { EnvironmentInjector, Injectable, runInInjectionContext } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { firstValueFrom } from 'rxjs';
import firebase from 'firebase/compat/app';
import { PermissionsService } from '../../permissions.service';

export interface ChatParticipant { id: string; name: string; avatarName: string; avatar: string; balance?: number | null; }
interface ContributorRecord { user?: string; name?: string; imageUrlThumbUser?: string; wallet?: { balance?: number }; }
export interface ParticipantPage { people: ChatParticipant[]; cursor?: firebase.firestore.QueryDocumentSnapshot<ContributorRecord>; hasMore: boolean; }

@Injectable({ providedIn: 'root' })
export class ChatParticipantsService {
  constructor(private afs: AngularFirestore, private injector: EnvironmentInjector, private permissions: PermissionsService) {}

  async search(text: string, cursor?: ParticipantPage['cursor']): Promise<ParticipantPage> {
    const actor = this.permissions.current;
    if (!actor.ready || !actor.isAdmin) throw new Error('Admin permission is required.');
    const queryText = text.trim().toLowerCase();
    if (!queryText || queryText.length > 60) throw new Error('Enter a name up to 60 characters.');
    const snapshot = await firstValueFrom(runInInjectionContext(this.injector, () =>
      this.afs.collection<ContributorRecord>('PERRINNMessages', ref => {
        let query = ref.where('userChain.nextMessage', '==', 'none').where('verified', '==', true)
          .orderBy('nameLowerCase').startAt(queryText).endAt(queryText + '\uf8ff');
        if (cursor) query = query.startAfter(cursor);
        return query.limit(20);
      }).get({ source: 'server' })));
    if (this.permissions.current.uid !== actor.uid || !this.permissions.current.isAdmin) throw new Error('Your account changed.');
    const people = snapshot.docs.map(doc => doc.data()).filter(person => !!person.user).map(person => ({
      id: person.user!, name: person.name || 'Contributor', avatarName: person.name || 'Contributor', avatar: person.imageUrlThumbUser || '',
      balance: typeof person.wallet?.balance === 'number' && Number.isFinite(person.wallet.balance) ? person.wallet.balance : null
    }));
    return { people, cursor: snapshot.docs.at(-1), hasMore: snapshot.size === 20 };
  }
}
