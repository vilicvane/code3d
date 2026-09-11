import {
  AgentError,
  encodeBase64,
  failure,
  resolveRenderView,
  type AgentResponse,
  type Artifact,
  type TopologyOutputOptions,
} from '@code3d/agent';
import {
  sameTopologyId,
  type TopologyId,
  type TopologyKind,
  type Transform,
} from '@code3d/core/tooling';
import {Matrix4, Quaternion, Vector3} from 'three';
import {ModelCompilerClient} from '../model/compiler-client';
import {ModelDiagnosticError} from '../model/diagnostic';
import type {ModelModule} from '../model/compiler';
import {sourceDecorationProviders} from '../model/source-decorations';
import type {ProjectFileReader} from '../project/file-reader';
import {ModelViewport} from '../viewport';
import {SketchEditor} from '../ui/sketch-editor';
import {viewportDiagnostic} from '../model/viewport-diagnostic';
import {
  describeSketch,
  inspectSketch,
  observeSketch,
  type ObservedSketch,
} from './sketch';
import type {AgentObservation} from './project-session';

type ObservedBrep = {
  kind: 'brep';
  key: string;
  nodeId: string;
  role: 'result' | 'operation-input';
  transform: Transform;
  selectable?: {
    kind: TopologyKind;
    ids: readonly TopologyId[];
    selectedIds: readonly TopologyId[];
  };
};
type ObservedModel = ObservedBrep | ObservedSketch;
type Snapshot = {
  id: string;
  request: AgentObservation;
  module: ModelModule;
  models: ObservedModel[];
  createdAt: string;
  summaries: Map<
    string,
    Pick<import('@code3d/core/tooling').TopologyInspection, 'counts' | 'bounds'>
  >;
};

/** One serialized offscreen renderer uses the exact GUI compiler, source selection and image export. */
export class AgentObserver {
  private readonly compiler: ModelCompilerClient;
  private viewport?: ModelViewport;
  private queue: Promise<unknown> = Promise.resolve();
  private snapshot?: Snapshot;

  constructor(
    files: ProjectFileReader,
    private readonly revision: () => number,
    prepareProject?: ConstructorParameters<typeof ModelCompilerClient>[2],
  ) {
    this.compiler = new ModelCompilerClient(files, undefined, prepareProject);
  }

  observe(request: AgentObservation): Promise<AgentResponse> {
    const pending = this.queue
      .then(() => this.run(request))
      .catch(error => {
        if (!(error instanceof ModelDiagnosticError)) throw error;
        return failure(
          'model_failed',
          error.diagnostic.summary,
          error.diagnostic,
        );
      });
    this.queue = pending.catch(() => {});
    return pending;
  }

  invalidate(): void {
    this.snapshot = undefined;
    this.compiler.cancel();
  }

  private async run(request: AgentObservation): Promise<AgentResponse> {
    if (request.revision !== this.revision())
      throw new AgentError(
        'observation_superseded',
        'Project changed before observation began.',
      );
    const options =
      typeof request.input.topology === 'object' ? request.input.topology : {};
    let snapshot: Snapshot;
    if (options.snapshotId) {
      const existing = this.snapshot;
      if (
        !existing ||
        existing.id !== options.snapshotId ||
        existing.request.agentId !== request.agentId ||
        existing.request.revision !== request.revision ||
        Date.now() - Date.parse(existing.createdAt) > 5 * 60_000 ||
        !this.compiler.canExport(existing.module)
      )
        throw new AgentError(
          'snapshot_expired',
          'This observation snapshot is no longer available. Request a new observation before paging.',
        );
      snapshot = existing;
    } else {
      this.snapshot = undefined;
      const module = await this.compiler.compile(
        request.project,
        request.cursor.file,
        {
          file: request.cursor.file,
          offset: request.cursor.start,
          ...(request.arguments === undefined
            ? {}
            : {arguments: request.arguments}),
        },
      );
      const viewport = this.getViewport();
      viewport.renderModule(module);
      const selected = viewport.selectBySourceOffset(
        request.cursor.file,
        request.cursor.start,
        undefined,
        module.activeDesignContextId,
      );
      const sketchId = selected
        ? viewport.sourceEvaluation()?.evaluation.sketchIds?.[0]
        : undefined;
      const sketches = sketchId ? observeSketch(sketchId, module.sketches) : [];
      const diagnostic = sketches.length
        ? viewportDiagnostic(module.diagnostic, undefined, sketches[0].layers)
        : module.diagnostic;
      if (diagnostic)
        return failure('model_failed', diagnostic.summary, diagnostic);
      if (!selected)
        throw new AgentError(
          'observation_not_found',
          'The cursor has no observable model context. Select a sketch, model expression or operation.',
        );
      const models = sketches.length
        ? sketches
        : this.observeBrep(viewport, module);
      snapshot = {
        id: crypto.randomUUID(),
        request,
        module,
        models,
        createdAt: new Date().toISOString(),
        summaries: new Map(),
      };
      this.snapshot = snapshot;
    }
    const model = options.model
      ? snapshot.models.find(model => model.key === options.model)
      : snapshot.models[0];
    if (!model)
      throw new AgentError(
        'topology_model_missing',
        'The requested model is absent from this observation snapshot.',
      );
    const renderOptions =
      typeof request.input.render === 'object' ? request.input.render : {};
    const mode = renderOptions.mode ?? 'modeling';
    if (model.kind === 'sketch' && mode === 'render')
      throw new AgentError(
        'sketch_render_mode_unsupported',
        'Sketch renders use the 2D sketch editor. Omit render.mode or use modeling, or select a face/solid to use render mode.',
      );
    if (model.kind === 'sketch' && renderOptions.view)
      throw new AgentError(
        'sketch_view_unsupported',
        'Sketch renders use an orthographic local XY view. Omit render.view, or select a face/solid to use a 3D view.',
      );
    const topology = request.input.topology
      ? model.kind === 'sketch'
        ? inspectSketch(model, options)
        : await this.topology(snapshot, model, options)
      : undefined;
    const described = [];
    for (const entry of options.model
      ? [model]
      : snapshot.models.slice(0, 16)) {
      if (entry.kind === 'sketch') {
        described.push(describeSketch(entry));
        continue;
      }
      if (request.input.topology && !snapshot.summaries.has(entry.key)) {
        const summary = await this.compiler.inspectTopology(
          snapshot.module,
          entry.nodeId,
          {limit: 1, transform: entry.transform},
        );
        snapshot.summaries.set(entry.key, {
          counts: summary.counts,
          bounds: summary.bounds,
        });
      }
      described.push(this.describeModel(snapshot, entry));
    }
    const view =
      model.kind === 'sketch'
        ? undefined
        : resolveRenderView(renderOptions.view);
    let artifacts: Artifact[] | undefined;
    if (request.input.render) {
      // Scene restoration and earlier requests can leave another mode active.
      // Every capture, including retained snapshots, selects its own mode.
      if (model.kind !== 'sketch') this.getViewport().setRenderMode(mode);
      const blob =
        model.kind === 'sketch'
          ? await this.captureSketch(model, snapshot.request.revision)
          : await this.getViewport().captureImage(960, 720, view!);
      artifacts = [
        {
          name: 'render.png',
          mimeType: 'image/png',
          base64: encodeBase64(new Uint8Array(await blob.arrayBuffer())),
        },
      ];
    }
    return {
      ok: true,
      data: {
        snapshotId: snapshot.id,
        revision: snapshot.request.revision,
        cursor: snapshot.request.cursor,
        contextId:
          snapshot.module.activeDesignContextId ??
          this.getViewport().sourceEvaluation()?.evaluation.contextId,
        arguments: snapshot.request.arguments ?? null,
        argumentSource:
          snapshot.request.arguments === undefined
            ? snapshot.module.activeDesignContextId
              ? 'jsdoc'
              : 'ordinary'
            : 'explicit',
        createdAt: snapshot.createdAt,
        modelsTotal: snapshot.models.length,
        models: described,
        ...(!options.model && snapshot.models.length > 16
          ? {nextModel: snapshot.models[16].key}
          : {}),
        ...(topology ? {topology: {model: model.key, ...topology}} : {}),
        ...(request.input.render
          ? {
              render: {
                capturedAt: new Date().toISOString(),
                width: 960,
                height: 720,
                mimeType: 'image/png',
                mode,
                ...(model.kind === 'sketch'
                  ? {
                      model: model.key,
                      view: 'xy',
                      projection: 'orthographic',
                      coordinates: 'sketch-local',
                    }
                  : {
                      view,
                      projection: 'perspective',
                      coordinates: 'observation-scene',
                    }),
              },
            }
          : {}),
      },
      ...(artifacts ? {artifacts} : {}),
    };
  }

  private observeBrep(
    viewport: ModelViewport,
    module: ModelModule,
  ): ObservedBrep[] {
    const scene = viewport.exportScene();
    if (!scene?.instances.length)
      throw new AgentError(
        'observation_not_found',
        'The selected context did not produce renderable geometry.',
      );
    const models: ObservedBrep[] = [];
    const selection = viewport.sourceEvaluation()?.evaluation.selection;
    const occurrence = viewport.getSelected();
    if (selection && occurrence) {
      const scope = 'scope' in selection ? selection.scope : undefined;
      const input = module.objects.get(
        scope?.geometryNodeId ?? selection.inputNodeId,
      );
      const kind = selection.kind === 'edges' ? 'edge' : selection.kind;
      if (input && input.kind !== 'group') {
        const ids = viewport.beginTopologySelection(
          occurrence.key,
          selection.inputNodeId,
          kind,
          true,
          selection.ids,
          scope,
        );
        let transform: Transform;
        if (scope) {
          occurrence.object.updateWorldMatrix(true, false);
          const matrix = new Matrix4().compose(
            new Vector3(...scope.transform.position),
            new Quaternion(...scope.transform.quaternion),
            new Vector3(...scope.transform.scale),
          );
          matrix.premultiply(occurrence.object.matrixWorld);
          const position = new Vector3(),
            quaternion = new Quaternion(),
            scale = new Vector3();
          matrix.decompose(position, quaternion, scale);
          transform = {
            position: position.toArray(),
            quaternion: quaternion.toArray(),
            scale: scale.toArray(),
          };
        } else
          transform =
            occurrence.placement === 'composition'
              ? input.compositionTransform
              : input.transform;
        models.push({
          kind: 'brep',
          key: 'm0',
          nodeId: input.nodeId,
          role: 'operation-input',
          transform,
          selectable: {kind, ids, selectedIds: selection.ids},
        });
      }
    }
    for (const instance of scene.instances)
      models.push({
        kind: 'brep',
        key: 'm' + models.length,
        nodeId: instance.nodeId,
        role: 'result',
        transform: {...instance.transform, scale: [1, 1, 1]},
      });
    return models;
  }

  private async topology(
    snapshot: Snapshot,
    model: ObservedBrep,
    options: TopologyOutputOptions,
  ) {
    const kind = options.kind ?? model.selectable?.kind;
    const allowed =
      model.selectable && model.selectable.kind === kind
        ? model.selectable.ids
        : undefined;
    if (
      allowed &&
      options.ids?.some(
        id => !allowed.some(candidate => sameTopologyId(candidate, id)),
      )
    )
      throw new AgentError(
        'topology_id_out_of_scope',
        'A requested ID is outside the legal input selection for this operation.',
      );
    const result = await this.compiler.inspectTopology(
      snapshot.module,
      model.nodeId,
      {
        kind,
        ids: options.ids ?? allowed,
        offset: options.offset,
        limit: options.limit,
        transform: model.transform,
      },
    );
    snapshot.summaries.set(model.key, {
      counts: result.counts,
      bounds: result.bounds,
    });
    return {
      ...result,
      items: result.items.map(item => ({
        ...item,
        selector: `.${item.kind}(${JSON.stringify(item.id)})`,
        selectable:
          model.selectable?.kind === item.kind &&
          model.selectable.ids.some(id => sameTopologyId(id, item.id)),
      })),
    };
  }

  private describeModel(snapshot: Snapshot, model: ObservedBrep) {
    const node = snapshot.module.objects.get(model.nodeId)!;
    return {
      key: model.key,
      nodeId: model.nodeId,
      name: node.name,
      kind: node.kind,
      role: model.role,
      geometryToScene: model.transform,
      storedOrigin: node.origin,
      sourceRefs: node.sourceRefs,
      bindings: snapshot.module.catalog
        .filter(
          entry =>
            entry.category === 'binding' && entry.nodeIds.includes(node.nodeId),
        )
        .map(entry => ({
          name: entry.label,
          scope: entry.scope,
          sourceRef: entry.sourceRef,
        })),
      elements: node.elements.map(element => ({
        name: element.name,
        kind: element.kind,
        ...(element.topology ? {topology: element.topology} : {}),
      })),
      ...snapshot.summaries.get(model.key),
      ...(model.selectable
        ? {
            selectable: {
              kind: model.selectable.kind,
              total: model.selectable.ids.length,
              selectedIds: model.selectable.selectedIds,
            },
          }
        : {}),
    };
  }

  private async captureSketch(
    model: ObservedSketch,
    revision: number,
  ): Promise<Blob> {
    const host = this.createRenderHost();
    const editor = new SketchEditor(
      host,
      () => false,
      async () => {
        throw new Error('An observation cannot edit the sketch.');
      },
      () => {},
    );
    try {
      editor.show({
        key: model.layer.id,
        id: model.layer.id,
        revision,
        layers: model.layers,
        data: model.layer.data,
        editable: new Map(),
        constraintValues: new Map(),
        referenceable: new Set(Object.keys(model.layer.references)),
        readOnlyReason: 'Agent observation',
      });
      return await editor.captureImage(960, 720);
    } finally {
      editor.dispose();
      host.remove();
    }
  }

  private createRenderHost(): HTMLDivElement {
    const host = document.createElement('div');
    host.className = 'agent-render-host';
    host.setAttribute('aria-hidden', 'true');
    host.inert = true;
    document.body.append(host);
    return host;
  }

  private getViewport(): ModelViewport {
    if (this.viewport) return this.viewport;
    const host = this.createRenderHost();
    this.viewport = new ModelViewport(host, {
      animateViewChanges: false,
      onSelect() {},
      onDrillDown() {},
      onNavigateSource() {},
      onPositionTool() {},
      onTopologySelection() {},
      sourceDecorationProviders,
    });
    return this.viewport;
  }
}
