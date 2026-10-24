import { posthog, isAnalyticsEnabled } from './posthog'

// Analytics event types
export interface CanvasEvent {
  canvas_id?: string
  canvas_title?: string
  canvas_type?: string
}

export interface NodeEvent {
  node_id?: string
  node_type?: string
  canvas_id?: string
}

export interface UserEvent {
  user_id?: string
  session_id?: string
}

// Canvas operations
export const trackCanvasCreated = (data: CanvasEvent) => {
  if (!isAnalyticsEnabled()) return
  
  posthog.capture('canvas_created', {
    canvas_id: data.canvas_id,
    canvas_title: data.canvas_title,
    canvas_type: data.canvas_type,
    timestamp: new Date().toISOString()
  })
}

export const trackCanvasUpdated = (data: CanvasEvent) => {
  if (!isAnalyticsEnabled()) return
  
  posthog.capture('canvas_updated', {
    canvas_id: data.canvas_id,
    canvas_title: data.canvas_title,
    canvas_type: data.canvas_type,
    timestamp: new Date().toISOString()
  })
}

export const trackCanvasDeleted = (data: CanvasEvent) => {
  if (!isAnalyticsEnabled()) return
  
  posthog.capture('canvas_deleted', {
    canvas_id: data.canvas_id,
    canvas_title: data.canvas_title,
    canvas_type: data.canvas_type,
    timestamp: new Date().toISOString()
  })
}

export const trackCanvasOpened = (data: CanvasEvent) => {
  if (!isAnalyticsEnabled()) return
  
  posthog.capture('canvas_opened', {
    canvas_id: data.canvas_id,
    canvas_title: data.canvas_title,
    canvas_type: data.canvas_type,
    timestamp: new Date().toISOString()
  })
}

// Node operations
export const trackNodeAdded = (data: NodeEvent) => {
  if (!isAnalyticsEnabled()) return
  
  posthog.capture('node_added', {
    node_id: data.node_id,
    node_type: data.node_type,
    canvas_id: data.canvas_id,
    timestamp: new Date().toISOString()
  })
}

export const trackNodeEdited = (data: NodeEvent) => {
  if (!isAnalyticsEnabled()) return
  
  posthog.capture('node_edited', {
    node_id: data.node_id,
    node_type: data.node_type,
    canvas_id: data.canvas_id,
    timestamp: new Date().toISOString()
  })
}

export const trackNodeDeleted = (data: NodeEvent) => {
  if (!isAnalyticsEnabled()) return
  
  posthog.capture('node_deleted', {
    node_id: data.node_id,
    node_type: data.node_type,
    canvas_id: data.canvas_id,
    timestamp: new Date().toISOString()
  })
}

// User events
export const trackUserAction = (event: string, properties?: Record<string, unknown>) => {
  if (!isAnalyticsEnabled()) return
  
  posthog.capture(event, {
    ...properties,
    timestamp: new Date().toISOString()
  })
}

// Page view tracking
export const trackPageView = (path: string) => {
  if (!isAnalyticsEnabled()) return
  
  posthog.capture('$pageview', {
    $current_url: path,
    timestamp: new Date().toISOString()
  })
}
