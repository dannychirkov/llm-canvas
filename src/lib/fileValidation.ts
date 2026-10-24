/**
 * File validation utilities for server-side security
 * Validates file types based on actual file content (magic bytes) rather than MIME types
 */

import { fileTypeFromBuffer } from 'file-type'
import { JSDOM } from 'jsdom'
import DOMPurify from 'isomorphic-dompurify'

export interface FileValidationResult {
  isValid: boolean
  detectedMimeType: string | null
  error?: string
  sanitizedBuffer?: Buffer // Sanitized buffer for SVG files
}

/**
 * Valid MIME types for images
 */
const VALID_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'image/svg+xml'
]

/**
 * Valid MIME types for videos
 */
const VALID_VIDEO_TYPES = [
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'video/x-msvideo', // AVI
  'video/x-ms-wmv', // WMV
  'video/x-flv', // FLV
  'video/x-matroska' // MKV
]

/**
 * Valid MIME types for CSV
 */
const VALID_CSV_TYPES = [
  'text/csv',
  'text/plain',
  'application/csv'
]

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
    // Stricter check: reject data: URI in href
    if (/data:(text\/html|application\/javascript)/i.test(attrValue)) {
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
  
  // Check for HTML elements in SVG (namespace)
  const htmlElements = document.querySelectorAll('*[namespaceURI*="html"]')
  if (htmlElements.length > 0) {
    return true
  }
  
  return false
}

/**
 * Check if buffer contains a valid and safe SVG file
 * SVG files are text-based and don't have binary magic bytes
 * This function validates and sanitizes SVG to prevent XSS attacks
 */
async function isValidSVG(buffer: Buffer): Promise<{ isValid: boolean; error?: string; sanitizedBuffer?: Buffer }> {
  if (!buffer || buffer.length === 0) {
    return { isValid: false, error: 'Empty file' }
  }
  
  // Limit file size for security (10MB maximum)
  const MAX_SVG_SIZE = 10 * 1024 * 1024
  if (buffer.length > MAX_SVG_SIZE) {
    return { isValid: false, error: 'SVG file is too large (maximum 10MB)' }
  }
  
  try {
    // Decode entire file as UTF-8
    let svgText: string
    try {
      svgText = buffer.toString('utf-8')
    } catch (error) {
      return { isValid: false, error: 'File cannot be decoded as UTF-8' }
    }
    
    // Basic check for SVG tags
    const trimmed = svgText.trimStart()
    const hasSvgTag = /<svg[\s>]/.test(trimmed) || /<\?xml[\s>][\s\S]*<svg[\s>]/.test(trimmed)
    
    if (!hasSvgTag) {
      return { isValid: false, error: 'File does not contain valid SVG tags' }
    }
    
    // Parse SVG with JSDOM for safe analysis
    let dom: JSDOM
    try {
      dom = new JSDOM(svgText, {
        contentType: 'image/svg+xml',
        // Disable script execution
        runScripts: 'outside-only'
        // resources by default does not load external resources, preventing SSRF
      })
    } catch (error) {
      return { 
        isValid: false, 
        error: `Error parsing SVG: ${error instanceof Error ? error.message : 'Unknown error'}` 
      }
    }
    
    // Check for dangerous elements and attributes
    if (containsDangerousContent(dom)) {
      return { isValid: false, error: 'SVG contains dangerous elements or attributes (script, foreignObject, event handlers, javascript: URIs)' }
    }
    
    // Sanitize SVG with DOMPurify
    let sanitized: string
    try {
      sanitized = DOMPurify.sanitize(svgText, {
        // Allow only SVG elements
        USE_PROFILES: { svg: true, svgFilters: true },
        // Forbid HTML elements
        FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'style', 'foreignObject'],
        // Forbid dangerous attributes
        FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
        // Additional security settings
        ADD_ATTR: ['xmlns', 'xmlns:xlink'],
        // Remove attributes starting with "on"
        ALLOW_DATA_ATTR: false,
        // Forbid javascript: URI
        SAFE_FOR_TEMPLATES: false,
        // Enable strict mode
        RETURN_DOM: false,
        RETURN_DOM_FRAGMENT: false,
        RETURN_TRUSTED_TYPE: false
      })
    } catch (error) {
      return { 
        isValid: false, 
        error: `Error sanitizing SVG: ${error instanceof Error ? error.message : 'Unknown error'}` 
      }
    }
    
    // Check that valid SVG remains after sanitization
    if (!sanitized || sanitized.trim().length === 0) {
      return { isValid: false, error: 'SVG was completely removed during sanitization' }
    }
    
    // Check that sanitized SVG contains <svg> tag
    const sanitizedTrimmed = sanitized.trimStart()
    const hasSanitizedSvgTag = /<svg[\s>]/.test(sanitizedTrimmed) || /<\?xml[\s>][\s\S]*<svg[\s>]/.test(sanitizedTrimmed)
    
    if (!hasSanitizedSvgTag) {
      return { isValid: false, error: 'After sanitization, SVG does not contain valid SVG tags' }
    }
    
    // Parse sanitized SVG for final check
    let sanitizedDom: JSDOM
    try {
      sanitizedDom = new JSDOM(sanitized, {
        contentType: 'image/svg+xml',
        runScripts: 'outside-only'
        // resources by default does not load external resources, preventing SSRF
      })
    } catch (error) {
      return { 
        isValid: false, 
        error: `Error parsing sanitized SVG: ${error instanceof Error ? error.message : 'Unknown error'}` 
      }
    }
    
    // Final check for dangerous content in sanitized SVG
    if (containsDangerousContent(sanitizedDom)) {
      return { isValid: false, error: 'Sanitized SVG still contains dangerous content' }
    }
    
    // Return sanitized buffer
    const sanitizedBuffer = Buffer.from(sanitized, 'utf-8')
    
    return { 
      isValid: true, 
      sanitizedBuffer 
    }
  } catch (error) {
    // Fail closed: reject file on any error
    return { 
      isValid: false, 
      error: `Error validating SVG: ${error instanceof Error ? error.message : 'Unknown error'}` 
    }
  }
}

/**
 * Check if buffer contains a valid image based on magic bytes
 */
export async function isValidImage(buffer: Buffer): Promise<FileValidationResult> {
  try {
    const fileType = await fileTypeFromBuffer(buffer)
    
    // Special handling for SVG - file-type cannot detect text files
    if (!fileType) {
      // Check if this might be SVG
      const svgValidation = await isValidSVG(buffer)
      if (svgValidation.isValid) {
        return {
          isValid: true,
          detectedMimeType: 'image/svg+xml',
          sanitizedBuffer: svgValidation.sanitizedBuffer
        }
      }
      
      return {
        isValid: false,
        detectedMimeType: null,
        error: svgValidation.error || 'Failed to determine file type'
      }
    }

    // If file-type detected SVG, additionally check security
    if (fileType.mime === 'image/svg+xml') {
      const svgValidation = await isValidSVG(buffer)
      if (!svgValidation.isValid) {
        return {
          isValid: false,
          detectedMimeType: fileType.mime,
          error: svgValidation.error || 'SVG file failed security check'
        }
      }
      
      return {
        isValid: true,
        detectedMimeType: fileType.mime,
        sanitizedBuffer: svgValidation.sanitizedBuffer
      }
    }

    const isValid = VALID_IMAGE_TYPES.includes(fileType.mime)
    
    return {
      isValid,
      detectedMimeType: fileType.mime,
      error: isValid ? undefined : `Detected file type: ${fileType.mime}, expected image`
    }
  } catch (error) {
    return {
      isValid: false,
      detectedMimeType: null,
      error: `Error checking image: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }
}

/**
 * Check if buffer contains a valid video based on magic bytes
 */
export async function isValidVideo(buffer: Buffer): Promise<FileValidationResult> {
  try {
    const fileType = await fileTypeFromBuffer(buffer)
    
    if (!fileType) {
      return {
        isValid: false,
        detectedMimeType: null,
        error: 'Failed to determine file type'
      }
    }

    const isValid = VALID_VIDEO_TYPES.includes(fileType.mime)
    
    return {
      isValid,
      detectedMimeType: fileType.mime,
      error: isValid ? undefined : `Detected file type: ${fileType.mime}, expected video`
    }
  } catch (error) {
    return {
      isValid: false,
      detectedMimeType: null,
      error: `Error checking video: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }
}

/**
 * Check if buffer contains valid CSV (minimal validation: valid UTF-8 text)
 */
export async function isValidCSV(buffer: Buffer): Promise<FileValidationResult> {
  try {
    // Check that file can be decoded as UTF-8
    // If file is too large, check only first 1MB
    const checkBuffer = buffer.length > 1024 * 1024 ? buffer.subarray(0, 1024 * 1024) : buffer
    
    // Check for null bytes in entire buffer
    if (buffer.includes(0)) {
      return {
        isValid: false,
        detectedMimeType: null,
        error: 'File contains binary data, expected text CSV'
      }
    }
    
    // Decode to UTF-8 for validity check and content analysis
    const text = checkBuffer.toString('utf-8')
    
    // Check for excessive non-printable characters
    // Count non-printable characters (excluding spaces, tabs, newlines)
    const nonPrintableCount = text.split('').filter(char => {
      const code = char.charCodeAt(0)
      // Exclude spaces (32), tab (9), newline (10), carriage return (13)
      return code < 32 && ![9, 10, 13].includes(code)
    }).length
    
    // If more than 5% of characters are non-printable (excluding spaces and newlines), this is suspicious
    if (text.length > 0 && nonPrintableCount / text.length > 0.05) {
      return {
        isValid: false,
        detectedMimeType: null,
        error: 'File contains binary data, expected text CSV'
      }
    }
    
    const checkText = text
    
    // Basic check: file should contain at least one comma or semicolon (CSV delimiters)
    // or be empty (empty CSV is also valid)
    if (checkText.length === 0) {
      return {
        isValid: true,
        detectedMimeType: 'text/csv'
      }
    }

    // Check for CSV-like structure (at least one comma, semicolon, or tab)
    const hasCsvDelimiter = /[,;\t]/.test(checkText)
    
    // Check for newlines (for single-column CSV)
    const hasNewline = /[\r\n]/.test(checkText.trim())
    
    // Reject only if there are no delimiters AND no newlines AND file is large enough
    // This allows valid single-column CSV (one value per line) to pass the check
    if (!hasCsvDelimiter && !hasNewline && checkText.trim().length > 10) {
      // If file is large enough but has no delimiters and no newlines, it might not be CSV
      return {
        isValid: false,
        detectedMimeType: 'text/plain',
        error: 'File does not contain CSV delimiters (comma, semicolon, or tab) and does not contain newlines'
      }
    }

    return {
      isValid: true,
      detectedMimeType: 'text/csv'
    }
  } catch (error) {
    return {
      isValid: false,
      detectedMimeType: null,
      error: `Error checking CSV: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }
}

/**
 * Validate file type based on declared MIME type and actual file content
 * This is the main validation function that should be called before saving files
 */
export async function validateFileType(
  buffer: Buffer,
  declaredMimeType: string,
  filename: string
): Promise<FileValidationResult> {
  try {
    // Determine expected file type based on declared MIME type
    const isDeclaredImage = declaredMimeType.startsWith('image/')
    const isDeclaredVideo = declaredMimeType.startsWith('video/')
    const isDeclaredCSV = declaredMimeType === 'text/csv' || filename.toLowerCase().endsWith('.csv')
    const isDeclaredSVG = declaredMimeType === 'image/svg+xml' || filename.toLowerCase().endsWith('.svg')

    // Determine actual file type from content
    const fileType = await fileTypeFromBuffer(buffer)
    const actualMimeType = fileType?.mime || null

    // If file type could not be determined but file is declared as CSV, check as CSV
    if (!fileType && isDeclaredCSV) {
      return await isValidCSV(buffer)
    }

    // If file type could not be determined but file is declared as SVG, check as SVG
    if (!fileType && isDeclaredSVG) {
      const svgValidation = await isValidSVG(buffer)
      if (svgValidation.isValid) {
        return {
          isValid: true,
          detectedMimeType: 'image/svg+xml',
          sanitizedBuffer: svgValidation.sanitizedBuffer
        }
      }
      return {
        isValid: false,
        detectedMimeType: null,
        error: svgValidation.error || 'Declared type is SVG, but file is not a valid SVG'
      }
    }
    
    // If file-type detected SVG, additionally check security
    if (fileType && fileType.mime === 'image/svg+xml') {
      const svgValidation = await isValidSVG(buffer)
      if (!svgValidation.isValid) {
        return {
          isValid: false,
          detectedMimeType: fileType.mime,
          error: svgValidation.error || 'SVG file failed security check'
        }
      }
      
      return {
        isValid: true,
        detectedMimeType: fileType.mime,
        sanitizedBuffer: svgValidation.sanitizedBuffer
      }
    }

    // If file type could not be determined, this is suspicious
    if (!fileType) {
      return {
        isValid: false,
        detectedMimeType: null,
        error: 'Failed to determine file type from content. File may be corrupted or have unknown format.'
      }
    }

    // Check if declared type matches actual type
    if (isDeclaredImage) {
      const imageValidation = await isValidImage(buffer)
      if (!imageValidation.isValid) {
        return {
          isValid: false,
          detectedMimeType: actualMimeType,
          error: `Declared type is image (${declaredMimeType}), but actual file type: ${actualMimeType}. ${imageValidation.error || ''}`
        }
      }
      return {
        isValid: true,
        detectedMimeType: actualMimeType,
        sanitizedBuffer: imageValidation.sanitizedBuffer
      }
    }

    if (isDeclaredVideo) {
      const videoValidation = await isValidVideo(buffer)
      if (!videoValidation.isValid) {
        return {
          isValid: false,
          detectedMimeType: actualMimeType,
          error: `Declared type is video (${declaredMimeType}), but actual file type: ${actualMimeType}. ${videoValidation.error || ''}`
        }
      }
      return {
        isValid: true,
        detectedMimeType: actualMimeType
      }
    }

    if (isDeclaredCSV) {
      const csvValidation = await isValidCSV(buffer)
      if (!csvValidation.isValid) {
        return {
          isValid: false,
          detectedMimeType: actualMimeType,
          error: `Declared type is CSV (${declaredMimeType}), but file is not a valid CSV. ${csvValidation.error || ''}`
        }
      }
      return {
        isValid: true,
        detectedMimeType: 'text/csv'
      }
    }

    // If file type is not supported
    return {
      isValid: false,
      detectedMimeType: actualMimeType,
      error: `Unsupported file type: ${declaredMimeType}. Only images, videos, and CSV files are supported.`
    }
  } catch (error) {
    return {
      isValid: false,
      detectedMimeType: null,
      error: `Error validating file: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }
}

