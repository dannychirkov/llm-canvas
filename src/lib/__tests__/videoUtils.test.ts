import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { getFrameIntervalSeconds } from "../videoUtils"

describe("videoUtils", () => {
  describe("getFrameIntervalSeconds", () => {
    it("returns 1 second for very short videos", () => {
      assert.equal(getFrameIntervalSeconds(1000), 1)
      assert.equal(getFrameIntervalSeconds(9000), 1)
    })

    it("returns 2 seconds for medium videos (10-60s)", () => {
      assert.equal(getFrameIntervalSeconds(10000), 2)
      assert.equal(getFrameIntervalSeconds(60000), 2)
    })

    it("returns 5 seconds for longer videos", () => {
      assert.equal(getFrameIntervalSeconds(61000), 5)
      assert.equal(getFrameIntervalSeconds(5 * 60 * 1000), 5)
    })

    it("handles zero or negative values safely", () => {
      assert.equal(getFrameIntervalSeconds(0), 1)
      assert.equal(getFrameIntervalSeconds(-5000), 1)
    })
  })
})

