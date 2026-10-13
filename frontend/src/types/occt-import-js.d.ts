/** occt-import-js（OpenCASCADE WASM 绑定）上游不带 TS 类型 —— 本地声明（ADR-031 · CadViewer 用到的面）。
 *  ReadStepFile / ReadGltfFile 输出的 mesh 结构按 0.0.23 实测（字段全可选防御：上游演进不破编译）。 */
declare module "occt-import-js" {
  export type OcctMesh = {
    name: string;
    color?: [number, number, number] | number[] | null;
    brepFaces: unknown;
    attributes: {
      position: { array: ArrayLike<number> };
      normal?: { array: ArrayLike<number> };
    };
    index: { array: ArrayLike<number> } | null;
    edge?: {
      attributes: {
        position: { array: ArrayLike<number> };
      };
    };
  };
  export type OcctResult = {
    success: boolean;
    root: {
      name: string;
      children: unknown[];
      meshes: number[];
    } | null;
    meshes: OcctMesh[];
  };
  export default function occtimportjs(params?: {
    /** WASM 文件定位(ADR-031:Vite 场景传 URL 指向 public/occt/occt-import-js.wasm)。 */
    locateFile?: (path: string, scriptDirectory: string) => string;
  }): Promise<{
    ReadStepFile(buffer: Uint8Array, params: unknown): OcctResult;
    ReadGltfFile(buffer: Uint8Array, params: unknown): OcctResult;
    ReadBrepFile(buffer: Uint8Array, params: unknown): OcctResult;
  }>;
}
