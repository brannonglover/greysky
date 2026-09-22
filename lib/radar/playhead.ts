export type PlayheadListener = (index: number) => void;

/**
 * The animation playhead, deliberately kept OUT of React state.
 *
 * Playback moves this several times a second. If it lived in a screen's
 * useState, every tick would re-render the screen, the legend, the timeline and
 * the map wrapper — which is what the previous implementation did. Here the
 * value lives in a plain object and only the handful of components that
 * actually display it subscribe.
 *
 * Manifest state (frames, window, legend) is the opposite case: it changes
 * about once a minute and belongs in ordinary React state.
 */
export class Playhead {
  private current = 0;
  private count = 0;
  private readonly listeners = new Set<PlayheadListener>();

  get index(): number {
    return this.current;
  }

  get length(): number {
    return this.count;
  }

  /** Called when a new manifest lands. Keeps the index in range. */
  setCount(count: number): void {
    this.count = Math.max(0, count);
    if (this.current > this.count - 1) this.set(Math.max(0, this.count - 1));
  }

  set(next: number): void {
    if (this.count === 0) return;
    const clamped = Math.max(0, Math.min(this.count - 1, Math.round(next)));
    if (clamped === this.current) return;
    this.current = clamped;
    this.emit();
  }

  /** Step forward, wrapping at the end so the animation loops. */
  advance(): void {
    if (this.count === 0) return;
    this.current = (this.current + 1) % this.count;
    this.emit();
  }

  subscribe(listener: PlayheadListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.current);
  }
}
