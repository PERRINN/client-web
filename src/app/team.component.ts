import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable } from 'rxjs';
import { TeamContributor, TeamService, selectContributors } from './team.service';
import { UserInterfaceService } from './userInterface.service';

@Component({
  selector: 'app-team',
  templateUrl: './team.component.html',
  styleUrls: ['./team.component.css'],
  providers: [TeamService],
  standalone: false
})
export class TeamComponent implements OnInit {
  filteredMessages!: Observable<TeamContributor[]>;
  searchQuery = '';
  viewMode: 'cards' | 'list' = 'cards';
  private searchQuery$ = new BehaviorSubject('');

  constructor(public UI: UserInterfaceService, public team: TeamService) {}

  ngOnInit() {
    this.filteredMessages = combineLatest([
      this.team.people$, this.searchQuery$
    ]).pipe(map(([people, query]) => selectContributors(people, query)));
    void this.team.loadMore();
  }

  onSearchChange() {
    this.searchQuery$.next(this.searchQuery);
  }

  clearSearch() {
    this.searchQuery = '';
    this.onSearchChange();
  }

}
