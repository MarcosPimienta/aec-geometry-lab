// src/loaders/ifc.ts
// Properties-only IFC loader using WebIFC core. We avoid package export-map
// gotchas by deep-importing the ESM file via a file URL, and we point the API
// to /wasm/ under your BASE_URL (same folder the Three loader uses).

// Types returned to the app
export interface IfcElement {
  expressID: number;
  type: string;         // e.g. "IFCWALL"
  globalId?: string;
  name?: string;
  mesh?: null;          // props-only in core path
}

export interface IfcLoadResult {
  modelID: number;
  elements: IfcElement[];
}

// Minimal shape for the parts of web-ifc we use
type IfcAPIType = {
  Init: (arg?: any) => Promise<void>;
  OpenModel: (data: Uint8Array) => number;
  CloseModel: (modelID: number) => void;
  GetAllItemsOfType: (modelID: number, type: number, verbose: boolean) => number[];
  GetLine: (modelID: number, expressID: number, flatten?: boolean) => any;
  [k: string]: any; // SetWasmPath, etc.
};
type WebIFCModule = {
  IfcAPI: new () => IfcAPIType;
  [k: string]: any; // constants like IFCWALL
};

let WEBIFC: WebIFCModule | null = null;
let ifcApi: IfcAPIType | null = null;

// Dynamically import the ESM API from node_modules via a real file URL
async function importWebIFC(): Promise<WebIFCModule> {
  if (WEBIFC) return WEBIFC;
  const apiUrl = new URL('../../node_modules/web-ifc/web-ifc-api.js', import.meta.url).href;
  WEBIFC = (await import(/* @vite-ignore */ apiUrl)) as unknown as WebIFCModule;
  return WEBIFC;
}

function wasmFolder(): string {
  // Served from /public/wasm
  return `${import.meta.env.BASE_URL}wasm/`;
}

export async function initIFC(): Promise<IfcAPIType> {
  if (ifcApi) return ifcApi;
  const mod = await importWebIFC();
  ifcApi = new mod.IfcAPI();

  // Point to the same folder used by the Three loader
  const folder = wasmFolder();
  try { ifcApi.SetWasmPath?.(folder); } catch {}
  await ifcApi.Init();

  console.info('[IFC core] wasm folder =', folder);

  return ifcApi;
}

export function closeIFC(modelID: number) {
  if (!ifcApi) return;
  try { ifcApi.CloseModel(modelID); } catch {}
}

async function readAsUint8(file: File): Promise<Uint8Array> {
  const buf = await file.arrayBuffer();
  return new Uint8Array(buf);
}

function asStr(x: any): string | undefined {
  if (x == null) return undefined;
  if (typeof x === 'string') return x;
  if (typeof x?.value === 'string') return x.value;
  return String(x);
}

function getDisplayName(line: any): string | undefined {
  return (
    asStr(line?.Name) ??
    asStr(line?.ObjectType) ??
    asStr(line?.Tag) ??
    undefined
  );
}

/**
 * Open IFC and collect metadata for common element classes.
 * Geometry is intentionally left to loadIFCviaThree().
 */
export async function loadIFC(file: File): Promise<IfcLoadResult> {
  const api = await initIFC();
  const mod = WEBIFC ?? (await importWebIFC());
  const data = await readAsUint8(file);

  const modelID = api.OpenModel(data);

  // Query by NAMES so we don’t depend on d.ts exports. Unknown ones are skipped.
  const TYPE_NAMES = [
    'IFCWALL',
    'IFCWINDOW',
    'IFCDOOR',
    'IFCSLAB',
    'IFCBEAM',
    'IFCCOLUMN',
    'IFCSTAIR',
    'IFCBUILDINGELEMENTPROXY',
  ];

  const elements: IfcElement[] = [];

  for (const typeName of TYPE_NAMES) {
    const typeId: number | undefined = (mod as any)[typeName];
    if (typeof typeId !== 'number') continue;

    let ids: number[] = [];
    try {
      // verbose=false → IDs only (fast)
      ids = api.GetAllItemsOfType(modelID, typeId, false) as unknown as number[];
    } catch {
      continue;
    }

    for (const expressID of ids) {
      try {
        const line = api.GetLine(modelID, expressID, true); // flatten
        elements.push({
          expressID,
          type: typeName,
          globalId: asStr(line?.GlobalId),
          name: getDisplayName(line),
          mesh: null,
        });
      } catch {
        continue;
      }
    }
  }

  return { modelID, elements };
}
