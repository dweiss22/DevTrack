type ExportChartAsImageOptions = {
  title?: string;
  description?: string;
  filterSections?: { label: string; lines: string[] }[];
};

/** Exports the first inline <svg> inside `container` as a downloaded PNG, using only browser
 * APIs (no charting-export dependency): serialize the SVG, draw it into a canvas below a
 * rendered header (chart title/description and the filters that produced the data), then save. */
export function exportChartAsImage(container: HTMLElement | null, filename: string, options: ExportChartAsImageOptions = {}) {
  const svg = container?.querySelector("svg");
  if (!svg) return;
  const { width, height } = svg.getBoundingClientRect();
  const svgString = new XMLSerializer().serializeToString(svg);
  const svgUrl = URL.createObjectURL(new Blob([svgString], { type: "image/svg+xml;charset=utf-8" }));
  const image = new Image();
  image.onload = () => {
    const scale = 2;
    const padding = 20;
    const contentWidth = width - padding * 2;
    const measuringContext = document.createElement("canvas").getContext("2d");
    URL.revokeObjectURL(svgUrl);
    if (!measuringContext) return;

    const header = buildHeaderLines(measuringContext, contentWidth, options);
    const headerHeight = header.length ? header.reduce((sum, line) => sum + line.lineHeight, 0) + padding : 0;

    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = (height + headerHeight) * scale;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(scale, scale);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height + headerHeight);
    context.textBaseline = "top";

    let y = padding * 0.75;
    for (const line of header) {
      context.font = line.font;
      context.fillStyle = line.color;
      context.fillText(line.text, padding, y);
      y += line.lineHeight;
    }

    context.drawImage(image, 0, headerHeight, width, height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
    });
  };
  image.src = svgUrl;
}

const TITLE_FONT = "600 16px Arial, sans-serif";
const DESCRIPTION_FONT = "13px Arial, sans-serif";
const FILTER_LABEL_FONT = "600 12px Arial, sans-serif";
const FILTER_LINE_FONT = "12px Arial, sans-serif";
const TITLE_INK = "#0f172a";
const BODY_INK = "#475569";

function buildHeaderLines(context: CanvasRenderingContext2D, maxWidth: number, options: ExportChartAsImageOptions) {
  const lines: { text: string; font: string; color: string; lineHeight: number }[] = [];
  const push = (text: string, font: string, color: string, lineHeight: number) => {
    context.font = font;
    for (const wrapped of wrapText(context, text, maxWidth)) lines.push({ text: wrapped, font, color, lineHeight });
  };
  if (options.title) push(options.title, TITLE_FONT, TITLE_INK, 22);
  if (options.description) push(options.description, DESCRIPTION_FONT, BODY_INK, 18);
  for (const section of options.filterSections ?? []) {
    push(section.lines.length ? section.label : `${section.label}: none applied`, FILTER_LABEL_FONT, TITLE_INK, 18);
    for (const line of section.lines) push(`• ${line}`, FILTER_LINE_FONT, BODY_INK, 17);
  }
  return lines;
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const attempt = current ? `${current} ${word}` : word;
    if (current && context.measureText(attempt).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = attempt;
    }
  }
  if (current) lines.push(current);
  return lines;
}
