import { Resvg } from "@resvg/resvg-js";

const MAX_RASTERIZED_WIDTH = 2000;

export function rasterizeSvg(svg: string, naturalWidth: number): Buffer {
  const resvg = new Resvg(svg, {
    font: {
      loadSystemFonts: true
    },
    fitTo:
      naturalWidth > MAX_RASTERIZED_WIDTH
        ? { mode: "width", value: MAX_RASTERIZED_WIDTH }
        : { mode: "original" }
  });

  return resvg.render().asPng();
}
