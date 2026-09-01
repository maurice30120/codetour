import { Resvg } from "@resvg/resvg-js";

const MAX_RASTERIZED_WIDTH = 2000;

export function rasterizeSvg(
  svg: string,
  naturalWidth: number,
  maxRasterizedWidth: number = MAX_RASTERIZED_WIDTH
): Buffer {
  const resvg = new Resvg(svg, {
    font: {
      loadSystemFonts: true
    },
    fitTo:
      naturalWidth > maxRasterizedWidth
        ? { mode: "width", value: maxRasterizedWidth }
        : { mode: "original" }
  });

  return resvg.render().asPng();
}
