/**
 * Keyboard and touch input with safeguards:
 *  - keys are ignored while the user types in a form field or a dialog is open;
 *  - everything is released when the window loses focus or the tab is hidden;
 *  - each touch button tracks its own pointer, so several can be held at once,
 *    and releases on pointerup / pointercancel / lost capture.
 */

export interface DriveInput {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
}

export type ActionName =
  | 'camera'
  | 'reset'
  | 'pause'
  | 'gear'
  | 'cruise'
  | 'cruiseUp'
  | 'cruiseDown'
  | 'headlights'
  | 'flight'
  | 'units'
  | 'mute'
  | 'help';

type HeldControl = 'up' | 'down' | 'left' | 'right' | 'handbrake';

const KEY_HOLD: Record<string, HeldControl> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'handbrake',
};

const KEY_ACTION: Record<string, ActionName> = {
  KeyC: 'camera',
  KeyR: 'reset',
  KeyP: 'pause',
  Escape: 'pause',
  KeyG: 'gear',
  KeyK: 'cruise',
  BracketRight: 'cruiseUp',
  Equal: 'cruiseUp',
  BracketLeft: 'cruiseDown',
  Minus: 'cruiseDown',
  KeyL: 'headlights',
  KeyF: 'flight',
  KeyU: 'units',
  KeyM: 'mute',
  Slash: 'help',
};

export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    // Range sliders and checkboxes use arrows/space themselves; text-like inputs need all keys.
    return !['button', 'submit', 'reset'].includes(type);
  }
  return false;
}

export class InputManager {
  private keys = new Set<HeldControl>();
  private touch = new Set<HeldControl>();
  private actionHandler: (a: ActionName) => void = () => {};
  /** When false, driving keys are not captured (e.g. showroom, paused). */
  drivingEnabled = false;
  /** Returns true when a modal dialog is open; keys then belong to the dialog. */
  dialogOpen: () => boolean = () => false;
  /** Showroom orbit nudges via arrow keys. */
  onOrbitKey: ((dYaw: number, dPitch: number, zoom: number) => void) | null = null;

  constructor() {
    window.addEventListener('keydown', this.onKeyDown, { capture: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
  }

  onAction(fn: (a: ActionName) => void): void {
    this.actionHandler = fn;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;
    if (this.dialogOpen()) return;
    // Space / Enter on a focused button, link or summary activates that control.
    const el = e.target as HTMLElement | null;
    if ((e.code === 'Space' || e.code === 'Enter') && el && el.closest('button, a, summary, [role="button"]')) return;
    const hold = KEY_HOLD[e.code];
    if (hold && this.drivingEnabled) {
      this.keys.add(hold);
      e.preventDefault();
      return;
    }
    if (hold && !this.drivingEnabled && this.onOrbitKey && e.code.startsWith('Arrow')) {
      // Only orbit when focus is not on a control that uses arrow keys itself.
      const t = e.target as HTMLElement | null;
      if (t && t !== document.body && t.tagName !== 'CANVAS') return;
      const step = 0.08;
      if (hold === 'left') this.onOrbitKey(-step, 0, 1);
      if (hold === 'right') this.onOrbitKey(step, 0, 1);
      if (hold === 'up') this.onOrbitKey(0, 0, 0.92);
      if (hold === 'down') this.onOrbitKey(0, 0, 1.08);
      e.preventDefault();
      return;
    }
    const action = KEY_ACTION[e.code];
    if (action && !e.repeat) {
      // Space/Enter on focused buttons must keep working; our actions use letters.
      this.actionHandler(action);
      if (action !== 'help') e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const hold = KEY_HOLD[e.code];
    if (hold) this.keys.delete(hold);
  };

  /** Bind a press-and-hold touch/mouse control to an on-screen element. */
  bindHold(el: HTMLElement, control: HeldControl): void {
    const active = new Set<number>();
    const update = () => {
      if (active.size > 0) this.touch.add(control);
      else this.touch.delete(control);
      el.classList.toggle('is-active', active.size > 0);
      el.setAttribute('aria-pressed', String(active.size > 0));
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      active.add(e.pointerId);
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* capture not supported for this pointer */
      }
      update();
    });
    const end = (e: PointerEvent) => {
      active.delete(e.pointerId);
      update();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    // Keyboard users can operate on-screen pedals too (Enter/Space hold).
    el.addEventListener('keydown', (e) => {
      if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) {
        active.add(-1);
        update();
        e.preventDefault();
        e.stopPropagation();
      }
    });
    el.addEventListener('keyup', (e) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        active.delete(-1);
        update();
      }
    });
    el.addEventListener('blur', () => {
      active.delete(-1);
      update();
    });
    this.releasers.push(() => {
      active.clear();
      update();
    });
  }

  private releasers: Array<() => void> = [];

  releaseAll(): void {
    this.keys.clear();
    this.touch.clear();
    for (const r of this.releasers) r();
  }

  get anyHeld(): boolean {
    return this.keys.size > 0 || this.touch.size > 0;
  }

  read(): DriveInput {
    const has = (c: HeldControl) => this.keys.has(c) || this.touch.has(c);
    const steer = (has('left') ? 1 : 0) - (has('right') ? 1 : 0);
    return {
      throttle: has('up') ? 1 : 0,
      brake: has('down') ? 1 : 0,
      steer,
      handbrake: has('handbrake'),
    };
  }
}
