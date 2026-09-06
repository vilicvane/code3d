export {default} from 'replicad-opencascadejs';
export type * from 'replicad-opencascadejs';

// Embind supplies these handle operations, omitted by the generated declarations.
export interface EmbindHandle {
  delete(): void;
  clone(): this;
  isDeleted(): boolean;
}

declare module 'replicad-opencascadejs' {
  interface TopoDS_Shape extends EmbindHandle {}
  interface gp_Pnt extends EmbindHandle {}
  interface TopExp_Explorer extends EmbindHandle {}
  interface NCollection_List_TopoDS_Shape extends EmbindHandle {}
  interface BRepOffsetAPI_MakeThickSolid extends EmbindHandle {}
  interface BRepOffsetAPI_MakeOffsetShape extends EmbindHandle {}
  interface BRepCheck_Analyzer extends EmbindHandle {}
  interface GProp_GProps extends EmbindHandle {}
}
