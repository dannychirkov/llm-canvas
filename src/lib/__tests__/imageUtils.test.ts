import { describe, it } from "node:test"
import assert from "node:assert/strict"
/**
 * Tests for imageUtils
 */

import { getImageDimensionsFromBuffer, validateImageBuffer } from '../imageUtils'

describe('imageUtils', () => {
  describe('validateImageBuffer', () => {
    it('should validate PNG buffer', async () => {
      // PNG signature: 89 50 4E 47 0D 0A 1A 0A
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
      assert.equal(await validateImageBuffer(pngBuffer, 'image/png'), true)
    })

    it('should validate JPEG buffer', async () => {
      // JPEG signature: FF D8
      const jpegBuffer = Buffer.from([0xFF, 0xD8])
      assert.equal(await validateImageBuffer(jpegBuffer, 'image/jpeg'), true)
    })

    it('should reject invalid buffer', async () => {
      const invalidBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03])
      assert.equal(await validateImageBuffer(invalidBuffer, 'image/png'), false)
    })
  })

  describe('getImageDimensionsFromBuffer', () => {
    it('should handle empty buffer', async () => {
      const result = await getImageDimensionsFromBuffer(Buffer.alloc(0), 'image/png')
      assert.equal(result, null)
    })

    it('should handle invalid MIME type', async () => {
      const buffer = Buffer.from([0x89, 0x50, 0x4E, 0x47])
      const result = await getImageDimensionsFromBuffer(buffer, 'invalid/type')
      assert.equal(result, null)
    })
  })
})
