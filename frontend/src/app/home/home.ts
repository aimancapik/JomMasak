import { Component, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { RecipeService, HistoryItem } from '../services/recipe.service';
import { HttpErrorResponse } from '@angular/common/http';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class HomeComponent {
  url = '';
  loading = signal(false);
  error = signal<string | null>(null);

  constructor(private recipeService: RecipeService, private router: Router) {}

  get history() {
    return this.recipeService.historySignal();
  }

  async loadFromHistory(item: HistoryItem): Promise<void> {
    this.url = item.url;
    await this.onSubmit();
  }

  async onSubmit(): Promise<void> {
    const trimmed = this.url.trim();
    if (!trimmed) {
      this.error.set('Please paste a recipe URL above.');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      await this.recipeService.parseUrl(trimmed);
      this.router.navigate(['/kitchen']);
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.error?.error) {
        this.error.set(err.error.error);
      } else {
        this.error.set('Something went wrong. Please try a different URL.');
      }
    } finally {
      this.loading.set(false);
    }
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      this.onSubmit();
    }
  }
}
