import {
  AgentError,
  encodeBase64,
  failure,
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
import type {ModelModule} from '../model/compiler';
import {sourceDecorationProviders} from '../model/source-decorations';
import type {ProjectFileReader} from '../project/file-reader';
import {ModelViewport} from '../viewport';
import type {AgentObservation} from './project-session';

type ObservedModel = {
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
type Snapshot = {
  id: string;
  request: AgentObservation;
  module: ModelModule;
  models: ObservedModel[];
  createdAt: string;
  artifacts?: Artifact[];
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
  ) {
    this.compiler = new ModelCompilerClient(files);
  }

  observe(request: AgentObservation): Promise<AgentResponse> {
    const pending = this.queue.then(() => this.run(request));
    this.queue = pending.catch(() => {});
    return pending;
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
      if (module.diagnostic)
        return failure(
          'model_failed',
          module.diagnostic.summary,
          module.diagnostic,
        );
      const viewport = this.getViewport();
      viewport.renderModule(module);
      if (
        !viewport.selectBySourceOffset(
          request.cursor.file,
          request.cursor.start,
          undefined,
          module.activeDesignContextId,
        )
      )
        throw new AgentError(
          'observation_not_found',
          'The cursor has no renderable model context. Select the relevant expression or operation.',
        );
      const scene = viewport.exportScene();
      if (!scene?.instances.length)
        throw new AgentError(
          'observation_not_found',
          'The selected context did not produce renderable geometry.',
        );
      const models: ObservedModel[] = [];
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
          key: 'm' + models.length,
          nodeId: instance.nodeId,
          role: 'result',
          transform: {...instance.transform, scale: [1, 1, 1]},
        });
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
    const topology = request.input.topology
      ? await this.topology(snapshot, model, options)
      : undefined;
    if (topology)
      snapshot.summaries.set(model.key, {
        counts: topology.counts,
        bounds: topology.bounds,
      });
    const described = [];
    for (const entry of options.model
      ? [model]
      : snapshot.models.slice(0, 16)) {
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
    if (request.input.render && !snapshot.artifacts) {
      const blob = await this.getViewport().captureImage(960, 720);
      snapshot.artifacts = [
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
          ? {nextModel: 'm16'}
          : {}),
        ...(topology ? {topology: {model: model.key, ...topology}} : {}),
        ...(request.input.render
          ? {render: {width: 960, height: 720, mimeType: 'image/png'}}
          : {}),
      },
      ...(request.input.render ? {artifacts: snapshot.artifacts} : {}),
    };
  }

  private async topology(
    snapshot: Snapshot,
    model: ObservedModel,
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

  private describeModel(snapshot: Snapshot, model: ObservedModel) {
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

  private getViewport(): ModelViewport {
    if (this.viewport) return this.viewport;
    const host = document.createElement('div');
    host.className = 'agent-render-host';
    host.setAttribute('aria-hidden', 'true');
    host.inert = true;
    document.body.append(host);
    this.viewport = new ModelViewport(host, {
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
