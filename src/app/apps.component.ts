import { Component } from '@angular/core';
import { UserInterfaceService } from './userInterface.service';

interface AppLink {
  name: string;
  icon: string;
  description: string;
  url: string;
}

@Component({
  selector: 'app-apps',
  templateUrl: './apps.component.html',
  styleUrls: ['./apps.component.css'],
  standalone: false
})
export class AppsComponent {
  readonly externalApps: AppLink[] = [
    { name: 'WhatsApp', icon: 'chat', description: 'Connect with the PERRINN community.', url: 'https://chat.whatsapp.com/CzUNIrzBBuiI6lOCnh9DRx' },
    { name: 'YouTube', icon: 'smart_display', description: 'Watch videos and updates from the team.', url: 'https://www.youtube.com/@PERRINN424WeAreATeam' },
    { name: 'LinkedIn', icon: 'business', description: 'Follow PERRINN news and team updates.', url: 'https://www.linkedin.com/company/perrinn' },
    { name: 'GitHub', icon: 'code', description: 'Explore PERRINN projects and contribute.', url: 'https://github.com/PERRINN' }
  ];

  constructor(public UI: UserInterfaceService) {}
}
