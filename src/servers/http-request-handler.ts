import type { HTTPRequest } from '../adapters/http-adapter.js';
import { isCoreError } from '../core/errors.js';
import { handleHTTPCoreRoutes } from './http-core-routes.js';
import { handleHTTPGraphSnapshotRoutes } from './http-graph-snapshot-routes.js';
import { assertAllowedBrowserOrigin, corsHeadersForRequest } from './http-ingress.js';
import { handleHTTPPipelineRoutes } from './http-pipeline-routes.js';
import { envelopeForThrownError, type HTTPRouteContext, statusForThrownError } from './http-route-context.js';

export function createHTTPFetchHandler(context: HTTPRouteContext): (request: Request) => Promise<Response> {
    return async (request) => {
        try {
            const url = new URL(request.url);
            if (request.method === 'OPTIONS') {
                const headers = corsHeadersForRequest(request);
                if (request.headers.get('origin') && headers['Access-Control-Allow-Origin'] === 'null') {
                    return new Response('', { status: 403, headers });
                }
                return new Response('', { status: 204, headers });
            }
            if (request.method !== 'GET' && request.method !== 'HEAD') {
                assertAllowedBrowserOrigin(request, 'HTTP write request');
            }

            const coreResponse = await handleHTTPCoreRoutes(context, request, url);
            if (coreResponse) return coreResponse;
            const pipelineResponse = await handleHTTPPipelineRoutes(context, request, url);
            if (pipelineResponse) return pipelineResponse;
            const graphResponse = await handleHTTPGraphSnapshotRoutes(context, request, url);
            if (graphResponse) return graphResponse;

            const httpRequest: HTTPRequest = {
                method: request.method,
                url: request.url,
                headers: Object.fromEntries(request.headers.entries()),
                body: await context.getRequestBody(request),
                query: context.extractQuery(request.url),
            };
            const response = await context.httpAdapter.handleRequest(httpRequest);
            return new Response(response.body, { status: response.status, headers: response.headers });
        } catch (error) {
            if (!isCoreError(error)) console.error('[HTTP Server] Request failed:', error);
            return new Response(JSON.stringify({ success: false, error: envelopeForThrownError(error) }), {
                status: statusForThrownError(error),
                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
            });
        }
    };
}
