// MDLv10 uses independent rigid bone indices for positions and normals.
// Keep local source vertices on the GPU; upload only the current bone palette.
export function createRigidSkinning(THREE, matrices, mode = 'gpu') {
  if (!['gpu', 'cpu'].includes(mode)) throw new Error(`Unknown skinning mode: ${mode}`);
  const gpu = mode === 'gpu', bindings = [];
  const palette = gpu ? new Float32Array(matrices.length * 16) : null;
  const texture = gpu ? new THREE.DataTexture(palette, 4, matrices.length, THREE.RGBAFormat, THREE.FloatType) : null;
  if (texture) {
    texture.name = 'goldsrc-bone-palette'; texture.minFilter = texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false; texture.flipY = false; texture.needsUpdate = true;
  }
  const scratch = new THREE.Vector3();
  let disposed = false;
  function material(material) {
    if (!gpu) return;
    material.onBeforeCompile = shader => {
      shader.uniforms.goldsrcBones = {value: texture};
      shader.vertexShader = `uniform sampler2D goldsrcBones;
attribute float goldsrcVertexBone;
attribute float goldsrcNormalBone;
mat4 goldsrcMatrix(float bone) {
  int row = int(bone);
  return mat4(texelFetch(goldsrcBones, ivec2(0, row), 0),
              texelFetch(goldsrcBones, ivec2(1, row), 0),
              texelFetch(goldsrcBones, ivec2(2, row), 0),
              texelFetch(goldsrcBones, ivec2(3, row), 0));
}
` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
        'vec3 transformed = (goldsrcMatrix(goldsrcVertexBone) * vec4(position, 1.0)).xyz;');
      shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\nobjectNormal = normalize(mat3(goldsrcMatrix(goldsrcNormalBone)) * objectNormal);');
    };
    material.customProgramCacheKey = () => 'goldsrc-rigid-texture-v1';
  }
  function geometry(geometry, spec) {
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(spec.positions, 3).setUsage(gpu ? THREE.StaticDrawUsage : THREE.DynamicDrawUsage));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(spec.normals, 3).setUsage(gpu ? THREE.StaticDrawUsage : THREE.DynamicDrawUsage));
    if (gpu) {
      geometry.setAttribute('goldsrcVertexBone', new THREE.Float32BufferAttribute(spec.vertexBones, 1));
      geometry.setAttribute('goldsrcNormalBone', new THREE.Float32BufferAttribute(spec.normalBones, 1));
    }
    bindings.push({geometry, spec});
  }
  function update(meshes) {
    if (disposed) return;
    if (gpu) {
      for (let i = 0; i < matrices.length; i++) matrices[i].toArray(palette, i * 16);
      texture.needsUpdate = true;
      return;
    }
    for (let i = 0; i < bindings.length; i++) {
      if (!meshes[i].visible) continue;
      const {geometry, spec} = bindings[i], out = geometry.attributes.position, normal = geometry.attributes.normal;
      for (let v = 0; v < out.count; v++) {
        scratch.fromArray(spec.positions, v * 3).applyMatrix4(matrices[spec.vertexBones[v]]);
        out.setXYZ(v, scratch.x, scratch.y, scratch.z);
        scratch.fromArray(spec.normals, v * 3).transformDirection(matrices[spec.normalBones[v]]);
        normal.setXYZ(v, scratch.x, scratch.y, scratch.z);
      }
      out.needsUpdate = normal.needsUpdate = true;
    }
  }
  return {mode, material, geometry, update, texture,
    dispose() { if (disposed) return; disposed = true; texture?.dispose(); bindings.length = 0; }};
}
