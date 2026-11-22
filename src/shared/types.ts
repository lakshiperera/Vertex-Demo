/** Which face of the laptop a port sits on. `lid` points use lid coordinates. */
export type PortSide = 'left' | 'right' | 'front' | 'back' | 'top' | 'lid';

export interface Port {
  id: string;
  label: string;
  /** Icon key: usb-c, usb-a, hdmi, audio, sd, lock, led, power, camera. */
  type: string;
  side: PortSide;
  /**
   * Position in millimetres.
   * Base frame (every side except `lid`): origin = centre of the hinge line on the top
   * surface of the base, X = right, Y = up, Z = towards the user (front).
   * Lid frame (`lid`): x = right, y = distance up the lid from the hinge, z = 0.
   */
  positionMm: { x: number; y: number; z: number };
  info: string;
  specs?: string[];
  tips?: string[];
}

export interface LaptopModel {
  id: string;
  displayName: string;
  display: {
    /** Active (lit) display area, millimetres. */
    widthMm: number;
    heightMm: number;
    /** Distance from the hinge axis up to the bottom edge of the lit display area. */
    hingeToDisplayBottomMm: number;
  };
  base: { widthMm: number; depthMm: number; thicknessMm: number };
  /** Lid angle used when the phone has no motion sensor (degrees between base and lid). */
  defaultLidAngleDeg: number;
  ports: Port[];
}

export interface ModelIndexEntry {
  id: string;
  displayName: string;
}
