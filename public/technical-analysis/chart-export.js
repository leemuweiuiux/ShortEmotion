// Draw charts after HTML rasterization. Safari can omit nested PNGs inside
// the SVG foreignObject used by html-to-image even when the image has loaded.
export function compositeCharts(canvas, shell, charts) {
  const bounds = shell.getBoundingClientRect();
  const scaleX = canvas.width / bounds.width;
  const scaleY = canvas.height / bounds.height;
  const ctx = canvas.getContext("2d");
  for (const { node, image } of charts) {
    const rect = node.getBoundingClientRect();
    ctx.drawImage(image, (rect.left - bounds.left) * scaleX,
      (rect.top - bounds.top) * scaleY, rect.width * scaleX, rect.height * scaleY);
  }
  return canvas;
}
