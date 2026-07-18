import { definitionToApiResponse } from '../adapters/utils.js';
import type { CodeAnalyzer } from '../core/unified-analyzer';
import type { FastSearchLayer } from '../layers/layer1-fast-search.js';
import type { SearchQuery } from '../types/core.js';
import { corsHeadersForRequest } from './http-ingress.js';

// Retained for the currently disconnected server-level SSE path; extraction must not enable it.
export class HTTPStreamingHandler {
    constructor(private readonly coreAnalyzer: CodeAnalyzer) {}
    /**
     * Handle Server-Sent Events streaming for real-time search results
     */
    async handleSSEStream(request: Request, pathname: string): Promise<Response> {
        const body = await request.text();
        let requestData: any;

        try {
            requestData = JSON.parse(body);
        } catch {
            return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', ...corsHeadersForRequest(request) },
            });
        }

        // Set up SSE headers
        const headers = new Headers({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            ...corsHeadersForRequest(request),
            'Access-Control-Allow-Headers': 'Content-Type',
        });

        // Create a readable stream for SSE
        const stream = new ReadableStream({
            async start(controller) {
                const encoder = new TextEncoder();

                const sendSSEMessage = (data: any, eventType = 'data') => {
                    const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
                    controller.enqueue(encoder.encode(message));
                };

                try {
                    // Get the layer manager from the core analyzer to access the ClaudeToolsLayer
                    if (pathname.includes('/stream/search')) {
                        await this.handleStreamSearch(requestData, sendSSEMessage, controller);
                    } else if (pathname.includes('/stream/definition')) {
                        await this.handleStreamDefinition(requestData, sendSSEMessage, controller);
                    }
                } catch (error) {
                    sendSSEMessage({ error: 'Stream processing failed', details: String(error) }, 'error');
                } finally {
                    controller.close();
                }
            },
        });

        return new Response(stream, { headers });
    }

    /**
     * Handle streaming search requests
     */
    private async handleStreamSearch(
        requestData: any,
        sendMessage: (data: any, eventType?: string) => void,
        _controller: ReadableStreamDefaultController
    ): Promise<void> {
        const { pattern, path = '.', maxResults = 100, timeout = 20000 } = requestData;

        if (!pattern) {
            sendMessage({ error: 'Pattern is required' }, 'error');
            return;
        }

        // Try to get the ClaudeToolsLayer for streaming
        const layerManager = (this.coreAnalyzer as any).layerManager;
        if (layerManager) {
            const claudeLayer = layerManager.getLayer('layer1') as FastSearchLayer;

            if (claudeLayer?.streamSearch) {
                const searchQuery: SearchQuery = {
                    identifier: pattern,
                    searchPath: path,
                    caseSensitive: false,
                    fileTypes: ['typescript', 'javascript'],
                    includeTests: true,
                };

                try {
                    const searchStream = await claudeLayer.streamSearch(searchQuery);

                    let resultCount = 0;

                    searchStream.on('data', (result) => {
                        if (resultCount >= maxResults) {
                            searchStream.cancel();
                            return;
                        }

                        sendMessage({
                            type: 'match',
                            file: result.file,
                            line: result.line,
                            column: result.column,
                            text: result.text,
                            confidence: result.confidence,
                        });

                        resultCount++;
                    });

                    searchStream.on('progress', (progress) => {
                        sendMessage(
                            {
                                type: 'progress',
                                filesSearched: progress.filesSearched,
                                matchesFound: progress.matchesFound,
                                elapsedMs: progress.elapsedMs,
                            },
                            'progress'
                        );
                    });

                    searchStream.on('end', () => {
                        sendMessage({ type: 'complete', totalResults: resultCount }, 'complete');
                    });

                    searchStream.on('error', (error) => {
                        sendMessage({ error: 'Search failed', details: String(error) }, 'error');
                    });

                    // Set timeout
                    setTimeout(() => {
                        searchStream.cancel();
                        sendMessage({ error: 'Search timeout' }, 'error');
                    }, timeout);
                } catch (error) {
                    sendMessage({ error: 'Failed to start stream search', details: String(error) }, 'error');
                }
            } else {
                sendMessage({ error: 'Streaming search not available' }, 'error');
            }
        } else {
            sendMessage({ error: 'Layer manager not available' }, 'error');
        }
    }

    /**
     * Handle streaming definition search
     */
    private async handleStreamDefinition(
        requestData: any,
        sendMessage: (data: any, eventType?: string) => void,
        _controller: ReadableStreamDefaultController
    ): Promise<void> {
        const { identifier, file, maxResults = 50 } = requestData;

        if (!identifier) {
            sendMessage({ error: 'Identifier is required' }, 'error');
            return;
        }

        // Use regular definition search for now - could be enhanced with streaming later
        try {
            const result = await (this.coreAnalyzer as any).findDefinitionAsync({
                uri: file || 'file://unknown',
                position: { line: 0, character: 0 },
                identifier,
                maxResults,
            });

            // Stream the results one by one to simulate streaming
            for (let i = 0; i < result.data.length; i++) {
                const definition = result.data[i];
                const mapped = definitionToApiResponse(definition);
                sendMessage({
                    type: 'definition',
                    ...mapped,
                    confidence: (definition as any).confidence,
                    layer: (definition as any).layer,
                });

                // Small delay to simulate streaming
                await new Promise((resolve) => setTimeout(resolve, 10));
            }

            sendMessage({ type: 'complete', totalResults: result.data.length }, 'complete');
        } catch (error) {
            sendMessage({ error: 'Definition search failed', details: String(error) }, 'error');
        }
    }
}
