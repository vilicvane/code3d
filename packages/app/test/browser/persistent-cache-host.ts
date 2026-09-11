import {ArtifactStoreHost} from '../../src/model/artifact-store-host';
import CacheWorker from './persistent-cache.worker?worker';

// The page owns persistence even when a test forcibly terminates its model Worker.
const storage = new ArtifactStoreHost();
export default class PersistentCacheWorker extends CacheWorker {
  constructor() {
    super();
    storage.connect(this);
  }
  cancelReads(): void {
    storage.cancelReads(this);
  }
  override terminate(): void {
    super.terminate();
    storage.disconnect(this);
  }
}
