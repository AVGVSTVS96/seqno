import { createPortal } from "react-dom"

export const copyImage = async (image: HTMLImageElement) => {
  const canvas = document.createElement("canvas")
  canvas.width = image.naturalWidth || image.width
  canvas.height = image.naturalHeight || image.height
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height)

  const png = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png")
  })

  if (png !== null) {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })])
  }
}

export const ImageViewer = ({
  source,
  alt,
  onClose,
}: {
  readonly source: string
  readonly alt: string
  readonly onClose: () => void
}) =>
  createPortal(
    <dialog
      className="seqno-image-viewer"
      aria-label={alt === "" ? "Image" : alt}
      ref={(dialog) => {
        if (dialog !== null && !dialog.open) {
          dialog.showModal()
        }
      }}
      onClose={onClose}
      onClick={(event) => {
        event.currentTarget.close()
      }}
    >
      <img src={source} alt={alt} />
    </dialog>,
    document.body,
  )
