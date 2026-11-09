let gradientId = 0;

const timelineStyles = [
  [".timeline-grid", ["stroke", "stroke-width"]],
  [".timeline-line", ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"]],
  [".timeline-dot", ["fill", "stroke", "stroke-width"]],
  [".timeline-label", ["fill", "font-size"]],
  [".timeline-stop", ["stop-color", "stop-opacity"]]
];

// html-to-image deep-clones SVG without copying its children's computed styles.
export function prepareTimelineForExport(source, clone) {
  const originalCharts = source.querySelectorAll(".timeline-chart svg");
  clone.querySelectorAll(".timeline-chart svg").forEach((svg, index) => {
    const original = originalCharts[index];
    for (const [selector, properties] of timelineStyles) {
      const originals = original.querySelectorAll(selector);
      svg.querySelectorAll(selector).forEach((element, slot) => {
        const style = getComputedStyle(originals[slot]);
        for (const property of properties) {
          element.style.setProperty(property, style.getPropertyValue(property));
        }
      });
    }

    // The HTML clone drops ids, so restore a reference local to this exported chart.
    const gradient = svg.querySelector("linearGradient");
    if (!gradient) return;
    const id = `export-timeline-gradient-${++gradientId}`;
    gradient.setAttribute("id", id);
    for (const area of svg.querySelectorAll(".timeline-area")) {
      area.style.setProperty("fill", `url(#${id})`);
    }
  });
}
