/** Measure the plots themselves, excluding group labels, axes and readout columns. */
export function chartGroupBounds(group: HTMLElement) {
  const plots = group.querySelectorAll<SVGSVGElement>('.channel svg');
  if (!plots.length) return;
  const first = plots[0].getBoundingClientRect(), last = plots[plots.length - 1].getBoundingClientRect();
  if (!first.width || last.bottom <= first.top) return;
  return { left: first.left, top: first.top, width: first.width, height: last.bottom - first.top };
}

export function chartGroupCursorStyle(group: HTMLElement) {
  const box = chartGroupBounds(group);
  if (!box) return;
  const parent = group.getBoundingClientRect();
  return { left: `${box.left - parent.left}px`, top: `${box.top - parent.top}px`, width: `${box.width}px`, height: `${box.height}px` };
}
