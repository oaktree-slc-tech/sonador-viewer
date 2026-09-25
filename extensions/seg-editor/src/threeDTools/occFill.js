// Smooth hole patches with OpenCascade.js (ohif-viewers#142, FR-20): an N-sided surface is fitted
// to a hole's boundary (BRepOffsetAPI_MakeFilling, an energy-minimising plate surface through the
// boundary edges) and meshed. Runs in the hole-filling worker; `oc` is the loaded OpenCascade.js
// instance (Zalo's CascadeStudio build).


// BRepOffsetAPI_MakeFilling parameters: degree 3, 15 points per constraint edge, 2 iterations,
// no anisotropy, tolerances (2d, 3d, angular, curvature), max degree 8, max 9 segments.
const FILLING_PARAMETERS = [3, 15, 2, false, 1e-5, 1e-4, 1e-2, 0.1, 8, 9];

// Poly_MeshPurpose_NONE: any triangulation of the face
const MESH_PURPOSE_ANY = 0;

function _meanEdgeLength(positions) {
  const count = positions.length / 3;
  let total = 0;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    total += Math.hypot(
      positions[3 * j] - positions[3 * i],
      positions[3 * j + 1] - positions[3 * i + 1],
      positions[3 * j + 2] - positions[3 * i + 2]);
  }
  return total / count;
}

/**
 * Fit a smooth patch to a closed boundary and mesh it.
 *
 * @param {Object} oc - OpenCascade.js instance
 * @param {Float64Array|number[]} positions - flat xyz of the boundary vertices, in order (the
 *   closing edge back to the first vertex is implied)
 * @param {Object} [options]
 * @param {number} [options.deflection] - meshing deflection (world units); defaults to half the
 *   boundary's mean edge length, so the patch's triangles are comparable to the surface's
 * @returns {{ points: Float64Array, triangles: Int32Array, fitError: number }} the patch mesh
 * @throws when no surface can be fitted or meshed
 */
export function fillBoundary(oc, positions, { deflection } = {}) {
  const count = positions.length / 3;
  if (count < 3) {
    throw new Error(`A boundary needs at least 3 vertices (got ${count})`);
  }
  const linearDeflection = deflection || _meanEdgeLength(positions) * 0.5;

  const owned = [];
  const own = object => {
    owned.push(object);
    return object;
  };

  try {
    const point = i => own(new oc.gp_Pnt_3(positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]));
    const filling = own(new oc.BRepOffsetAPI_MakeFilling(...FILLING_PARAMETERS));
    for (let i = 0; i < count; i++) {
      const edge = own(new oc.BRepBuilderAPI_MakeEdge_3(point(i), point((i + 1) % count)));
      if (!edge.IsDone()) {
        throw new Error(`Boundary edge ${i} could not be built (repeated vertex?)`);
      }
      filling.Add_1(edge.Edge(), oc.GeomAbs_Shape.GeomAbs_C0, true);
    }

    filling.Build(own(new oc.Message_ProgressRange_1()));
    if (!filling.IsDone()) {
      throw new Error('No surface could be fitted to the boundary');
    }
    const fitError = filling.G0Error_1();
    const shape = filling.Shape();

    own(new oc.BRepMesh_IncrementalMesh_2(shape, linearDeflection, false, 0.5, false));

    const points = [];
    const triangles = [];
    const explorer = own(new oc.TopExp_Explorer_2(
      shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE));
    for (; explorer.More(); explorer.Next()) {
      const face = oc.TopoDS_Cast.Face_1(explorer.Current());
      const location = own(new oc.TopLoc_Location_1());
      const handle = oc.BRep_Tool.Triangulation(face, location, MESH_PURPOSE_ANY);
      if (handle.IsNull()) {
        continue;
      }
      const triangulation = handle.get();
      const transform = location.IsIdentity() ? null : location.Transformation();
      const offset = points.length / 3;

      for (let n = 1; n <= triangulation.NbNodes(); n++) {
        let node = triangulation.Node(n);
        if (transform) {
          node = node.Transformed(transform);
        }
        points.push(node.X(), node.Y(), node.Z());
      }

      const reversed = face.Orientation_1() !== oc.TopAbs_Orientation.TopAbs_FORWARD;
      for (let t = 1; t <= triangulation.NbTriangles(); t++) {
        const triangle = triangulation.Triangle(t);
        const a = offset + triangle.Value(1) - 1;
        const b = offset + triangle.Value(2) - 1;
        const c = offset + triangle.Value(3) - 1;
        if (reversed) {
          triangles.push(a, c, b);
        } else {
          triangles.push(a, b, c);
        }
      }
    }

    if (!triangles.length) {
      throw new Error('The fitted surface could not be meshed');
    }
    return { points: Float64Array.from(points), triangles: Int32Array.from(triangles), fitError };
  } finally {
    owned.forEach(object => {
      try {
        object.delete();
      } catch (err) {
        // already released with its owner
      }
    });
  }
}
