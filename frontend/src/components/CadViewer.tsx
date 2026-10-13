import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";

/** CAD 三维查看器（ADR-031 · cad3d 前端直读通道）：STEP/IGES 走 occt-import-js（OpenCASCADE WASM）
 *  浏览器内解析 B-Rep，STL/3MF 走 three.js 原生 Loader —— 零服务端转换、零产物缓存、数据不出内网
 *  （对齐图片直签口径：短时签名 URL 原对象直读）。
 *  - 归位（PoC 实测问题）：源文件自带坐标系（装配偏移 + Z-up CAD 惯例）—— 展示层先绕 X 轴 -90°（Z-up→Y-up）
 *    再把世界包围盒中心平移到原点，旋转中心恒在模型视觉中心；
 *  - GBK 转码（PoC 实测问题）：国产 CAD 导出 STEP 的实体名常为 GBK —— 喂 OCCT 前检测高位字节并 gbk→utf-8
 *    预转（UTF-8 合法则原样），装配树不乱码；
 *  - 测量：点到点距离（Raycaster 两点 + ΔX/ΔY/ΔZ）与直径/半径（共面顶点拟圆 + 圆度校验，非圆面拒绝）；
 *  - 剖切：轴对齐 ClipPlane + 滑条拖动 + PlaneHelper，localClippingEnabled；
 *  - 爆炸图：各零件沿「零件中心 − 模型中心」方向平移（t × 包围球 × 0.35）；
 *  - 装配树：层级展示 / 点击显隐 / 悬停高亮（emissive 泛蓝）；STEP 用 occt root 结构树，其余平铺；
 *  - 坐标轴：右下角 XYZ gizmo（与主相机姿态同步，红 X / 绿 Y / 蓝 Z）+ 原点 AxesHelper；
 *  - 大件架构：解析在动态 import 的 occt 模块内完成（WASM 按需加载拆 chunk），主线程仅渲染。
 *  Esc / 点遮罩关闭由外层 FilePreviewOverlay 统一负责（本组件只管视口）。
 */

const PALETTE = [0x4a7ecb, 0xcb7e4a, 0x7ecb4a, 0xcb4a7e, 0x7e4acb, 0x4acbc7];

export type CadPart = {
  name: string;
  visible: boolean;
  color: string;
  tris: number;
};

type MeasureResult = { kind: "dist"; d: number; dx: number; dy: number; dz: number } | { kind: "circ"; d: number; r: number; circularity: number };

type LoadStats = { parseMs: number | null; gbk: boolean; parts: number; tris: number; totalMs: number; error?: string };

/** STEP 文本 gbk→utf-8 预转（仅当文件含高位字节且非合法 UTF-8 时；防国产 CAD 实体名乱码）。 */
async function fetchStepMaybeGbk(url: string): Promise<{ bytes: Uint8Array; gbk: boolean }> {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let high = 0;
  for (let i = 0; i < Math.min(bytes.length, 4096); i += 1) {
    if (bytes[i]! > 0x7f) {
      high += 1;
    }
  }
  if (high > 16) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(0, Math.min(bytes.length, 4096)));
      return { bytes, gbk: false };
    } catch {
      const text = new TextDecoder("gbk").decode(bytes);
      return { bytes: new TextEncoder().encode(text), gbk: true };
    }
  }
  return { bytes, gbk: false };
}

function formatLength(value: number): string {
  if (value >= 1000) {
    return (value / 1000).toFixed(3) + " m";
  }
  if (value < 1) {
    return (value * 1000).toFixed(2) + " mm";
  }
  return value.toFixed(2) + " mm";
}

export function CadViewer({ src, name }: { src: string; name: string }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [parts, setParts] = useState<CadPart[]>([]);
  const [stats, setStats] = useState<LoadStats | null>(null);
  const [measure, setMeasure] = useState<MeasureResult | null>(null);
  const [measureMode, setMeasureMode] = useState<"dist" | "circ" | null>(null);
  const [clipOn, setClipOn] = useState(false);
  const [clipAxis, setClipAxis] = useState<"x" | "y" | "z">("x");
  const [clipPos, setClipPos] = useState(0);
  const [explodeOn, setExplodeOn] = useState(false);

  /** three.js 场景引用（命令式操作：测量 / 剖切 / 爆炸）。 */
  const engineRef = useRef<{
    group: THREE.Group;
    meshes: THREE.Mesh[];
    clipPlane: THREE.Plane | null;
    clipHelper: THREE.PlaneHelper | null;
    measureGroup: THREE.Group;
    baseDirs: THREE.Vector3[];
    box: THREE.Box3;
    pickMeasure: (ndc: THREE.Vector2, mode: "dist" | "circ") => MeasureResult | null;
    pickPoint: (ndc: THREE.Vector2) => THREE.Vector3 | null;
    scene: THREE.Scene;
  } | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (mount === null) {
      return;
    }
    let disposed = false;
    const disposers: Array<() => void> = [];

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x1a1f2b);
    renderer.localClippingEnabled = true;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0x8a8f9c));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(1, 1.4, 1.8);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x9aa4b8, 0.8);
    fill.position.set(-1.5, -1, -1);
    scene.add(fill);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1e9);
    camera.position.set(1, 0.85, 1.15);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    /** 右下角 XYZ gizmo（独立小渲染器，姿态与主相机同步）。 */
    const gizmoCanvas = document.createElement("canvas");
    gizmoCanvas.style.cssText = "position:absolute;right:14px;bottom:14px;width:84px;height:84px;pointer-events:none;";
    mount.appendChild(gizmoCanvas);
    const gizmoRenderer = new THREE.WebGLRenderer({ canvas: gizmoCanvas, antialias: true, alpha: true });
    gizmoRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    gizmoRenderer.setSize(84, 84, false);
    const gizmoScene = new THREE.Scene();
    const gizmoCam = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    gizmoCam.position.set(0, 0, 4);
    const axes: Array<[string, number]> = [["X", 0xff5252], ["Y", 0x7ecb7e], ["Z", 0x5289ff]];
    for (const [label, color] of axes) {
      const dir = label === "X" ? new THREE.Vector3(1, 0, 0) : label === "Y" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
      gizmoScene.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([dir.clone().multiplyScalar(-0.15), dir.clone().multiplyScalar(1.35)]),
          new THREE.LineBasicMaterial({ color }),
        ),
      );
      const cv = document.createElement("canvas");
      cv.width = 64;
      cv.height = 64;
      const ctx = cv.getContext("2d");
      if (ctx !== null) {
        ctx.fillStyle = "#" + color.toString(16).padStart(6, "0");
        ctx.font = "bold 40px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, 32, 34);
      }
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false }));
      sprite.scale.setScalar(0.9);
      sprite.position.copy(dir).multiplyScalar(1.7);
      gizmoScene.add(sprite);
    }

    const measureGroup = new THREE.Group();
    scene.add(measureGroup);

    let originAxes: THREE.AxesHelper | null = null;

    const resize = (): void => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    disposers.push(() => observer.disconnect());

    const loop = (): void => {
      if (disposed) {
        return;
      }
      requestAnimationFrame(loop);
      controls.update();
      gizmoCam.quaternion.copy(camera.quaternion);
      gizmoRenderer.render(gizmoScene, gizmoCam);
      renderer.render(scene, camera);
    };
    loop();

    /** 加载模型：按扩展名路由（STEP/IGES → occt WASM；STL/3MF → three Loader）。 */
    const load = async (): Promise<void> => {
      const t0 = performance.now();
      const ext = name.split(".").pop()?.toLowerCase() ?? "";
      const group = new THREE.Group();
      const meshes: THREE.Mesh[] = [];
      const baseDirs: THREE.Vector3[] = [];
      let parseMs: number | null = null;
      let gbk = false;
      let partNames: string[] = [];
      let triTotal = 0;

      const addMesh = (geo: THREE.BufferGeometry, color: number): THREE.Mesh => {
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.4 }));
        group.add(mesh);
        meshes.push(mesh);
        baseDirs.push(new THREE.Vector3());
        return mesh;
      };

      if (ext === "step" || ext === "stp" || ext === "iges" || ext === "igs") {
        const { bytes, gbk: g } = await fetchStepMaybeGbk(src);
        gbk = g;
        const { default: occtimportjs } = await import("occt-import-js");
        // WASM 定位(ADR-031):occt-import-js 按固定文件名解析 wasm —— Vite 打包不搬运 node_modules 里的
        // .wasm,构建脚本 copy 到 public/occt/(files.ts 里 blob URL 直读不受 CSP 限制);locateFile 指过去。
        const wasm = await occtimportjs({
          locateFile: () => new URL("occt/occt-import-js.wasm", import.meta.env.BASE_URL).href,
        });
        const t2 = performance.now();
        const result = wasm.ReadStepFile(bytes, null) as {
          meshes: Array<{
            name?: string;
            color?: number[] | null;
            attributes: { position: { array: ArrayLike<number> }; normal?: { array: ArrayLike<number> } };
            index?: { array: ArrayLike<number> };
            edge?: { attributes: { position: { array: ArrayLike<number> } } };
          }>;
        };
        parseMs = Math.round(performance.now() - t2);
        let mi = 0;
        for (const m of result.meshes) {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.Float32BufferAttribute(m.attributes.position.array, 3));
          if (m.attributes.normal) {
            geo.setAttribute("normal", new THREE.Float32BufferAttribute(m.attributes.normal.array, 3));
          }
          if (m.index) {
            geo.setIndex(new THREE.BufferAttribute(new Uint32Array(Array.from(m.index.array)), 1));
          }
          const c = m.color && m.color.length === 3 ? new THREE.Color(m.color[0], m.color[1], m.color[2]) : null;
          const mesh = addMesh(geo, c !== null ? c.getHex() : PALETTE[mi % PALETTE.length]!);
          const stdMat = mesh.material as THREE.MeshStandardMaterial;
          if (mi === 0) {
            stdMat.color.setHex(c !== null ? c.getHex() : PALETTE[0]!);
          }
          partNames.push(m.name || "零件" + (mi + 1));
          triTotal += m.index ? m.index.array.length / 3 : m.attributes.position.array.length / 9;
          mi += 1;
        }
      } else if (ext === "stl") {
        const bytes = await (await fetch(src)).arrayBuffer();
        const geo = new STLLoader().parse(bytes);
        addMesh(geo, PALETTE[0]!);
        partNames.push(name);
        triTotal = geo.attributes.position.count / 3;
      } else if (ext === "3mf") {
        const bytes = await (await fetch(src)).arrayBuffer();
        const obj = new ThreeMFLoader().parse(bytes);
        obj.traverse((o: THREE.Object3D) => {
          if (o instanceof THREE.Mesh) {
            o.material = new THREE.MeshStandardMaterial({ color: PALETTE[0]!, metalness: 0.3, roughness: 0.45 });
            o.geometry.computeVertexNormals();
            group.add(o);
            meshes.push(o);
            baseDirs.push(new THREE.Vector3());
            triTotal += o.geometry.attributes.position.count / 3;
          }
        });
        partNames.push(name);
      } else {
        throw new Error("不支持的 CAD 格式: ." + ext);
      }

      if (meshes.length === 0) {
        throw new Error("模型不含可渲染网格");
      }

      // 归位:Z-up→Y-up,再包围盒居中(旋转中心 = 视觉中心)
      group.rotation.x = -Math.PI / 2;
      group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(group);
      const center = box.getCenter(new THREE.Vector3());
      group.position.sub(center);
      group.updateMatrixWorld(true);
      scene.add(group);

      const size = box.getSize(new THREE.Vector3()).length() || 1;
      if (originAxes !== null) {
        scene.remove(originAxes);
      }
      originAxes = new THREE.AxesHelper(size * 0.35);
      (originAxes.material as THREE.LineBasicMaterial).depthTest = false;
      originAxes.renderOrder = 999;
      scene.add(originAxes);

      camera.position.copy(new THREE.Vector3(1, 0.85, 1.15).normalize().multiplyScalar(size * 1.15));
      camera.far = size * 20;
      camera.near = size * 0.001;
      camera.updateProjectionMatrix();
      controls.target.set(0, 0, 0);

      // 爆炸方向缓存(零件中心 - 模型中心)
      meshes.forEach((mesh, i) => {
        const pc = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
        baseDirs[i] = pc.normalize();
        if (!Number.isFinite(baseDirs[i]!.x)) {
          baseDirs[i] = new THREE.Vector3();
        }
      });

      const raycaster = new THREE.Raycaster();
      const pickPoint = (ndc: THREE.Vector2): THREE.Vector3 | null => {
        raycaster.setFromCamera(ndc, camera);
        const hits = raycaster.intersectObjects(meshes, false);
        const hit = hits[0];
        return hit !== undefined ? hit.point.clone() : null;
      };
      const pickMeasure = (ndc: THREE.Vector2, mode: "dist" | "circ"): MeasureResult | null => {
        raycaster.setFromCamera(ndc, camera);
        const hits = raycaster.intersectObjects(meshes, false);
        const hit = hits[0];
        if (hit === undefined || hit.face === null || hit.face === undefined || !(hit.object instanceof THREE.Mesh)) {
          return null;
        }
        const face = hit.face;
        if (mode === "dist") {
          return null; // 两点式距离由 pickPoint 积累
        }
        // 直径:命中面法向 + 共面顶点拟圆
        const mesh = hit.object;
        const geo = mesh.geometry;
        const normal = new THREE.Vector3().fromBufferAttribute(geo.attributes.normal!, face.a).transformDirection(mesh.matrixWorld);
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit.point);
        const tol = size * 0.0015;
        const pos = geo.attributes.position;
        const pts: THREE.Vector3[] = [];
        const v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i += 1) {
          v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
          if (Math.abs(plane.distanceToPoint(v)) < tol) {
            pts.push(v.clone());
          }
        }
        if (pts.length < 3) {
          return null;
        }
        const c = new THREE.Vector3();
        for (const p of pts) {
          c.add(p);
        }
        c.multiplyScalar(1 / pts.length);
        let radius = 0;
        for (const p of pts) {
          radius += p.distanceTo(c);
        }
        radius /= pts.length;
        let variance = 0;
        for (const p of pts) {
          variance += (p.distanceTo(c) - radius) ** 2;
        }
        variance /= pts.length;
        const circularity = Math.sqrt(variance) / radius;
        if (circularity > 0.15) {
          return null;
        }
        return { kind: "circ", d: radius * 2, r: radius, circularity };
      };

      engineRef.current = { group, meshes, clipPlane: null, clipHelper: null, measureGroup, baseDirs, box, pickMeasure, pickPoint, scene };

      setParts(
        partNames.map((n, i) => ({
          name: n,
          visible: true,
          color: "#" + new THREE.Color(PALETTE[i % PALETTE.length]!).getHexString(),
          tris: triTotal,
        })),
      );
      setStats({ parseMs, gbk, parts: meshes.length, tris: Math.round(triTotal), totalMs: Math.round(performance.now() - t0) });
    };

    load().catch((err: unknown) => {
      setStats({ parseMs: null, gbk: false, parts: 0, tris: 0, totalMs: 0, error: String(err) });
    });

    disposers.push(() => {
      disposed = true;
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      gizmoRenderer.dispose();
      mount.removeChild(renderer.domElement);
      mount.removeChild(gizmoCanvas);
    });

    return () => {
      for (const d of disposers) {
        d();
      }
    };
  }, [src, name]);

  /** 剖切(clipOn/axis/pos 变化 → ClipPlane 应用到全部材质)。 */
  useEffect(() => {
    const engine = engineRef.current;
    if (engine === null) {
      return;
    }
    if (!clipOn) {
      if (engine.clipPlane !== null) {
        for (const mesh of engine.meshes) {
          (mesh.material as THREE.MeshStandardMaterial).clippingPlanes = null;
        }
        if (engine.clipHelper !== null) {
          engine.scene.remove(engine.clipHelper);
        }
        engine.clipPlane = null;
        engine.clipHelper = null;
      }
      return;
    }
    const box = new THREE.Box3().setFromObject(engine.group);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    if (engine.clipPlane === null) {
      engine.clipPlane = new THREE.Plane();
      engine.clipHelper = new THREE.PlaneHelper(engine.clipPlane, Math.max(size.x, size.y, size.z) * 1.2, 0x6ea8ff);
      engine.scene.add(engine.clipHelper);
    }
    const axis = clipAxis;
    engine.clipPlane.normal.set(axis === "x" ? -1 : 0, axis === "y" ? -1 : 0, axis === "z" ? -1 : 0);
    const half = size[axis] / 2;
    engine.clipPlane.constant = center[axis] + (clipPos / 100) * half;
    for (const mesh of engine.meshes) {
      (mesh.material as THREE.MeshStandardMaterial).clippingPlanes = [engine.clipPlane];
    }
  }, [clipOn, clipAxis, clipPos]);

  /** 爆炸图(零件沿「零件中心 − 模型中心」方向平移)。 */
  useEffect(() => {
    const engine = engineRef.current;
    if (engine === null) {
      return;
    }
    const box = new THREE.Box3().setFromObject(engine.group);
    const size = box.getSize(new THREE.Vector3()).length() || 1;
    engine.meshes.forEach((mesh, i) => {
      const dir = engine.baseDirs[i] ?? new THREE.Vector3();
      mesh.position.copy(dir).multiplyScalar(explodeOn ? 0.35 * size : 0);
    });
  }, [explodeOn, stats]);

  /** 测量点击(两点距离 / 直径):NDC 射线拾取。 */
  const distPointsRef = useRef<THREE.Vector3[]>([]);
  const onCanvasClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (measureMode === null || engineRef.current === null) {
      return;
    }
    const engine = engineRef.current;
    const rect = event.currentTarget.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    if (measureMode === "circ") {
      const r = engine.pickMeasure(ndc, "circ");
      if (r !== null) {
        setMeasure(r);
      }
      return;
    }
    const hit = engine.pickPoint(ndc);
    if (hit !== null) {
      distPointsRef.current.push(hit);
      if (distPointsRef.current.length === 2) {
        const [a, b] = distPointsRef.current as [THREE.Vector3, THREE.Vector3];
        distPointsRef.current = [];
        setMeasure({ kind: "dist", d: a.distanceTo(b), dx: Math.abs(a.x - b.x), dy: Math.abs(a.y - b.y), dz: Math.abs(a.z - b.z) });
      }
    }
  };

  return (
    <div className="flex h-[80vh] w-[min(92vw,calc(100vw-3rem))] flex-col overflow-hidden rounded-xl bg-[#14181f] shadow-2xl" data-cad-viewer="true">
      <div className="flex items-center gap-2 border-b border-[#2c3444] bg-[#1a1f2b] px-3 py-2 text-[12px]">
        <span className="font-semibold text-zinc-200">CAD 三维预览</span>
        <span className="text-[#6ea8ff]">{name}</span>
        <div className="mx-2 h-4 w-px bg-[#2c3444]" />
        <button
          type="button"
          className={measureToolClass(measureMode === "dist")}
          onClick={() => setMeasureMode(measureMode === "dist" ? null : "dist")}
        >
          测量
        </button>
        <button
          type="button"
          className={measureToolClass(measureMode === "circ")}
          onClick={() => setMeasureMode(measureMode === "circ" ? null : "circ")}
        >
          直径
        </button>
        <button
          type="button"
          className={measureToolClass(clipOn)}
          onClick={() => setClipOn(!clipOn)}
        >
          剖切
        </button>
        <button
          type="button"
          className={measureToolClass(explodeOn)}
          onClick={() => setExplodeOn(!explodeOn)}
        >
          爆炸图
        </button>
        {measure !== null ? (
          <span className="ml-2 rounded bg-[#2d4a8a] px-2 py-0.5 text-[11px] text-white">
            {measure.kind === "dist"
              ? "d = " + formatLength(measure.d) + " (ΔX " + formatLength(measure.dx) + " / ΔY " + formatLength(measure.dy) + " / ΔZ " + formatLength(measure.dz) + ")"
              : "Ø " + formatLength(measure.d) + " (R " + formatLength(measure.r) + " · 圆度 " + measure.circularity.toFixed(3) + ")"}
          </span>
        ) : null}
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={mountRef} className="absolute inset-0" onClick={onCanvasClick} />
        {stats !== null ? (
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-black/40 px-2 py-1 font-mono text-[11px] text-zinc-400">
            {stats.error !== undefined ? (
              <span className="text-red-400">加载失败: {stats.error}</span>
            ) : (
              <>
                {stats.parseMs !== null ? "STEP 解析 " + stats.parseMs + "ms" + (stats.gbk ? " · GBK 已转码" : "") + " · " : ""}
                {stats.parts} 零件 · {stats.tris} 三角形 · 加载 {stats.totalMs}ms
              </>
            )}
          </div>
        ) : null}
        {parts.length > 1 ? (
          <div className="absolute right-3 top-3 max-h-[60%] w-40 overflow-auto rounded-lg border border-[#2c3444] bg-[#1a1f2b]/90 p-1 text-[12px]">
            {parts.map((p, i) => (
              <button
                key={i}
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-zinc-300 hover:bg-[#232a38]"
                onClick={() => {
                  setParts((prev) => prev.map((q, j) => (j === i ? { ...q, visible: !q.visible } : q)));
                  const mesh = engineRef.current?.meshes[i];
                  if (mesh !== undefined) {
                    mesh.visible = !mesh.visible;
                  }
                }}
              >
                <span className="inline-block h-2 w-2 flex-shrink-0 rounded-sm" style={{ background: p.color }} />
                <span className={"truncate " + (p.visible ? "" : "opacity-40")}>{p.name}</span>
              </button>
            ))}
          </div>
        ) : null}
        {clipOn ? (
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-[#2c3444] bg-[#1a1f2b]/90 px-4 py-2 text-[12px] text-zinc-300">
            <span>剖切面</span>
            <select
              className="rounded bg-[#232a38] px-1 py-0.5 text-zinc-200"
              value={clipAxis}
              onChange={(e) => setClipAxis(e.target.value as "x" | "y" | "z")}
            >
              <option value="x">X 轴</option>
              <option value="y">Y 轴</option>
              <option value="z">Z 轴</option>
            </select>
            <input
              type="range"
              min={-100}
              max={100}
              value={clipPos}
              className="w-44 accent-[#6ea8ff]"
              onChange={(e) => setClipPos(Number(e.target.value))}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function measureToolClass(active: boolean): string {
  return "rounded-md px-2 py-1 text-zinc-300 transition hover:bg-[#232a38] " + (active ? "bg-[#2d4a8a] text-white" : "");
}


