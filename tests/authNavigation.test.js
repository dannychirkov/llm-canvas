const test = require("node:test")
const assert = require("node:assert/strict")
const { createLoader } = require("./loadSource")

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

// Execute the real page and its rendered event handlers with isolated hook state.
// UI primitives and browser navigation are boundaries; no source-text assertions.
function pageFixture(context, page, options = {}) {
  const state = []
  let cursor = 0
  const navigations = []
  const previous = new Map()
  for (const [name, value] of Object.entries({
    window: { location: { assign: url => {
      options.beforeNavigate?.()
      navigations.push({ type: "document", url })
    } } },
    fetch: options.fetch ?? (() => { throw new Error("Unexpected fetch") }),
  })) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  }
  context.after(() => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  })
  const load = createLoader({
    react: {
      useState(initial) {
        const index = cursor++
        if (!(index in state)) state[index] = initial
        return [state[index], value => {
          state[index] = typeof value === "function" ? value(state[index]) : value
        }]
      },
      useEffect() {},
    },
    "next-auth/react": { signIn: options.signIn ?? (() => { throw new Error("Unexpected signIn") }) },
    "next/navigation": { useRouter: () => ({
      push: url => navigations.push({ type: "client", url }),
      refresh: () => navigations.push({ type: "refresh" }),
    }) },
    "next/link": "a",
    "@/components/ui/button": { Button: "button" },
    "@/components/ui/input": { Input: "input" },
    "@/components/ui/label": { Label: "label" },
    "@/components/ui/card": Object.fromEntries(["Card", "CardContent", "CardDescription", "CardHeader", "CardTitle"].map(name => [name, "div"])),
    "@/components/ui/tooltip": Object.fromEntries(["Tooltip", "TooltipContent", "TooltipProvider", "TooltipTrigger"].map(name => [name, "div"])),
    "lucide-react": { Eye: "svg", EyeOff: "svg" },
    "@/components/CanvasBackground": "div",
    "@/components/BrandLogo": "img",
    "@/components/PasswordStrengthIndicator": "div",
  })
  const Page = load(`src/app/(auth)/${page}/page.tsx`).default
  function render() {
    cursor = 0
    return Page()
  }
  function elements(node) {
    if (!node || typeof node !== "object") return []
    if (Array.isArray(node)) return node.flatMap(elements)
    return [node, ...elements(node.props?.children)]
  }
  function find(predicate) {
    const element = elements(render()).find(predicate)
    assert.ok(element, "Expected rendered element")
    return element
  }
  return {
    navigations,
    input(name, value) { find(node => node.type === "input" && node.props.name === name).props.onChange({ target: { value } }) },
    submit() { return find(node => node.type === "form").props.onSubmit({ preventDefault() {} }) },
    loading() { return find(node => node.type === "button" && node.props.type === "submit").props.disabled },
    hasMessage(message) { return elements(render()).some(node => node.props?.children === message) },
  }
}

test("login waits for credentials and navigates once with a fresh document", async context => {
  const result = deferred()
  let cookieEstablished = false
  const calls = []
  const page = pageFixture(context, "login", {
    signIn: (...args) => { calls.push(args); return result.promise },
    beforeNavigate: () => assert.equal(cookieEstablished, true),
  })
  page.input("email", "fixture@example.test")
  page.input("password", "Fixture-Test9!")
  const pending = page.submit()
  assert.deepEqual(calls, [["credentials", { email: "fixture@example.test", password: "Fixture-Test9!", redirect: false }]])
  assert.equal(page.loading(), true)
  assert.deepEqual(page.navigations, [])
  cookieEstablished = true
  result.resolve({ ok: true, status: 200, error: undefined, url: "/login" })
  await pending
  assert.deepEqual(page.navigations, [{ type: "document", url: "/dashboard" }])
  assert.equal(page.hasMessage("Invalid email or password"), false)
})

for (const [name, result] of [
  ["credential error", { ok: true, error: "CredentialsSignin" }],
  ["unsuccessful response", { ok: false, status: 500 }],
  ["missing response", undefined],
]) test(`login stays on the form after ${name}`, async context => {
  const page = pageFixture(context, "login", { signIn: async () => result })
  await page.submit()
  assert.deepEqual(page.navigations, [])
  assert.equal(page.hasMessage("Invalid email or password"), true)
  assert.equal(page.loading(), false)
})

test("login displays request failures and allows a successful retry", async context => {
  let attempts = 0
  const page = pageFixture(context, "login", { signIn: async () => {
    if (++attempts === 1) throw new Error("Fixture network failure")
    return { ok: true }
  } })
  await page.submit()
  assert.deepEqual(page.navigations, [])
  assert.equal(page.hasMessage("An error occurred during login"), true)
  assert.equal(page.loading(), false)
  await page.submit()
  assert.equal(page.hasMessage("An error occurred during login"), false)
  assert.deepEqual(page.navigations, [{ type: "document", url: "/dashboard" }])
})

test("registration waits for success and makes one client transition to login", async context => {
  const result = deferred()
  const calls = []
  const page = pageFixture(context, "register", { fetch: (...args) => { calls.push(args); return result.promise } })
  page.input("email", "fixture@example.test")
  page.input("password", "Fixture-Test9!")
  const pending = page.submit()
  assert.equal(page.loading(), true)
  assert.deepEqual(page.navigations, [])
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], "/api/auth/register")
  assert.equal(calls[0][1].method, "POST")
  assert.deepEqual(JSON.parse(calls[0][1].body), {
    email: "fixture@example.test", password: "Fixture-Test9!", name: "",
  })
  result.resolve(Response.json({ success: true }))
  await pending
  assert.deepEqual(page.navigations, [{ type: "client", url: "/login?message=Registration successful" }])
})

for (const failure of ["rejection", "network"]) test(`registration stays on the form after ${failure}`, async context => {
  const page = pageFixture(context, "register", { fetch: async () => {
    if (failure === "network") throw new Error("Fixture network failure")
    return Response.json({ error: "Invalid invite code" }, { status: 400 })
  } })
  page.input("password", "Fixture-Test9!")
  await page.submit()
  assert.deepEqual(page.navigations, [])
  assert.equal(page.hasMessage(failure === "network" ? "An error occurred during registration" : "Invalid invite code"), true)
  assert.equal(page.loading(), false)
})

test("registration validates the password before requests or navigation", async context => {
  const page = pageFixture(context, "register")
  page.input("password", "weak")
  await page.submit()
  assert.deepEqual(page.navigations, [])
  assert.equal(page.loading(), false)
  const { validatePassword } = createLoader()("src/lib/passwordUtils.ts")
  assert.equal(page.hasMessage(validatePassword("weak").error), true)
})
