import { Injectable, signal, effect } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

export interface Instruction {
  text: string;
  image: string | null;
  video: {
    url: string | null;
    thumbnail: string | null;
  } | null;
}

export interface Recipe {
  title: string;
  image: string | null;
  yield: string | null;
  ingredients: string[];
  instructions: Instruction[];
  prepTime: string | null;
  cookTime: string | null;
  video: {
    url: string | null;
    thumbnail: string | null;
  } | null;
}

export interface HistoryItem {
  title: string;
  url: string;
  image: string | null;
  timestamp: number;
}

const CHECKED_KEY = 'cleanplate_checked_ingredients';
const RECIPE_KEY  = 'cleanplate_last_recipe';
const HISTORY_KEY = 'cleanplate_history';

@Injectable({ providedIn: 'root' })
export class RecipeService {
  private readonly API = window.location.hostname === 'localhost' 
    ? 'http://localhost:3000/api/parse' 
    : '/api/parse';
  
  scale = signal<number>(1);
  recipeSignal = signal<Recipe | null>(this.loadStoredRecipe());
  checkedIngredients = signal<Set<number>>(this.loadChecked());
  historySignal = signal<HistoryItem[]>(this.loadHistory());

  constructor(private http: HttpClient, private router: Router) {
    // Persist checked ingredients whenever they change
    effect(() => {
      const checked = this.checkedIngredients();
      localStorage.setItem(CHECKED_KEY, JSON.stringify([...checked]));
    });
    // Persist recipe whenever it changes
    effect(() => {
      const recipe = this.recipeSignal();
      if (recipe) {
        localStorage.setItem(RECIPE_KEY, JSON.stringify(recipe));
      }
    });
    // Persist history whenever it changes
    effect(() => {
      const history = this.historySignal();
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    });
  }

  private loadStoredRecipe(): Recipe | null {
    try {
      const raw = localStorage.getItem(RECIPE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private loadChecked(): Set<number> {
    try {
      const raw = localStorage.getItem(CHECKED_KEY);
      return raw ? new Set<number>(JSON.parse(raw)) : new Set<number>();
    } catch {
      return new Set<number>();
    }
  }

  private loadHistory(): HistoryItem[] {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  private addToHistory(recipe: Recipe, url: string): void {
    const newItem: HistoryItem = {
      title: recipe.title,
      url: url,
      image: recipe.image,
      timestamp: Date.now()
    };

    // Filter out existing entries with same URL (move to top)
    const filtered = this.historySignal().filter(h => h.url !== url);
    // Add to top and limit to 10
    const updated = [newItem, ...filtered].slice(0, 10);
    this.historySignal.set(updated);
  }

  async parseUrl(url: string): Promise<void> {
    const recipe = await firstValueFrom(
      this.http.post<Recipe>(this.API, { url })
    );
    this.recipeSignal.set(recipe);
    this.checkedIngredients.set(new Set<number>());
    this.addToHistory(recipe, url);
  }

  toggleIngredient(index: number): void {
    const current = new Set(this.checkedIngredients());
    if (current.has(index)) {
      current.delete(index);
    } else {
      current.add(index);
    }
    this.checkedIngredients.set(current);
  }

  isChecked(index: number): boolean {
    return this.checkedIngredients().has(index);
  }

  // Scaling Logic
  scaleQuantity(ingredient: string): string {
    const currentScale = this.scale();
    if (currentScale === 1) return ingredient;

    // Matches numbers, decimals, and fractions like 1/2, 1 1/2, 0.5, 2
    const numReg = /(\d+\s+\d\/\d|\d+\/\d|\d+(?:\.\d+)?)/g;

    return ingredient.replace(numReg, (match) => {
      try {
        let val = 0;
        if (match.includes('/')) {
          const parts = match.split(/\s+/);
          if (parts.length === 2) {
            // "1 1/2"
            val = parseInt(parts[0]) + this.fractionToDecimal(parts[1]);
          } else {
            // "1/2"
          }
          if (val === 0) val = this.fractionToDecimal(match);
        } else {
          val = parseFloat(match);
        }

        const scaled = val * currentScale;
        return this.decimalToFraction(scaled);
      } catch {
        return match;
      }
    });
  }

  private fractionToDecimal(f: string): number {
    const [num, den] = f.split('/').map(Number);
    return num / den;
  }

  private decimalToFraction(d: number): string {
    if (d % 1 === 0) return d.toString();
    
    const tolerance = 1.0e-6;
    let h1 = 1, h2 = 0, k1 = 0, k2 = 1;
    let b = d;
    do {
      let a = Math.floor(b);
      let aux = h1; h1 = a * h1 + h2; h2 = aux;
      aux = k1; k1 = a * k1 + k2; k2 = aux;
      b = 1 / (b - a);
    } while (Math.abs(d - h1 / k1) > d * tolerance);

    const whole = Math.floor(h1 / k1);
    const num = h1 % k1;
    if (num === 0) return whole.toString();
    return whole > 0 ? `${whole} ${num}/${k1}` : `${num}/${k1}`;
  }
}
