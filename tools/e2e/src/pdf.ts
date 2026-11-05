const escaped = (text: string) => text.replaceAll(/[\\()]/gu, (char) => `\\${char}`)

export const pdfWithPages = (pages: ReadonlyArray<readonly string[]>): Buffer => {
  const objects: string[] = []
  const add = (body: string) => objects.push(body)
  const pageIds = pages.map((_, index) => 4 + index * 2)
  add("<< /Type /Catalog /Pages 2 0 R >>")
  add(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  )
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

  for (const [index, lines] of pages.entries()) {
    const stream = lines
      .map((line, row) => `BT /F1 18 Tf 72 ${720 - row * 30} Td (${escaped(line)}) Tj ET`)
      .join("\n")

    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
    )
    add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`)
  }

  let out = "%PDF-1.4\n"

  const offsets = objects.map((body, index) => {
    const at = Buffer.byteLength(out)
    out += `${index + 1} 0 obj\n${body}\nendobj\n`

    return at
  })

  const xref = Buffer.byteLength(out)
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  out += offsets.map((at) => `${String(at).padStart(10, "0")} 00000 n \n`).join("")
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`

  return Buffer.from(out, "latin1")
}
