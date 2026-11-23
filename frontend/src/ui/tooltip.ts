// One DOM tooltip that follows the pointer. Written directly (no React state per frame).
let el: HTMLDivElement | null = null;
export function registerTooltip(node: HTMLDivElement | null): void {
  el = node;
}
export function showTip(x: number, y: number, text: string): void {
  if (!el) return;
  if (el.textContent !== text) el.textContent = text;
  el.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y + 12)}px)`;
  el.style.opacity = '1';
}
export function hideTip(): void {
  if (el) el.style.opacity = '0';
}
