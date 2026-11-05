// Load once just before a card is visible; wide screens naturally start more cards.
export function whenNearViewport(element, load) {
  if (!element || typeof IntersectionObserver === 'undefined') { load(); return; }
  const observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    observer.disconnect();
    load();
  }, { rootMargin: '400px' });
  observer.observe(element);
}
