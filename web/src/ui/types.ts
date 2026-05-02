/** Minimal contract for vanilla UI modules (mount point owns DOM lifecycle). */
export interface UiMount {
  mount(parent: HTMLElement): void;
  destroy(): void;
}
