let gradientId = 0;

// cloneForExport removes HTML ids. Rebuild each timeline's paint reference
// afterwards with an export-only id so it cannot resolve to the live chart.
export function prepareTimelineForExport(root, ink) {
  for (const svg of root.querySelectorAll(".timeline-chart svg")) {
    const gradient = svg.querySelector("linearGradient");
    if (!gradient) continue;
    const id = `export-timeline-gradient-${++gradientId}`;
    gradient.setAttribute("id", id);
    for (const stop of gradient.querySelectorAll("stop")) {
      stop.style.setProperty("stop-color", ink);
    }
    for (const area of svg.querySelectorAll(".timeline-area")) {
      // Inline paint overrides the stylesheet's url(#areaGradient[Daily]).
      area.style.setProperty("fill", `url(#${id})`);
    }
    for (const line of svg.querySelectorAll(".timeline-line")) {
      line.style.setProperty("fill", "none");
    }
  }
}
