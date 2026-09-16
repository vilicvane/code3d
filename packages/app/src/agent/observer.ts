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
  type ModelSnapshotObject,
  type TopologyId,
  type TopologyKind,
  type Transform,
} from '@code3d/core/tooling';
import {Matrix4, Quaternion, Vector3} from 'three';
import {ModelCompilerClient} from '../model/compiler-client';
import {ModelDiagnosticError, type ModelDiagnostic} from '../model/diagnostic';
import type {ModelModule} from '../model/compiler';
import {sourceDecorationProviders} from '../model/source-decorations';
import type {ProjectFileReader} from '../project/file-reader';
import {ModelViewport} from '../viewport';
import type {InspectionSnapshot} from '../model/inspection-snapshot';
import {collectExportInstances} from '../rendering/model-export-scene';
import {sketchDiagnostic} from '../model/viewport-diagnostic';
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
  scene: InspectionSnapshot;
  diagnostic?: ModelDiagnostic;
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
    prepareProject?: ConstructorParameters<typeof ModelCompilerClient>[1],
  ) {
    this.compiler = new ModelCompilerClient(files, prepareProject);
  }

  observe(request: AgentObservation): Promise<AgentResponse> {
    const pending = this.queue
      .then(() => this.run(request))
      .catch(error => {
        if (!(error instanceof ModelDiagnosticError)) throw error;
        return failure(
          error.diagnostic.kind === 'inspect'
            ? 'inspect_failed'
            : 'model_failed',
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
      const scope = viewport.sourceEvaluationAt(
        module,
        request.cursor.file,
        request.cursor.start,
        module.activeDesignContextId,
      );
      const selection = {
        file: request.cursor.file,
        offset: request.cursor.start,
        contextId: scope?.evaluation.contextId ?? module.activeDesignContextId,
        order: scope?.evaluation.runtime.order,
        callId: scope?.evaluation.inspectCallId,
      };
      let scene: InspectionSnapshot | undefined;
      try {
        scene = await this.compiler.inspect(module, selection);
      } catch (error) {
        if (!module.diagnostic || !(error instanceof ModelDiagnosticError))
          throw error;
        return failure('model_failed', module.diagnostic.summary, {
          ...module.diagnostic,
          inspectionDiagnostic: error.diagnostic,
        });
      }
      const sketches: ObservedSketch[] = [];
      const foregroundSketches = new Set<ObservedSketch>();
      const seen = new Set<string>();
      for (const item of [
        ...(scene?.target ?? []),
        ...(scene?.ambient ?? []),
      ]) {
        if (item.kind !== 'sketch' || seen.has(item.sketchId)) continue;
        seen.add(item.sketchId);
        for (const sketch of observeSketch(item.sketchId, scene!.sketches)) {
          const entry = {
            ...sketch,
            key: `s${sketches.length}`,
            geometryToScene: item.model.compositionTransform,
          };
          sketches.push(entry);
          if (scene!.target.includes(item)) foregroundSketches.add(entry);
        }
      }
      const diagnostic =
        sketches.length && scope?.evaluation.runtime.outcome !== 'failed'
          ? sketchDiagnostic(
              module.diagnostic,
              sketches.flatMap(sketch => sketch.layers),
            )
          : module.diagnostic;
      if (diagnostic && !scene)
        return failure('model_failed', diagnostic.summary, diagnostic);
      if (!scene)
        throw new AgentError(
          'observation_not_found',
          'The cursor has no observable model context. Select a sketch, model expression or operation.',
        );
      viewport.renderInspection(module, scene, selection);
      const breps = this.observeBrep(viewport, module);
      const targets = new Set(
        viewport.exportScene()?.instances.map(instance => instance.nodeId),
      );
      const foreground = (model: ObservedBrep) =>
        model.role === 'operation-input' || targets.has(model.nodeId);
      const models = [
        ...breps.filter(foreground),
        ...sketches.filter(model => foregroundSketches.has(model)),
        ...breps.filter(model => !foreground(model)),
        ...sketches.filter(model => !foregroundSketches.has(model)),
      ];
      snapshot = {
        id: crypto.randomUUID(),
        request,
        module,
        scene,
        diagnostic,
        models,
        createdAt: new Date().toISOString(),
        summaries: new Map(),
      };
      this.snapshot = snapshot;
    }
    const model = options.model
      ? snapshot.models.find(model => model.key === options.model)
      : snapshot.models[0];
    if (
      !model &&
      (options.model || (request.input.topology && !snapshot.diagnostic))
    )
      throw new AgentError(
        'topology_model_missing',
        'The requested model is absent from this observation snapshot.',
      );
    const renderOptions =
      typeof request.input.render === 'object' ? request.input.render : {};
    const mode = renderOptions.mode ?? 'modeling';
    const topology =
      request.input.topology && model
        ? model.kind === 'sketch'
          ? inspectSketch(model, options)
          : await this.topology(snapshot, model, options)
        : undefined;
    const described = [];
    for (const entry of options.model
      ? [model!]
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
    const view = resolveRenderView(renderOptions.view);
    let artifacts: Artifact[] | undefined;
    if (request.input.render) {
      // Each capture, including retained snapshots, owns its render mode.
      this.getViewport().setRenderMode(mode);
      const blob = await this.getViewport().captureImage(960, 720, view);
      artifacts = [
        {
          name: 'render.png',
          mimeType: 'image/png',
          base64: encodeBase64(new Uint8Array(await blob.arrayBuffer())),
        },
      ];
    }
    const data = {
      snapshotId: snapshot.id,
      revision: snapshot.request.revision,
      cursor: snapshot.request.cursor,
      contextId:
        snapshot.module.activeDesignContextId ??
        this.getViewport().sourceContext?.evaluation.contextId,
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
      ...(topology ? {topology: {model: model!.key, ...topology}} : {}),
      ...(request.input.render
        ? {
            render: {
              capturedAt: new Date().toISOString(),
              width: 960,
              height: 720,
              mimeType: 'image/png',
              mode,
              view,
              projection: 'perspective',
              coordinates: 'observation-scene',
            },
          }
        : {}),
    };
    return snapshot.diagnostic
      ? failure(
          'model_failed',
          snapshot.diagnostic.summary,
          {...snapshot.diagnostic, ...data},
          artifacts,
        )
      : {ok: true, data, ...(artifacts ? {artifacts} : {})};
  }

  private observeBrep(
    viewport: ModelViewport,
    module: ModelModule,
  ): ObservedBrep[] {
    const instances = collectExportInstances(
      viewport.renderedOccurrences().filter(({node}) => node.mesh),
    );
    const models: ObservedBrep[] = [];
    const selection = viewport.sourceContext?.evaluation.selection;
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
    for (const instance of instances)
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
    const node: ModelSnapshotObject =
      snapshot.scene.objects.get(model.nodeId) ??
      snapshot.module.objects.get(model.nodeId)!;
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
            entry.category === 'binding' &&
            entry.nodeIds.includes(node.sourceNodeId ?? node.nodeId),
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
