/**
 * Importuri Babylon „la bucată” (tree-shaking): doar ce folosim + componentele cu efecte secundare.
 * Restul codului importă din acest fișier, nu din "@babylonjs/core".
 */
export { Engine } from "@babylonjs/core/Engines/engine";
export { Scene } from "@babylonjs/core/scene";
export { Vector3, Matrix, Quaternion } from "@babylonjs/core/Maths/math.vector";
export { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
export { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
export { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
export { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
export { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
export { Material } from "@babylonjs/core/Materials/material";
export { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
export { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
export { Mesh } from "@babylonjs/core/Meshes/mesh";
export { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
export { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
export { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
export { TransformNode } from "@babylonjs/core/Meshes/transformNode";
export { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
export { AssetContainer } from "@babylonjs/core/assetContainer";
export { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
export { SceneLoaderFlags } from "@babylonjs/core/Loading/sceneLoaderFlags";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
export const MeshBuilder = { CreateBox, CreateTorus, CreateGround };

import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import "@babylonjs/core/Culling/ray";
