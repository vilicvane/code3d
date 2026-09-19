// Raw HTML fixtures cannot use bare imports; Vite transforms this module's
// imports to URLs with the current optimized-dependency hash.
export {BoxGeometry, Mesh, MeshBasicMaterial, Vector3} from 'three';
export {observable, runInAction} from 'mobx';
