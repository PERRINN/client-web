import { EnvironmentInjector, Injectable, runInInjectionContext } from '@angular/core';
import { AngularFireStorage } from '@angular/fire/compat/storage';
import { firstValueFrom } from 'rxjs';

export const imageUploadState = () => ({ busy: false, percent: null as number | null, error: '' });

@Injectable({ providedIn: 'root' })
export class ImageUploadService {
  constructor(private storage: AngularFireStorage, private injector: EnvironmentInjector) {}

  async upload(path: string, image: File, report: (percent: number | null) => void): Promise<string> {
    const ref = runInInjectionContext(this.injector, () => this.storage.ref(path));
    report(0);
    const task = runInInjectionContext(this.injector, () => ref.put(image));
    const progress = runInInjectionContext(this.injector, () => task.percentageChanges().subscribe({
      next: percent => { if (typeof percent === 'number' && Number.isFinite(percent)) report(Math.min(100, Math.max(0, Math.round(percent)))); },
      error: () => { /* Awaiting the upload task reports its failure to the caller. */ }
    }));
    try {
      await task;
      progress.unsubscribe();
      report(null);
      return await firstValueFrom(runInInjectionContext(this.injector, () => ref.getDownloadURL()));
    } finally { progress.unsubscribe(); }
  }
}
