import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';

/** Serve the exact packed bytes through ordinary npm metadata and archive URLs. */
export class ArtifactRegistry {
  constructor(artifacts) {
    this.artifacts = artifacts;
  }

  async response(url, origin = 'https://registry.npmjs.org') {
    const pathname = decodeURIComponent(new URL(url).pathname).replace(
      /\/$/,
      '',
    );
    if (!pathname.startsWith('/@code3d/')) return undefined;
    const artifact = this.artifacts.find(
      item =>
        pathname === '/' + item.name ||
        pathname.startsWith('/' + item.name + '/'),
    );
    if (!artifact)
      return new Response('No current artifact for ' + pathname, {status: 404});
    const tarball = new URL(new URL(artifact.tarball).pathname, origin).href;
    if (pathname === decodeURIComponent(new URL(tarball).pathname))
      return new Response(await readFile(artifact.filename), {
        headers: {'content-type': 'application/octet-stream'},
      });
    const metadata = {
      ...artifact.manifest,
      dist: {tarball, integrity: artifact.integrity},
    };
    if (pathname === '/' + artifact.name)
      return Response.json({
        name: artifact.name,
        versions: {[artifact.version]: metadata},
        'dist-tags': {latest: artifact.version},
      });
    if (pathname === '/' + artifact.name + '/' + artifact.version)
      return Response.json(metadata);
    return new Response('No current artifact for ' + pathname, {status: 404});
  }

  fetch = async (url, options) =>
    (await this.response(url)) ??
    fetch(url, {...options, signal: AbortSignal.timeout(30_000)});

  async route(context) {
    await context.route('https://registry.npmjs.org/**', async route => {
      const response = await this.response(route.request().url());
      if (!response) return route.continue();
      await route.fulfill({
        status: response.status,
        headers: {
          ...Object.fromEntries(response.headers),
          'access-control-allow-origin': '*',
        },
        body: Buffer.from(await response.arrayBuffer()),
      });
    });
  }

  /** npm's scoped registry keeps transitive Code3D dependencies in this batch. */
  async listen() {
    const server = createServer(async (request, response) => {
      try {
        const result = await this.response(new URL(request.url, url), url);
        if (!result) {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(Buffer.from(await result.arrayBuffer()));
      } catch (error) {
        response.writeHead(500).end(String(error));
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    return {
      url,
      close: () =>
        new Promise((resolve, reject) =>
          server.close(error => (error ? reject(error) : resolve())),
        ),
    };
  }
}
