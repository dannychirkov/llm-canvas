/**
 * Image utilities for parsing image dimensions
 */

import { imageSize } from 'image-size'
import { fileTypeFromBuffer } from 'file-type'
import { JSDOM } from 'jsdom'
import DOMPurify from 'isomorphic-dompurify'

export interface ImageDimensions {
  width: number
  height: number
}

/**
 * Get image dimensions from buffer using image-size library
 * Supports PNG, JPEG, GIF, BMP, TIFF, WebP, SVG, ICO and other formats
 */
export async function getImageDimensionsFromBuffer(
  buffer: Buffer, 
  mimeType: string
): Promise<ImageDimensions | null> {
  try {
    // Validate buffer first
    if (!buffer || buffer.length === 0) {
      console.error('Empty or invalid buffer provided')
      return null
    }
    
    // Validate MIME type
    if (!mimeType || !mimeType.startsWith('image/')) {
      console.error(`Invalid MIME type: ${mimeType}`)
      return null
    }
    
    // Use image-size library to get dimensions
    // image-size works synchronously but we keep the function async for compatibility
    const dimensions = imageSize(buffer)
    
    // Check if dimensions were successfully parsed
    if (!dimensions || dimensions.width === undefined || dimensions.height === undefined) {
      console.error(`Failed to parse dimensions for MIME type: ${mimeType}`)
      return null
    }
    
    // Validate dimensions
    if (dimensions.width <= 0 || dimensions.height <= 0 || dimensions.width > 100000 || dimensions.height > 100000) {
      console.error(`Invalid image dimensions: ${dimensions.width}x${dimensions.height}`)
      return null
    }
    
    return {
      width: dimensions.width,
      height: dimensions.height
    }
    
  } catch (error) {
    console.error('Failed to parse image dimensions:', error)
    return null
  }
}

/**
 * Dangerous SVG elements that should be rejected
 */
const DANGEROUS_SVG_ELEMENTS = [
  'script',
  'foreignObject',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'style' // style can contain JavaScript via @import or expression()
]

/**
 * Check if an attribute is dangerous (event handlers or javascript: URIs)
 */
function isDangerousAttribute(attrName: string, attrValue: string): boolean {
  // Check event handler attributes (onclick, onload, etc.)
  if (/^on/i.test(attrName)) {
    return true
  }
  
  // Check javascript: URI in any attributes
  if (/javascript:/i.test(attrValue)) {
    return true
  }
  
  // Check data: URI with javascript in href/xlink:href
  if ((attrName === 'href' || attrName === 'xlink:href') && /^data:/i.test(attrValue)) {
    // data: URI can contain scripts, but for SVG this is rarely used legitimately
    // Stricter check: reject data: URI with potentially dangerous types
    if (/data:(text\/html|application\/javascript|text\/ecmascript)/i.test(attrValue)) {
      return true
    }
  }
  
  return false
}

/**
 * Check if SVG contains dangerous elements or attributes
 * Returns true if dangerous content is found
 */
function containsDangerousContent(dom: JSDOM): boolean {
  const document = dom.window.document
  
  // Check all dangerous elements
  for (const tagName of DANGEROUS_SVG_ELEMENTS) {
    const elements = document.getElementsByTagName(tagName)
    if (elements.length > 0) {
      return true
    }
  }
  
  // Check all elements for dangerous attributes
  const allElements = document.getElementsByTagName('*')
  for (let i = 0; i < allElements.length; i++) {
    const element = allElements[i]
    const attributes = element.attributes
    
    for (let j = 0; j < attributes.length; j++) {
      const attr = attributes[j]
      if (isDangerousAttribute(attr.name, attr.value)) {
        return true
      }
    }
  }
  
  // Check for external links in href/xlink:href (SSRF protection)
  // Check all elements that may contain links
  const allElementsWithHref = document.querySelectorAll('*')
  for (let i = 0; i < allElementsWithHref.length; i++) {
    const element = allElementsWithHref[i]
    // Check href attribute
    const href = element.getAttribute('href')
    if (href && /^(https?|ftp|file):/i.test(href.trim())) {
      return true
    }
    // Check xlink:href attribute (for SVG)
    const xlinkHref = element.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || 
                      element.getAttribute('xlink:href')
    if (xlinkHref && /^(https?|ftp|file):/i.test(xlinkHref.trim())) {
      return true
    }
  }
  
  return false
}

/**
 * Check if buffer contains a valid and safe SVG file
 * SVG files are text-based and don't have binary magic bytes
 * This function validates and sanitizes SVG to prevent XSS attacks
 * Uses secure XML/DOM parser with external entity expansion disabled
 */
async function isValidSVG(buffer: Buffer): Promise<boolean> {
  if (!buffer || buffer.length === 0) {
    return false
  }
  
  // Limit file size for security (10MB maximum)
  const MAX_SVG_SIZE = 10 * 1024 * 1024
  if (buffer.length > MAX_SVG_SIZE) {
    return false
  }
  
  try {
    // Decode entire file as UTF-8
    let svgText: string
    try {
      svgText = buffer.toString('utf-8')
    } catch {
      return false
    }
    
    // Basic check for SVG tags
    const trimmed = svgText.trimStart()
    const hasSvgTag = /<svg[\s>]/.test(trimmed) || /<\?xml[\s>][\s\S]*<svg[\s>]/.test(trimmed)
    
    if (!hasSvgTag) {
      return false
    }
    
    // XXE protection: remove external entity definitions before parsing
    // This prevents external entity expansion
    const safeSvgText = svgText.replace(/<!ENTITY\s+[^>]*>/gi, '')
    
    // Parse SVG with JSDOM for safe analysis
    let dom: JSDOM
    try {
      dom = new JSDOM(safeSvgText, {
        contentType: 'image/svg+xml',
        // Disable script execution
        runScripts: 'outside-only'
        // resources by default does not load external resources, preventing SSRF
      })
    } catch {
      return false
    }
    
    // Check for dangerous elements and attributes
    if (containsDangerousContent(dom)) {
      return false
    }
    
    // Sanitize SVG with DOMPurify (use already protected version)
    let sanitized: string
    try {
      sanitized = DOMPurify.sanitize(safeSvgText, {
        // Allow only SVG elements
        USE_PROFILES: { svg: true, svgFilters: true },
        // Forbid HTML elements
        FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'style', 'foreignObject'],
        // Forbid dangerous attributes (DOMPurify automatically removes all attributes starting with "on")
        FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
        // Additional security settings
        ADD_ATTR: ['xmlns', 'xmlns:xlink'],
        // Forbid data: attributes
        ALLOW_DATA_ATTR: false,
        // Forbid javascript: URI
        SAFE_FOR_TEMPLATES: false,
        // Enable strict mode
        RETURN_DOM: false,
        RETURN_DOM_FRAGMENT: false,
        RETURN_TRUSTED_TYPE: false,
        // Additional protection: forbid external links
        ALLOW_UNKNOWN_PROTOCOLS: false
      })
    } catch {
      return false
    }
    
    // Check that valid SVG remains after sanitization
    if (!sanitized || sanitized.trim().length === 0) {
      return false
    }
    
    // Check that sanitized SVG contains <svg> tag
    const sanitizedTrimmed = sanitized.trimStart()
    const hasSanitizedSvgTag = /<svg[\s>]/.test(sanitizedTrimmed) || /<\?xml[\s>][\s\S]*<svg[\s>]/.test(sanitizedTrimmed)
    
    if (!hasSanitizedSvgTag) {
      return false
    }
    
    // Final check: parse sanitized SVG for security verification
    let sanitizedDom: JSDOM
    try {
      sanitizedDom = new JSDOM(sanitized, {
        contentType: 'image/svg+xml',
        runScripts: 'outside-only'
        // resources by default does not load external resources, preventing SSRF
      })
    } catch {
      return false
    }
    
    // Final check for dangerous content in sanitized SVG
    if (containsDangerousContent(sanitizedDom)) {
      return false
    }
    
    return true
  } catch {
    // Fail closed: reject file on any error
    return false
  }
}

/**
 * Validate image buffer and MIME type using file-type library
 * This function uses magic bytes detection for more reliable validation
 */
export async function validateImageBuffer(buffer: Buffer, mimeType: string): Promise<boolean> {
  if (!buffer || buffer.length === 0) return false
  
  try {
    // Use file-type to determine actual file type from magic bytes
    const fileType = await fileTypeFromBuffer(buffer)
    
    // Special handling for SVG - file-type cannot detect text files
    if (!fileType) {
      // If SVG is declared, check manually with safe validation
      if (mimeType === 'image/svg+xml') {
        return await isValidSVG(buffer)
      }
      // Fallback: manual magic bytes check for basic formats
      return validateImageBufferFallback(buffer, mimeType)
    }
    
    // Check that detected type matches declared MIME type
    const validImageTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp',
      'image/tiff',
      'image/svg+xml'
    ]
    
    // Check that this is an image
    if (!validImageTypes.includes(fileType.mime)) {
      return false
    }
    
    // If file-type detected SVG, additionally check security
    if (fileType.mime === 'image/svg+xml') {
      const isSafe = await isValidSVG(buffer)
      if (!isSafe) {
        return false
      }
      // Check match with declared type
      const normalizedDetected = fileType.mime.toLowerCase()
      const normalizedDeclared = mimeType.toLowerCase()
      return normalizedDetected === normalizedDeclared
    }
    
    // Check match with declared type (accounting for name variants)
    const normalizedDetected = fileType.mime.toLowerCase()
    const normalizedDeclared = mimeType.toLowerCase()
    
    // Special handling for jpeg/jpg (normalize jpg to jpeg)
    if (normalizedDetected === 'image/jpeg' && normalizedDeclared === 'image/jpeg') {
      return true
    }
    // If jpg is declared but jpeg is detected - this is also valid
    if (normalizedDetected === 'image/jpeg' && normalizedDeclared === 'image/jpg') {
      return true
    }
    
    return normalizedDetected === normalizedDeclared
  } catch (error) {
    console.error('Error validating image buffer with file-type:', error)
    // Fallback to manual check on error
    return validateImageBufferFallback(buffer, mimeType)
  }
}

/**
 * Fallback validation using manual magic bytes check
 * Used when file-type cannot determine the file type
 */
function validateImageBufferFallback(buffer: Buffer, mimeType: string): boolean {
  if (!buffer || buffer.length === 0) return false
  
  if (mimeType === 'image/png') {
    return buffer.length >= 8 && 
           buffer[0] === 0x89 && buffer[1] === 0x50 && 
           buffer[2] === 0x4E && buffer[3] === 0x47
  } else if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    return buffer.length >= 2 && 
           buffer[0] === 0xFF && buffer[1] === 0xD8
  } else if (mimeType === 'image/webp') {
    return buffer.length >= 12 && 
           buffer.toString('ascii', 0, 4) === 'RIFF' && 
           buffer.toString('ascii', 8, 12) === 'WEBP'
  } else if (mimeType === 'image/gif') {
    return buffer.length >= 6 &&
           buffer.toString('ascii', 0, 3) === 'GIF' &&
           (buffer.toString('ascii', 3, 6) === '87a' || buffer.toString('ascii', 3, 6) === '89a')
  } else if (mimeType === 'image/bmp') {
    return buffer.length >= 2 &&
           buffer.toString('ascii', 0, 2) === 'BM'
  } else if (mimeType === 'image/tiff') {
    // TIFF files start with "II" (little-endian) or "MM" (big-endian) 
    // followed by magic number 42 (0x2A) at bytes 2-3
    if (buffer.length < 4) return false
    
    const byteOrder = buffer.toString('ascii', 0, 2)
    if (byteOrder === 'II') {
      // Little-endian: bytes 2-3 should be 0x2A 0x00
      return buffer[2] === 0x2A && buffer[3] === 0x00
    } else if (byteOrder === 'MM') {
      // Big-endian: bytes 2-3 should be 0x00 0x2A
      return buffer[2] === 0x00 && buffer[3] === 0x2A
    }
    return false
  } else if (mimeType === 'image/svg+xml') {
    // SVG heuristic: check buffer as UTF-8 for XML/HTML start
    // Look for "<svg" within first ~200 bytes or starts with "<?xml" and contains "<svg"
    if (buffer.length === 0) return false
    
    const checkLength = Math.min(200, buffer.length)
    const text = buffer.toString('utf8', 0, checkLength)
    
    // Check if starts with "<?xml" and contains "<svg"
    if (text.trimStart().startsWith('<?xml')) {
      return /<svg[\s>]/.test(text)
    }
    
    // Check if contains "<svg" within the first ~200 bytes
    return /<svg[\s>]/.test(text)
  }
  
  return false
}
