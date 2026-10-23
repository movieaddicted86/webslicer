/**
 * The one upload path of the plater (q4-web-store, AC-5): binary STL, `uploadError` bookkeeping and
 * the error toast live here once. `addObjects`, `uploadVolume`, `splitToParts` and `startPaint` call
 * it; the caller supplies the update action the result belongs to and its toast.
 */
import { api } from '../api';
import { geometryToStl, type GeometryLike } from '../plater/meshInfo';

/**
 * Upload one mesh and hand the result to `apply` (the caller's update action). A failure sets
 * `uploadError` and raises the upload error toast every caller shows.
 */
export async function uploadMesh(
  geometry: GeometryLike,
  name: string,
  apply: (patch: { modelId?: string; uploadError?: string }) => void,
  toast: (text: string) => void,
): Promise<void> {
  try {
    const res = await api.uploadModel(geometryToStl(geometry), name);
    apply({ modelId: res.id });
  } catch (e) {
    const message = (e as Error).message;
    apply({ uploadError: message });
    toast(`Upload of ${name} failed: ${message}`);
  }
}
