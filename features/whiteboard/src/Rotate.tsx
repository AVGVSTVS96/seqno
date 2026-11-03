import type { Corner, ResizeHandle } from "./gestures.ts"

const CURSOR_PATHS =
  "<g><path d='M22.4789 9.45728L25.9935 12.9942L22.4789 16.5283V14.1032C18.126 14.1502 14.6071 17.6737 14.5675 22.0283H17.05L13.513 25.543L9.97889 22.0283H12.5674C12.6071 16.5691 17.0214 12.1503 22.4789 12.1031L22.4789 9.45728Z' fill='black'/><path fill-rule='evenodd' clip-rule='evenodd' d='M21.4789 7.03223L27.4035 12.9945L21.4789 18.9521V15.1868C18.4798 15.6549 16.1113 18.0273 15.649 21.0284H19.475L13.5128 26.953L7.55519 21.0284H11.6189C12.1243 15.8155 16.2679 11.6677 21.4789 11.1559L21.4789 7.03223ZM22.4789 12.1031C17.0214 12.1503 12.6071 16.5691 12.5674 22.0284H9.97889L13.513 25.543L17.05 22.0284H14.5675C14.5705 21.6896 14.5947 21.3558 14.6386 21.0284C15.1157 17.4741 17.9266 14.6592 21.4789 14.1761C21.8063 14.1316 22.1401 14.1069 22.4789 14.1032V16.5284L25.9935 12.9942L22.4789 9.45729L22.4789 12.1031Z' fill='white'/></g>"

const CORNER_ANGLE: Record<Corner, number> = {
  "top-left": 0,
  "top-right": 90,
  "bottom-right": 180,
  "bottom-left": 270,
}

const CORNER_PATHS =
  "<path d='m19.7432 17.0869-4.072 4.068 2.829 2.828-8.473-.013-.013-8.47 2.841 2.842 4.075-4.068 1.414-1.415-2.844-2.842h8.486v8.484l-2.83-2.827z' fill='%23fff'/><path d='m18.6826 16.7334-4.427 4.424 1.828 1.828-5.056-.016-.014-5.054 1.842 1.841 4.428-4.422 2.474-2.475-1.844-1.843h5.073v5.071l-1.83-1.828z' fill='%23000'/>"

const EDGE_PATHS =
  "<path d='m9 17.9907v.005l5.997 5.996.001-3.999h1.999 2.02v4l5.98-6.001-5.98-5.999.001 4.019-2.021.002h-2l.001-4.022zm1.411.003 3.587-3.588-.001 2.587h3.5 2.521v-2.585l3.565 3.586-3.564 3.585-.001-2.585h-2.521l-3.499-.001-.001 2.586z' fill='%23fff'/><path d='m17.4971 18.9932h2.521v2.586l3.565-3.586-3.565-3.585v2.605h-2.521-3.5v-2.607l-3.586 3.587 3.586 3.586v-2.587z' fill='%23000'/>"

const svgCursor = (paths: string, degrees: number) =>
  `url("data:image/svg+xml,<svg height='32' width='32' viewBox='0 0 35 35' xmlns='http://www.w3.org/2000/svg'><g fill='none' style='transform-origin:center center' transform='rotate(${degrees})'>${paths}</g></svg>") 16 16, pointer`

const degreesOf = (rotation: number) => (rotation * 180) / Math.PI

export const rotateCursor = (corner: Corner, rotation: number) =>
  svgCursor(CURSOR_PATHS, degreesOf(rotation) + CORNER_ANGLE[corner])

const RESIZE: Record<ResizeHandle, readonly [string, number]> = {
  "top-left": [CORNER_PATHS, 90],
  "bottom-right": [CORNER_PATHS, 90],
  "top-right": [CORNER_PATHS, 0],
  "bottom-left": [CORNER_PATHS, 0],
  top: [EDGE_PATHS, 90],
  bottom: [EDGE_PATHS, 90],
  left: [EDGE_PATHS, 0],
  right: [EDGE_PATHS, 0],
}

export const resizeCursor = (handle: ResizeHandle, rotation: number) => {
  const [paths, base] = RESIZE[handle]
  return rotation === 0 ? undefined : svgCursor(paths, degreesOf(rotation) + base)
}

const TARGET = 18

const OVERLAP = 3

export const RotateTargets = ({
  width,
  height,
  rotation,
}: {
  readonly width: number
  readonly height: number
  readonly rotation: number
}) => {
  const outside = OVERLAP - TARGET
  const places: ReadonlyArray<readonly [Corner, number, number]> = [
    ["top-left", outside, outside],
    ["top-right", width - OVERLAP, outside],
    ["bottom-right", width - OVERLAP, height - OVERLAP],
    ["bottom-left", outside, height - OVERLAP],
  ]
  return places.map(([corner, left, top]) => (
    <div
      key={`rotate-${corner}`}
      className="wb-handle"
      data-kind="rotate"
      data-handle={`rotate-${corner}`}
      style={{ left, top, width: TARGET, height: TARGET, cursor: rotateCursor(corner, rotation) }}
    />
  ))
}
