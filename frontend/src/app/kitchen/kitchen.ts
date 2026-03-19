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
  // --- Signals for Reactive State Management ---
  currentStep = signal(0);           // Tracks the current active recipe step
  timers = signal<ActiveTimer[]>([]); // List of active countdown timers
  isModalMode = signal(false);       // Controls visibility of the focused step modal
  showPdfPreview = signal(false);    // Controls visibility of the PDF print preview
  showMedia = signal(true);          // Toggle for showing/hiding images and videos

  private timerInterval: any;        // Handle for the global 1s timer tick
  private wakeLock: any = null;      // Keeps the screen on during cooking

  /**
   * Memoized video URL to prevent iframe flickering.
   * Only re-evaluates when the recipe or current step changes.
   */
  activeVideoUrl = computed(() => {
    const step = this.recipe?.instructions?.[this.currentStep()];
    const url = step?.video?.url;
    if (!url) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });

  /**
   * Memoized hero video URL for the sidebar.
   */
  mainVideoUrl = computed(() => {
    const url = this.recipe?.video?.url;
    if (!url) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });

  constructor(
    public recipeService: RecipeService,
    private router: Router,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    // Redirect home if no recipe is loaded
    if (!this.recipeService.recipeSignal()) {
      this.router.navigate(['/']);
    }

    // Keep screen active
    this.requestWakeLock();

    // Core Timer Loop: Ticks every second to update all active timers
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

  /**
   * Prevents the device from sleeping while the user is cooking.
   */
  private async requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        this.wakeLock = await (navigator as any).wakeLock.request('screen');
      }
    } catch (err) {
      console.log('Wake Lock request failed - screen may dim');
    }
  }

  private releaseWakeLock() {
    if (this.wakeLock) {
      this.wakeLock.release().then(() => (this.wakeLock = null));
    }
  }

  // --- Modal & Navigation ---

  openStepModal(index: number): void {
    this.currentStep.set(index);
    this.isModalMode.set(true);
    document.body.style.overflow = 'hidden'; // Stop background scrolling
  }

  closeStepModal(): void {
    this.isModalMode.set(false);
    document.body.style.overflow = '';
  }

  private playTimerSound(): void {
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
    audio.play().catch(() => {}); // Browsers might block if no prior user interaction
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

  // --- Ingredient Management ---

  isChecked(index: number): boolean {
    return this.recipeService.isChecked(index);
  }

  toggleIngredient(index: number): void {
    this.recipeService.toggleIngredient(index);
  }

  goHome(): void {
    this.router.navigate(['/']);
  }

  // --- Scaling Logic ---

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

  // --- PDF Generation ---

  openPdfPreview(): void {
    this.showPdfPreview.set(true);
    document.body.style.overflow = 'hidden';
  }

  closePdfPreview(): void {
    this.showPdfPreview.set(false);
    document.body.style.overflow = '';
  }

  getStepText(step: any): string {
    return typeof step === 'string' ? step : (step.text || '');
  }

  /**
   * Generates a high-quality PDF using html2pdf.js.
   * Captures the hidden print-optimized preview element.
   */
  async generatePdf(): Promise<void> {
    try {
      // Dynamic import to keep initial bundle size small
      // @ts-ignore
      const html2pdfModule = await import('html2pdf.js');
      const html2pdf = html2pdfModule.default || html2pdfModule;

      const element = document.getElementById('pdf-content');
      if (!element) return;

      const titleForFile = this.recipe?.title ? this.recipe.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() : 'recipe';

      const opt: any = {
        margin:       15,
        filename:     `${titleForFile}.pdf`,
        image:        { type: 'jpeg' as const, quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };

      await html2pdf().set(opt).from(element).save();
      this.closePdfPreview();
    } catch (error) {
      console.error('Error generating PDF:', error);
    }
  }

  range(n: number): number[] {
    return Array.from({ length: n }, (_, i) => i);
  }

  // --- Timer Regex & Parsing ---

  /**
   * Scans step text for time indicators (e.g. "10 mins") 
   * and wraps them in interactive timer chips.
   */
  parseInstructions(instruction: any): SafeHtml {
    const text = typeof instruction === 'string' ? instruction : (instruction.text || '');
    const timeReg = /(\d+(?:[-–]\d+)?\s*(?:min|minute|hr|hour)s?)/gi;
    
    const html = text.replace(timeReg, (match: string) => {
      return `<span class="timer-chip" data-time="${match}">${match}</span>`;
    });
    
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  /**
   * Handles clicks on instructions to check for timer chips.
   */
  handleInstructionClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (target.classList.contains('timer-chip')) {
      const timeStr = target.getAttribute('data-time');
      if (timeStr) this.createTimer(timeStr);
    }
  }

  /**
   * Parses time string and adds a new active timer to the list.
   */
  createTimer(timeStr: string): void {
    const match = timeStr.match(/(\d+)/);
    if (!match) return;
    
    let value = parseInt(match[1]);
    const isHour = timeStr.toLowerCase().includes('hr') || timeStr.toLowerCase().includes('hour');
    
    const totalSeconds = isHour ? value * 3600 : value * 60;
    
    // Don't create duplicate active timers for the same label
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
