const test = require('node:test')
const assert = require('node:assert/strict')
const { JSDOM } = require('jsdom')
const { createLoader } = require('./loadSource')
const { renderCsvPreview } = createLoader()('src/lib/csvPreview.ts')

test('CSV preview preserves untrusted filename/data as text without creating executable markup', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously' })
  const filename = '</title><script>window.executed=true</script>'
  const contents = '<img src=x onerror="window.executed=true">\n<script>window.executed=true</script>,value'
  renderCsvPreview(dom.window.document, filename, contents)
  assert.equal(dom.window.document.title, filename)
  assert.equal(dom.window.document.querySelector('pre').textContent, contents)
  assert.equal(dom.window.document.querySelectorAll('script,img').length, 0)
  assert.equal(dom.window.executed, undefined)
  dom.window.close()
})
