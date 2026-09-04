import { publicUrl } from "./lib/publicUrl";

// Root-relative under local dev / Figma Make, but prefixed with the deploy's
// base path (see lib/publicUrl.ts) so these still resolve under a GitHub
// Pages project subpath.
const assetPathPrefix = publicUrl("/assets");

export const imgUnion = `${assetPathPrefix}/75519.svg`;
export const imgIcHome = `${assetPathPrefix}/55df0.svg`;
export const imgIcBook = `${assetPathPrefix}/cc7d8.svg`;
export const imgIcHelpCircle = `${assetPathPrefix}/feb5c.svg`;
export const imgBell04 = `${assetPathPrefix}/e62e7.svg`;
export const imgChevronRight = `${assetPathPrefix}/ec467.svg`;
export const imgFilterFunnel01 = `${assetPathPrefix}/a5b7c.svg`;
export const imgIcSettings = `${assetPathPrefix}/39394.svg`;
export const imgUpload01 = `${assetPathPrefix}/a1c5e.svg`;
export const imgIcInfoCircle = `${assetPathPrefix}/b95f0.svg`;
export const imgIcLink2 = `${assetPathPrefix}/ae809.svg`;
export const imgIcDownload01 = `${assetPathPrefix}/04dac.svg`;

// Exported from the "Project - Map 3D (Layers Panel)" Figma frame (node
// 840:11439) for the project-overview first screen — downloaded and committed
// rather than hot-linked, since Figma's own asset URLs expire after ~7 days.
export const imgIcChevronLeft = `${assetPathPrefix}/ic-chevron-left.svg`;
export const imgIcCollapse = `${assetPathPrefix}/ic-collapse.svg`;
export const imgIcLayers = `${assetPathPrefix}/ic-layers.svg`;
export const imgIcPinDecorative = `${assetPathPrefix}/ic-pin-decorative.svg`;
export const imgIcTrendingUp = `${assetPathPrefix}/ic-trending-up.svg`;
export const imgIcPin = `${assetPathPrefix}/ic-pin.svg`;
export const imgIcHexagon = `${assetPathPrefix}/ic-hexagon.svg`;
export const imgIcExpand = `${assetPathPrefix}/ic-expand.svg`;
export const imgIcPolygon = `${assetPathPrefix}/ic-polygon.svg`;
