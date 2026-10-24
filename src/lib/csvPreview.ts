/** CSV is untrusted text, including its original filename. Never parse it as HTML. */
export function renderCsvPreview(document: Document, filename: unknown, contents: unknown): void {
  document.title = typeof filename === "string" && filename ? filename : "CSV File"
  const pre = document.createElement("pre")
  pre.style.fontFamily = "monospace"
  pre.style.padding = "20px"
  pre.style.whiteSpace = "pre-wrap"
  pre.textContent = typeof contents === "string" ? contents : ""
  const body = document.body || document.documentElement.appendChild(document.createElement("body"))
  body.replaceChildren(pre)
}
