const { createLoader } = require("./loadSource")

const load = createLoader()
load("src/lib/__tests__/contextService.test.ts")
load("src/lib/__tests__/imageUtils.test.ts")
load("src/lib/__tests__/videoUtils.test.ts")
