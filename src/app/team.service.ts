import { EnvironmentInjector, Injectable, runInInjectionContext } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { BehaviorSubject, firstValueFrom } from 'rxjs';

export interface TeamContributor {
  key: string;
  values: {
    user: string;
    name?: string;
    userPresentation?: string;
    imageUrlThumbUser?: string;
    imageUrlMedium?: string;
    imageUrlOriginal?: string;
    wallet?: { balance?: number };
    contract?: { signed?: boolean; levelTimeAdjusted?: number };
    publicLink?: string;
  };
}

// Search uses loaded pages and preserves the Firestore balance ordering.
export function selectContributors(people: TeamContributor[], query: string) {
  const search = query.trim().toLocaleLowerCase();
  return people.filter(person => `${person.values.name || ''} ${person.values.userPresentation || ''}`.toLocaleLowerCase().includes(search));
}

@Injectable()
export class TeamService {
  private people = new BehaviorSubject<TeamContributor[]>([]);
  readonly people$ = this.people.asObservable();
  loading = false;
  error = false;
  hasMore = true;
  private cursor: unknown;

  constructor(private afs: AngularFirestore, private injector: EnvironmentInjector) {}

  async loadMore(): Promise<void> {
    if (this.loading || !this.hasMore) return;
    this.loading = true;
    this.error = false;
    try {
      const page = await runInInjectionContext(this.injector, () => firstValueFrom(
        this.afs.collection<TeamContributor['values']>('PERRINNMessages', ref => {
          let query = ref.where('userChain.nextMessage', '==', 'none')
            .where('verified', '==', true)
            .where('wallet.balance', '>', 0).orderBy('wallet.balance', 'desc');
          if (this.cursor) query = query.startAfter(this.cursor);
          return query.limit(200);
        }).get()
      ));
      const loaded = new Map(this.people.value.map(person => [person.key, person]));
      page.docs.forEach(doc => loaded.set(doc.id, { key: doc.id, values: doc.data() }));
      this.people.next([...loaded.values()]);
      this.cursor = page.docs[page.docs.length - 1];
      this.hasMore = page.size === 200;
    } catch {
      this.error = true;
    } finally {
      this.loading = false;
    }
  }
}
