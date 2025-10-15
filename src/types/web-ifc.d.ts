declare module 'web-ifc/web-ifc-api.js' {
  export class IfcAPI {
    Init(): Promise<void>;
    OpenModel(data: Uint8Array): number;
    CloseModel(modelID: number): void;
    GetAllItemsOfType(modelID: number, type: number, verbose: boolean): number[];
    GetLine(modelID: number, expressID: number, flatten?: boolean): any;
  }
  // Minimal selection of type constants you actually use:
  export const IFCWALL: number;
  export const IFCBUILDINGELEMENTPROXY: number;
  export const IFCWINDOW: number;
  export const IFCDOOR: number;
  // …add others you reference, or just declare `export const ANY: number;` as needed
}
