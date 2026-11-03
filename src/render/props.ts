import { Matrix, Mesh, Quaternion, Scene, ShadowGenerator, Vector3 } from "./babylon";
import { GameMap } from "../map/gameMap";
import { ModelLibrary } from "./models";

/** Copaci și stânci ca thin instances (un draw call per sub-mesh și model). */
export async function buildProps(scene: Scene, lib: ModelLibrary, m: GameMap, shadows: ShadowGenerator | null) {
  const byModel = new Map<string, typeof m.props>();
  for (const p of m.props) {
    if (!byModel.has(p.model)) byModel.set(p.model, []);
    byModel.get(p.model)!.push(p);
  }
  await Promise.all(
    [...byModel].map(async ([model, list]) => {
      const tpl = await lib.template(model, null, 1, "height");
      const savedY = tpl.position.y;
      tpl.position.y = 0;
      tpl.computeWorldMatrix(true);
      const inv = tpl.getWorldMatrix().clone().invert();
      for (const src of tpl.getChildMeshes(false)) {
        if (!(src instanceof Mesh) || src.getTotalVertices() === 0) continue;
        src.computeWorldMatrix(true);
        const rel = src.getWorldMatrix().multiply(inv);
        const mesh = src.clone(`props:${model}:${src.name}`, null, true)!;
        mesh.parent = null;
        mesh.position.setAll(0);
        mesh.rotationQuaternion = Quaternion.Identity();
        mesh.scaling.setAll(1);
        mesh.isPickable = false;
        mesh.isVisible = true;
        const mats = list.map((p) =>
          rel.multiply(Matrix.Compose(new Vector3(p.scale, p.scale, p.scale), Quaternion.RotationAxis(Vector3.Up(), p.rot), new Vector3(p.x, 0, p.z))),
        );
        mesh.thinInstanceAdd(mats);
        mesh.thinInstanceRefreshBoundingInfo(false);
        mesh.receiveShadows = true;
        shadows?.addShadowCaster(mesh, false);
        mesh.freezeWorldMatrix();
      }
      tpl.position.y = savedY;
    }),
  );
}
