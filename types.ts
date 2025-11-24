
export type Tool = 'select' | 'pen' | 'highlighter' | 'eraser' | 'stroke-eraser';

export interface Point {
  x: number;
  y: number;
}

export interface Path {
  points: Point[];
  color: string;
  lineWidth: number;
  tool: Tool;
}

// New types for canvas elements
export interface ImageElement {
  type: 'image';
  id: string;
  image: HTMLImageElement; // Note: HTMLImageElement is not serializable via PeerJS directly, we will need to handle sync carefully
  // For syncing, we might send the source URL or base64 data separately
  src?: string; 
  x: number;
  y: number;
  width: number;
  height: number;
  locked?: boolean;
}

export interface PathElement {
  type: 'path';
  id: string;
  path: Path;
}

export type CanvasElement = PathElement | ImageElement;

// Sync Messages Types
export type SyncMessageType = 
  | 'SYNC_FULL_STATE' 
  | 'ADD_ELEMENT' 
  | 'UPDATE_ELEMENT' 
  | 'REMOVE_ELEMENT' 
  | 'CLEAR_BOARD';

export interface SyncMessage {
  type: SyncMessageType;
  payload?: any;
}
