import { Component, signal, computed, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { RecipeService } from '../services/recipe.service';
import { DomSanitizer, SafeResourceUrl, SafeHtml } from '@angular/platform-browser';

export interface ActiveTimer {
  id: number;
  label: string;
  totalSeconds: number;
  remainingSeconds: number;
  status: 'running' | 'paused' | 'ended';
}

@Component({
  selector: 'app-kitchen',
  standalone: true,
  imports: [],
  templateUrl: './kitchen.html',
  styleUrl: './kitchen.css',
})
export class KitchenComponent implements OnInit {
  currentStep = signal(0);
  timers = signal<ActiveTimer[]>([]);
  isModalMode = signal(false);
  showMedia = signal(true);
  private timerInterval: any;
  private wakeLock: any = null;

  constructor(
    public recipeService: RecipeService,
    private router: Router,
    private sanitizer: DomSanitizer
  ) {}

  getSanitizedVideoUrl(url: string | null): SafeResourceUrl | null {
    if (!url) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  ngOnInit(): void {
    if (!this.recipeService.recipeSignal()) {
      this.router.navigate(['/']);
    }

    this.requestWakeLock();

    // Tick all timers every second
    this.timerInterval = setInterval(() => {
      this.timers.update(list => 
        list.map(t => {
          if (t.status === 'running' && t.remainingSeconds > 0) {
            return { ...t, remainingSeconds: t.remainingSeconds - 1 };
          }
          if (t.remainingSeconds === 0 && t.status !== 'ended') {
            this.playTimerSound();
            return { ...t, status: 'ended' };
          }
          return t;
        })
      );
    }, 1000);
  }

  ngOnDestroy(): void {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.releaseWakeLock();
  }

  private async requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        this.wakeLock = await (navigator as any).wakeLock.request('screen');
      }
    } catch (err) {
      console.log('Wake Lock request failed');
    }
  }

  private releaseWakeLock() {
    if (this.wakeLock) {
      this.wakeLock.release().then(() => (this.wakeLock = null));
    }
  }

  openStepModal(index: number): void {
    this.currentStep.set(index);
    this.isModalMode.set(true);
    document.body.style.overflow = 'hidden'; // prevent background scroll
  }

  closeStepModal(): void {
    this.isModalMode.set(false);
    document.body.style.overflow = '';
  }

  private playTimerSound(): void {
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
    audio.play().catch(() => {}); // ignore if user hasn't interacted
  }

  get recipe() {
    return this.recipeService.recipeSignal();
  }

  get totalSteps(): number {
    return this.recipe?.instructions?.length ?? 0;
  }

  get isDone(): boolean {
    return this.currentStep() >= this.totalSteps;
  }

  nextStep(): void {
    if (this.currentStep() < this.totalSteps) {
      this.currentStep.update(s => s + 1);
    }
  }

  prevStep(): void {
    if (this.currentStep() > 0) {
      this.currentStep.update(s => s - 1);
    }
  }

  isChecked(index: number): boolean {
    return this.recipeService.isChecked(index);
  }

  toggleIngredient(index: number): void {
    this.recipeService.toggleIngredient(index);
  }

  goHome(): void {
    this.router.navigate(['/']);
  }

  // Scaling
  get scale() { return this.recipeService.scale(); }

  setScale(s: number) {
    this.recipeService.scale.set(s);
  }

  getScaledIngredient(ing: string): string {
    return this.recipeService.scaleQuantity(ing);
  }

  toggleMedia(): void {
    this.showMedia.update(v => !v);
  }

  range(n: number): number[] {
    return Array.from({ length: n }, (_, i) => i);
  }

  // Timer Management
  parseInstructions(instruction: any): SafeHtml {
    const text = typeof instruction === 'string' ? instruction : (instruction.text || '');
    // Regex for: "num minute(s)", "num hour(s)", "num-num minute(s)"
    const timeReg = /(\d+(?:[-–]\d+)?\s*(?:min|minute|hr|hour)s?)/gi;
    
    const html = text.replace(timeReg, (match: string) => {
      return `<span class="timer-chip" data-time="${match}">${match}</span>`;
    });
    
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  handleInstructionClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (target.classList.contains('timer-chip')) {
      const timeStr = target.getAttribute('data-time');
      if (timeStr) this.createTimer(timeStr);
    }
  }

  createTimer(timeStr: string): void {
    // Extract first number found
    const match = timeStr.match(/(\d+)/);
    if (!match) return;
    
    let value = parseInt(match[1]);
    const isHour = timeStr.toLowerCase().includes('hr') || timeStr.toLowerCase().includes('hour');
    
    const totalSeconds = isHour ? value * 3600 : value * 60;
    
    // Check if duplicate
    const existing = this.timers().find(t => t.label === timeStr && t.status !== 'ended');
    if (existing) return;

    const newTimer: ActiveTimer = {
      id: Date.now(),
      label: timeStr,
      totalSeconds,
      remainingSeconds: totalSeconds,
      status: 'running'
    };
    
    this.timers.update(t => [...t, newTimer]);
  }

  removeTimer(id: number): void {
    this.timers.update(list => list.filter(t => t.id !== id));
  }

  formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  getTimerProgress(timer: ActiveTimer): number {
    return (timer.remainingSeconds / timer.totalSeconds) * 100;
  }
}
