const assert = require("node:assert/strict")

async function verifyFrontend(origin, routes = ["/login", "/settings", "/dashboard"], headers = {}) {
  const base = new URL(origin)
  const assets = new Set()
  let protectedRedirects = 0
  for (const route of routes) {
    let response = await fetch(new URL(route, base), { headers, signal: AbortSignal.timeout(15000), redirect: "manual" })
    if ([302, 303, 307, 308].includes(response.status)) {
      const location = new URL(response.headers.get("location"), base)
      assert.ok(!headers.Cookie && location.origin === base.origin && location.pathname === "/login", "Unexpected frontend redirect")
      protectedRedirects++
      response = await fetch(location, { headers, signal: AbortSignal.timeout(15000), redirect: "manual" })
    }
    assert.equal(response.status, 200, "Frontend document did not load")
    assert.match(response.headers.get("content-type") ?? "", /text\/html/i)
    const html = await response.text()
    const found = [...html.matchAll(/(?:src|href)="([^"<>]*\/_next\/static\/[^"<>]+)"/g)].map(match => new URL(match[1].replaceAll("&amp;", "&"), base))
    assert.ok(found.some(asset => asset.pathname.endsWith(".js")), "Page has no JavaScript assets")
    assert.ok(found.some(asset => asset.pathname.endsWith(".css")), "Page has no stylesheet assets")
    for (const asset of found) {
      assert.equal(asset.origin, base.origin, "Unexpected cross-origin asset")
      assets.add(asset.href)
    }
  }
  for (const asset of assets) {
    const response = await fetch(asset, { signal: AbortSignal.timeout(15000), redirect: "manual" })
    const type = response.headers.get("content-type") ?? ""
    assert.equal(response.status, 200, "Frontend asset failed: " + new URL(asset).pathname)
    if (new URL(asset).pathname.endsWith(".js")) assert.match(type, /(?:javascript|ecmascript)/i, "Invalid script content type")
    if (new URL(asset).pathname.endsWith(".css")) assert.match(type, /text\/css/i, "Invalid stylesheet content type")
    assert.ok((await response.arrayBuffer()).byteLength > 0, "Empty frontend asset")
  }
  return { pages: routes.length, assets: assets.size, assetStatus: 200, ...(protectedRedirects ? { protectedRedirects } : {}) }
}

module.exports = { verifyFrontend }

if (require.main === module) {
  verifyFrontend(process.argv[2] || "https://elena.alai-carob.ts.net:4450").then(result => process.stdout.write(JSON.stringify({ check: "frontend-assets", ...result }) + "\n")).catch(failure => { process.stderr.write(failure.message + "\n"); process.exitCode = 1 })
}
