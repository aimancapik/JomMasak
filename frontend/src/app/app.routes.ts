import { Routes } from '@angular/router';
import { HomeComponent } from './home/home';
import { KitchenComponent } from './kitchen/kitchen';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'kitchen', component: KitchenComponent },
  { path: '**', redirectTo: '' },
];
