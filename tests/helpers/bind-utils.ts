import { createServer } from 'node:net';

function failClosedOnUnavailablePort(host: string, port: number): void {
    if (process.env.CI || process.env.SCI_FAIL_PORT_SKIP === '1') {
        throw new Error(
            `Required test port ${host}:${port} is unavailable; refusing to silently skip endpoint coverage`
        );
    }
}

export async function canBindTcp(host: string, port = 0): Promise<boolean> {
    return await new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', (error) => {
            try {
                failClosedOnUnavailablePort(host, port);
                resolve(false);
            } catch (strictError) {
                reject(strictError instanceof Error ? strictError : error);
            }
        });
        server.listen(port, host, () => {
            server.close(() => resolve(true));
        });
    });
}
