// the deck screen page: listens on the display bus and paints the view model

import '../ui/styles.css';
import './styles.css';
import { createBus } from './bus';
import type { DisplayState } from './bus';
import { renderHtml, rootClass } from './render';
import { SourceFollower } from './source';
import { buildView, formatClock } from './view';

const root = document.getElementById('display');

if (root) {
  const follower = new SourceFollower();
  let last: DisplayState | null = null;
  let lastClass = root.className;
  let lastHtml = root.innerHTML;

  const paint = (): void => {
    const now = Date.now();
    const view = buildView(last, now, window.innerWidth, window.innerHeight, follower.conflict(now));
    const html = renderHtml(view, formatClock(new Date()));
    const cls = rootClass(view);
    if (cls !== lastClass) {
      root.className = cls;
      lastClass = cls;
    }
    if (html !== lastHtml) {
      root.innerHTML = html;
      lastHtml = html;
    }
  };

  createBus().subscribe((state) => {
    const now = Date.now();
    if (follower.offer(state, now)) last = state;
    paint();
  });
  window.addEventListener('resize', paint);
  setInterval(paint, 1000);
  paint();
}
